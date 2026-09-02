import { create } from 'zustand';
import { Drawing, DrawingTool, DrawingStyle } from '../types/drawing';

const STORAGE_KEY = 'tv_pro_drawings';
const DEFAULT_SYMBOL = 'EURUSD';

function loadStoredDrawingsBySymbol(): Record<string, Drawing[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    // Migrate legacy flat-array format (one global drawing list, pre-symbol-scoping).
    if (Array.isArray(parsed)) {
      return parsed.length > 0 ? { [DEFAULT_SYMBOL]: parsed } : {};
    }
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function persistAll(drawingsBySymbol: Record<string, Drawing[]>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(drawingsBySymbol));
  } catch {
    // Best-effort persistence (e.g. localStorage full or disabled) — safe to ignore.
  }
}

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
  updateDrawing: (id: string, updates: Partial<Drawing>) => void;
  removeDrawing: (id: string) => void;
  clearDrawings: () => void;
  selectDrawing: (id: string | null) => void;
  setCurrentStyle: (style: Partial<DrawingStyle>) => void;
  undo: () => void;
  redo: () => void;
}

const initialDrawingsBySymbol = loadStoredDrawingsBySymbol();
const initialDrawings = initialDrawingsBySymbol[DEFAULT_SYMBOL] || [];

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
    const nextDrawings = updatedMap[symbol] || [];
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
    if (!(symbol in drawingsBySymbol)) return;
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
    const newHistory = [...history.slice(0, historyIndex + 1), newDrawings];
    const updatedMap = { ...drawingsBySymbol, [activeSymbol]: newDrawings };
    persistAll(updatedMap);
    set({
      drawings: newDrawings,
      drawingsBySymbol: updatedMap,
      history: newHistory,
      historyIndex: newHistory.length - 1,
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

  removeDrawing: (id) => {
    const { drawings, history, historyIndex, drawingsBySymbol, activeSymbol } = get();
    const newDrawings = drawings.filter((d) => d.id !== id);
    const newHistory = [...history.slice(0, historyIndex + 1), newDrawings];
    const updatedMap = { ...drawingsBySymbol, [activeSymbol]: newDrawings };
    persistAll(updatedMap);
    set({
      drawings: newDrawings,
      drawingsBySymbol: updatedMap,
      history: newHistory,
      historyIndex: newHistory.length - 1,
      selectedDrawingId: null,
    });
  },

  clearDrawings: () => {
    const { history, historyIndex, drawingsBySymbol, activeSymbol } = get();
    const newHistory = [...history.slice(0, historyIndex + 1), []];
    const updatedMap = { ...drawingsBySymbol, [activeSymbol]: [] };
    persistAll(updatedMap);
    set({
      drawings: [],
      drawingsBySymbol: updatedMap,
      history: newHistory,
      historyIndex: newHistory.length - 1,
      selectedDrawingId: null,
    });
  },

  selectDrawing: (selectedDrawingId) => set({ selectedDrawingId }),

  setCurrentStyle: (style) =>
    set((state) => ({ currentStyle: { ...state.currentStyle, ...style } })),

  undo: () => {
    const { history, historyIndex, drawingsBySymbol, activeSymbol } = get();
    if (historyIndex > 0) {
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
    }
  },

  redo: () => {
    const { history, historyIndex, drawingsBySymbol, activeSymbol } = get();
    if (historyIndex < history.length - 1) {
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
    }
  },
}));
