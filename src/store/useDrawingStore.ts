import { create } from 'zustand';
import { Drawing, DrawingTool, DrawingStyle, Point } from '../types/drawing';
import { makeChannelPoints } from '../domain/geometry';

const STORAGE_KEY = 'tv_pro_drawings';
const DEFAULT_SYMBOL = 'EURUSD';

/**
 * Undo depth. The history was previously unbounded: every edit pushed a full
 * copy of the drawing list, so a long session with many objects grew the heap
 * without limit.
 */
const MAX_HISTORY = 100;

/** Coalescing window for writes to localStorage, in milliseconds. */
const PERSIST_DEBOUNCE_MS = 250;

const DRAWING_TOOLS: readonly DrawingTool[] = [
  'cursor', 'trendline', 'ray', 'hline', 'vline', 'rect',
  'channel', 'fib', 'brush', 'text', 'pos_long', 'pos_short',
];

// ── PERSISTENCE ───────────────────────────────────────────────

function isFinitePoint(value: unknown): value is Point {
  if (!value || typeof value !== 'object') return false;
  const p = value as Point;
  return Number.isFinite(p.time) && Number.isFinite(p.price);
}

/** Validate one drawing read back from storage or an imported session file. */
export function parseDrawing(value: unknown): Drawing | null {
  if (!value || typeof value !== 'object') return null;
  const d = value as Partial<Drawing>;

  if (typeof d.id !== 'string' || !d.id) return null;
  if (typeof d.type !== 'string' || !DRAWING_TOOLS.includes(d.type as DrawingTool)) return null;
  if (!Array.isArray(d.pts) || d.pts.length === 0 || !d.pts.every(isFinitePoint)) return null;
  if (!d.style || typeof d.style !== 'object') return null;

  const style = d.style as DrawingStyle;
  const type = d.type as DrawingTool;

  // Les canaux enregistrés avant la correction n'ont que deux points : leur
  // écart est nul, donc les deux rails se confondent et la forme s'affiche
  // comme une ligne. On leur redonne une largeur à la relecture.
  const pts =
    type === 'channel' && d.pts.length === 2
      ? makeChannelPoints(d.pts[0], d.pts[1])
      : d.pts;

  return {
    id: d.id,
    type,
    pts,
    style: {
      ...style,
      color: typeof style.color === 'string' ? style.color : '#3B82F6',
      width: Number.isFinite(style.width) ? style.width : 2,
    },
    locked: d.locked === true,
    hidden: d.hidden === true,
  };
}

/** More drawings than anyone draws by hand: a bound for untrusted files. */
const MAX_DRAWINGS = 5_000;

/** Keep only the drawings that survive validation. */
export function parseDrawings(value: unknown): Drawing[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_DRAWINGS)
    .map(parseDrawing)
    .filter((d): d is Drawing => d !== null);
}

function loadStoredDrawingsBySymbol(): Record<string, Drawing[]> {
  let parsed: unknown;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }

  // Legacy flat-array format (one global list, pre symbol-scoping).
  if (Array.isArray(parsed)) {
    const drawings = parseDrawings(parsed);
    return drawings.length > 0 ? { [DEFAULT_SYMBOL]: drawings } : {};
  }

  if (!parsed || typeof parsed !== 'object') return {};

  // `Object.create(null)` so a symbol named `toString` or `constructor` cannot
  // resolve to an inherited member later — `map[symbol]` previously returned a
  // function for those names, and the canvas crashed on `drawings.map`.
  const out: Record<string, Drawing[]> = Object.create(null);
  for (const [symbol, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (symbol === '__proto__') continue;
    out[symbol] = parseDrawings(value);
  }
  return out;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSnapshot: Record<string, Drawing[]> | null = null;

/**
 * Write any queued snapshot to localStorage immediately.
 * Called on page hide, and by tests that need to observe the write.
 */
export function flushDrawingPersistence(): void {
  persistTimer = null;
  const snapshot = pendingSnapshot;
  pendingSnapshot = null;
  if (!snapshot) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Best-effort persistence (quota exceeded, private mode, storage disabled).
  }
}

/**
 * Queue a write instead of serialising immediately.
 *
 * `updateDrawing` runs on every mousemove while dragging a trendline, and each
 * call used to `JSON.stringify` the drawings of *every* symbol and write them
 * synchronously — the drag got visibly choppier the more drawings existed.
 */
function persistAll(drawingsBySymbol: Record<string, Drawing[]>): void {
  pendingSnapshot = drawingsBySymbol;
  if (persistTimer !== null) return;
  persistTimer = setTimeout(flushDrawingPersistence, PERSIST_DEBOUNCE_MS);
}

// Never lose the last edit when the tab goes away mid-debounce.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushDrawingPersistence);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushDrawingPersistence();
  });
}

// ── STORE ─────────────────────────────────────────────────────

interface DrawingState {
  drawingsBySymbol: Record<string, Drawing[]>;
  activeSymbol: string;
  drawings: Drawing[];
  activeTool: DrawingTool;
  selectedDrawingId: string | null;
  history: Drawing[][];
  historyIndex: number;
  currentStyle: DrawingStyle;

  setActiveSymbol: (symbol: string) => void;
  removeSymbolData: (symbol: string) => void;
  setActiveTool: (tool: DrawingTool) => void;
  addDrawing: (drawing: Drawing) => void;
  /** Persist an in-progress edit (drag). Does not create an undo step. */
  updateDrawing: (id: string, updates: Partial<Drawing>) => void;
  /** Close an edit gesture and record one undo step for it. */
  commitDrawingEdit: () => void;
  removeDrawing: (id: string) => void;
  clearDrawings: () => void;
  selectDrawing: (id: string | null) => void;
  setCurrentStyle: (style: Partial<DrawingStyle>) => void;
  undo: () => void;
  redo: () => void;
  restoreDrawings: (drawings: Drawing[], symbol?: string) => void;
}

const initialDrawingsBySymbol = loadStoredDrawingsBySymbol();
const initialDrawings = initialDrawingsBySymbol[DEFAULT_SYMBOL] ?? [];

/** Append a snapshot, dropping the oldest entries past `MAX_HISTORY`. */
function pushHistory(history: Drawing[][], index: number, next: Drawing[]): {
  history: Drawing[][];
  historyIndex: number;
} {
  const truncated = [...history.slice(0, index + 1), next];
  const trimmed = truncated.length > MAX_HISTORY ? truncated.slice(-MAX_HISTORY) : truncated;
  return { history: trimmed, historyIndex: trimmed.length - 1 };
}

/** Read a symbol's drawings without touching the prototype chain. */
function drawingsFor(map: Record<string, Drawing[]>, symbol: string): Drawing[] {
  return Object.prototype.hasOwnProperty.call(map, symbol) ? map[symbol] : [];
}

export const useDrawingStore = create<DrawingState>((set, get) => ({
  drawingsBySymbol: initialDrawingsBySymbol,
  activeSymbol: DEFAULT_SYMBOL,
  drawings: initialDrawings,
  activeTool: 'cursor',
  selectedDrawingId: null,
  history: [initialDrawings],
  historyIndex: 0,
  currentStyle: {
    color: '#3B82F6',
    width: 2,
    fill: 'rgba(59, 130, 246, 0.12)',
    fillOpacity: 0.12,
  },

  setActiveSymbol: (symbol) => {
    const { activeSymbol, drawings, drawingsBySymbol } = get();
    if (symbol === activeSymbol) return;

    const updatedMap = { ...drawingsBySymbol, [activeSymbol]: drawings };
    const nextDrawings = drawingsFor(updatedMap, symbol);
    persistAll(updatedMap);

    set({
      drawingsBySymbol: updatedMap,
      activeSymbol: symbol,
      drawings: nextDrawings,
      history: [nextDrawings],
      historyIndex: 0,
      selectedDrawingId: null,
    });
  },

  removeSymbolData: (symbol) => {
    const { drawingsBySymbol, activeSymbol } = get();
    if (!Object.prototype.hasOwnProperty.call(drawingsBySymbol, symbol)) return;

    const updatedMap = { ...drawingsBySymbol };
    delete updatedMap[symbol];
    persistAll(updatedMap);

    if (symbol === activeSymbol) {
      set({
        drawingsBySymbol: updatedMap,
        drawings: [],
        history: [[]],
        historyIndex: 0,
        selectedDrawingId: null,
      });
    } else {
      set({ drawingsBySymbol: updatedMap });
    }
  },

  setActiveTool: (activeTool) => set({ activeTool, selectedDrawingId: null }),

  addDrawing: (drawing) => {
    const { drawings, history, historyIndex, drawingsBySymbol, activeSymbol } = get();
    const newDrawings = [...drawings, drawing];
    const updatedMap = { ...drawingsBySymbol, [activeSymbol]: newDrawings };
    persistAll(updatedMap);

    set({
      drawings: newDrawings,
      drawingsBySymbol: updatedMap,
      ...pushHistory(history, historyIndex, newDrawings),
      selectedDrawingId: drawing.id,
      activeTool: 'cursor',
    });
  },

  updateDrawing: (id, updates) => {
    const { drawings, drawingsBySymbol, activeSymbol } = get();
    const newDrawings = drawings.map((d) => (d.id === id ? { ...d, ...updates } : d));
    const updatedMap = { ...drawingsBySymbol, [activeSymbol]: newDrawings };
    persistAll(updatedMap);
    set({ drawings: newDrawings, drawingsBySymbol: updatedMap });
  },

  /**
   * Record the result of a drag as a single undo step.
   * Without this, dragging a shape produced no undo entry at all (updateDrawing
   * never touched the history), so Ctrl+Z jumped past the move entirely.
   */
  commitDrawingEdit: () => {
    const { drawings, history, historyIndex } = get();
    if (history[historyIndex] === drawings) return;
    set(pushHistory(history, historyIndex, drawings));
  },

  removeDrawing: (id) => {
    const { drawings, history, historyIndex, drawingsBySymbol, activeSymbol } = get();
    if (!drawings.some((d) => d.id === id)) return;

    const newDrawings = drawings.filter((d) => d.id !== id);
    const updatedMap = { ...drawingsBySymbol, [activeSymbol]: newDrawings };
    persistAll(updatedMap);

    set({
      drawings: newDrawings,
      drawingsBySymbol: updatedMap,
      ...pushHistory(history, historyIndex, newDrawings),
      selectedDrawingId: null,
    });
  },

  clearDrawings: () => {
    const { drawings, history, historyIndex, drawingsBySymbol, activeSymbol } = get();
    if (drawings.length === 0) return;

    const updatedMap = { ...drawingsBySymbol, [activeSymbol]: [] };
    persistAll(updatedMap);

    set({
      drawings: [],
      drawingsBySymbol: updatedMap,
      ...pushHistory(history, historyIndex, []),
      selectedDrawingId: null,
    });
  },

  selectDrawing: (selectedDrawingId) => set({ selectedDrawingId }),

  setCurrentStyle: (style) =>
    set((state) => ({ currentStyle: { ...state.currentStyle, ...style } })),

  undo: () => {
    const { history, historyIndex, drawingsBySymbol, activeSymbol } = get();
    if (historyIndex <= 0) return;

    const nextIndex = historyIndex - 1;
    const targetDrawings = history[nextIndex];
    const updatedMap = { ...drawingsBySymbol, [activeSymbol]: targetDrawings };
    persistAll(updatedMap);

    set({
      drawings: targetDrawings,
      drawingsBySymbol: updatedMap,
      historyIndex: nextIndex,
      selectedDrawingId: null,
    });
  },

  redo: () => {
    const { history, historyIndex, drawingsBySymbol, activeSymbol } = get();
    if (historyIndex >= history.length - 1) return;

    const nextIndex = historyIndex + 1;
    const targetDrawings = history[nextIndex];
    const updatedMap = { ...drawingsBySymbol, [activeSymbol]: targetDrawings };
    persistAll(updatedMap);

    set({
      drawings: targetDrawings,
      drawingsBySymbol: updatedMap,
      historyIndex: nextIndex,
      selectedDrawingId: null,
    });
  },

  restoreDrawings: (drawings, symbol) => {
    // Session files are exchanged between users: validate before trusting.
    const safe = parseDrawings(drawings);
    const sym = symbol || get().activeSymbol;
    const updatedMap = { ...get().drawingsBySymbol, [sym]: safe };
    persistAll(updatedMap);

    set({
      drawings: safe,
      drawingsBySymbol: updatedMap,
      history: [safe],
      historyIndex: 0,
      selectedDrawingId: null,
    });
  },
}));
