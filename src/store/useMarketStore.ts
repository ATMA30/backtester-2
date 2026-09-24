import { create } from 'zustand';
import {
  Candle,
  MarketPair,
  ActiveIndicator,
  IndicatorKind,
  ForexSessionConfig,
  SeparatorTF,
} from '../types/market';
import { useReplayStore } from './useReplayStore';
import { useDrawingStore } from './useDrawingStore';
import { saveDataset, saveProviderDataset } from '../services/db';
import { useUIStore } from './useUIStore';
import { INSTRUMENTS } from '../domain/instruments';
import { TIMEFRAME_DEFS, TIMEFRAME_VALUES, TimeframeSeconds } from '../domain/timeframes';
import {
  aggregateCandles,
  detectBaseTF as detectBaseTFFrom,
  sanitizeCandles,
  seriesHasVolume,
  RawCandleLike,
} from '../domain/candles';

export { TIMEFRAME_DEFS, aggregateCandles };
export { getCalendarBucket } from '../domain/candles';

/** Instrument catalogue in the shape the pickers consume. */
export const ALL_MARKET_PAIRS: readonly MarketPair[] = INSTRUMENTS.map((i) => ({
  symbol: i.symbol,
  label: i.label,
  category: i.category,
  decimals: i.decimals,
  pip: i.pip,
  derivSymbol: i.derivSymbol,
  binanceSymbol: i.binanceSymbol,
}));

/** Infer the base timeframe of a series against the app's known timeframes. */
export function detectBaseTF(candles: readonly Candle[]): number {
  return detectBaseTFFrom(candles, TIMEFRAME_VALUES);
}

// ── PERSISTED SESSION SETTINGS ────────────────────────────────
const SESSION_SETTINGS_KEY = 'tv_pro_session_settings';

/** A dataset must look like real history before it overwrites the master cache. */
const MASTER_DATASET_MIN_CANDLES = 500;
/**
 * How many symbols' deep daily histories to keep in memory at once.
 *
 * The cache grew without limit: every instrument visited during a session kept
 * its full daily series resident, so browsing the ~40-instrument catalogue
 * retained tens of megabytes of candles that nothing would ever evict. The
 * series survive in IndexedDB, so a miss costs a read, not the data.
 */
const MAX_CACHED_DAILY_SYMBOLS = 6;
/** Below this, an intraday slice must not overwrite a deep dataset in IndexedDB. */
const PERSISTABLE_MIN_CANDLES = 3_000;

/**
 * Au-delà, le jeu n'est plus recopié dans IndexedDB.
 *
 * `saveDataset` fait un clone structuré de tout le tableau : plusieurs millions
 * de bougies s'y traduisent par des centaines de Mo écrits sur disque, plusieurs
 * secondes de blocage, et souvent un dépassement de quota. Un fichier importé se
 * réimporte en quelques secondes — le cache n'a pas de valeur à ce prix.
 */
const PERSISTABLE_MAX_CANDLES = 400_000;

export type ChartType = 'Candlestick' | 'Bar' | 'Line' | 'Area';

const CHART_TYPES: readonly ChartType[] = ['Candlestick', 'Bar', 'Line', 'Area'];
const SEPARATOR_TFS: readonly Exclude<SeparatorTF, null>[] = ['1D', '1W', '1M', '3M', '1Y'];
const INDICATOR_KINDS: readonly IndicatorKind[] = ['SMA', 'EMA', 'RSI', 'MACD', 'BB', 'VWAP'];

export interface SessionSettings {
  currentSymbol: string;
  activeTF: number;
  chartType: ChartType;
  showVolume: boolean;
  showGrid: boolean;
  soundEnabled: boolean;
  separatorTF: SeparatorTF;
  forexSessions: ForexSessionConfig;
  historyRange: string;
  activeIndicators: ActiveIndicator[];
}

export const DEFAULT_FOREX_SESSIONS: ForexSessionConfig = {
  sydney: false,
  tokyo: false,
  london: false,
  newyork: false,
  asianRange: false,
  londonOpenKZ: false,
  nyOpenKZ: false,
  londonCloseKZ: false,
  showHighLow: true,
  showLabels: true,
  useLocalTz: false,
};

export const DEFAULT_SESSION_SETTINGS: SessionSettings = {
  currentSymbol: 'EURUSD',
  activeTF: TimeframeSeconds.D1,
  chartType: 'Candlestick',
  showVolume: true,
  showGrid: true,
  soundEnabled: true,
  separatorTF: null,
  forexSessions: DEFAULT_FOREX_SESSIONS,
  historyRange: 'max',
  activeIndicators: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function parseForexSessions(value: unknown): ForexSessionConfig {
  if (!isRecord(value)) return DEFAULT_FOREX_SESSIONS;
  const out = { ...DEFAULT_FOREX_SESSIONS };
  for (const key of Object.keys(DEFAULT_FOREX_SESSIONS) as (keyof ForexSessionConfig)[]) {
    out[key] = boolOr(value[key], DEFAULT_FOREX_SESSIONS[key]);
  }
  return out;
}

function parseIndicators(value: unknown): ActiveIndicator[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: ActiveIndicator[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const { id, type, period, color } = raw;
    if (typeof id !== 'string' || seen.has(id)) continue;
    if (typeof type !== 'string' || !INDICATOR_KINDS.includes(type as IndicatorKind)) continue;
    if (typeof period !== 'number' || !Number.isFinite(period) || period < 1 || period > 5_000) continue;
    seen.add(id);
    out.push({
      id,
      type: type as IndicatorKind,
      period: Math.floor(period),
      color: typeof color === 'string' ? color : '#10B981',
    });
  }
  return out;
}

/**
 * Read persisted settings, coercing every field to a valid value.
 *
 * The previous implementation returned `JSON.parse(raw)` unchecked. A partial
 * payload (schema migration, interrupted write) then threw on
 * `saved.forexSessions[...]` inside the restore effect, and because that effect
 * was not awaited with a catch the fallback loader never ran — leaving a blank,
 * permanently broken app until the user cleared localStorage by hand.
 */
export function loadSessionSettings(): SessionSettings | null {
  let parsed: unknown;
  try {
    const raw = localStorage.getItem(SESSION_SETTINGS_KEY);
    if (!raw) return null;
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  const activeTF = Number(parsed.activeTF);
  const chartType = parsed.chartType;
  const separatorTF = parsed.separatorTF;

  return {
    currentSymbol:
      typeof parsed.currentSymbol === 'string' && parsed.currentSymbol.trim()
        ? parsed.currentSymbol.trim()
        : DEFAULT_SESSION_SETTINGS.currentSymbol,
    activeTF: TIMEFRAME_VALUES.includes(activeTF) ? activeTF : DEFAULT_SESSION_SETTINGS.activeTF,
    chartType: CHART_TYPES.includes(chartType as ChartType)
      ? (chartType as ChartType)
      : DEFAULT_SESSION_SETTINGS.chartType,
    showVolume: boolOr(parsed.showVolume, DEFAULT_SESSION_SETTINGS.showVolume),
    showGrid: boolOr(parsed.showGrid, DEFAULT_SESSION_SETTINGS.showGrid),
    soundEnabled: boolOr(parsed.soundEnabled, DEFAULT_SESSION_SETTINGS.soundEnabled),
    separatorTF: SEPARATOR_TFS.includes(separatorTF as Exclude<SeparatorTF, null>)
      ? (separatorTF as SeparatorTF)
      : null,
    forexSessions: parseForexSessions(parsed.forexSessions),
    historyRange:
      typeof parsed.historyRange === 'string' && parsed.historyRange
        ? parsed.historyRange
        : DEFAULT_SESSION_SETTINGS.historyRange,
    activeIndicators: parseIndicators(parsed.activeIndicators),
  };
}

function persistSessionSettings(settings: SessionSettings): void {
  try {
    localStorage.setItem(SESSION_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Best-effort persistence (localStorage full, disabled, or private mode).
  }
}

// ── STORE ─────────────────────────────────────────────────────
interface MarketState {
  currentSymbol: string;
  activeTF: number;
  baseTF: number;
  baseCandles: Candle[];
  displayCandles: Candle[];
  sortedTimes: number[];
  historyRange: string;
  chartType: ChartType;
  showVolume: boolean;
  showGrid: boolean;
  soundEnabled: boolean;
  separatorTF: SeparatorTF;
  forexSessions: ForexSessionConfig;
  activeIndicators: ActiveIndicator[];
  currentFitContentTrigger: number;
  isImported: boolean;
  dailyMasterMap: Record<string, Candle[]>;

  /**
   * Where the loaded candles came from, and whether they are market data.
   *
   * Already computed by `fetchHistoricalSeries`; kept here so the status bar can
   * show it permanently. "Are these candles real?" is a standing question during
   * a backtest, not a three-second toast.
   */
  dataSourceLabel: string | null;
  isSimulatedData: boolean;
  /**
   * La série chargée porte-t-elle des volumes ?
   *
   * Toutes les sources n'en publient pas. Sans ce drapeau, l'interface
   * réservait 17 % de la hauteur du graphique à un histogramme entièrement nul
   * — ce qui se lisait comme un bug d'affichage.
   */
  hasVolumeData: boolean;

  setIsImported: (isImported: boolean) => void;
  setDataSource: (label: string | null, isSimulated: boolean) => void;
  restoreDailyDataset: (targetTF?: number) => boolean;
  setSymbol: (symbol: string) => void;
  setTimeframe: (tfSec: number) => void;
  setBaseCandles: (candles: readonly RawCandleLike[], baseTF?: number, isImported?: boolean) => void;
  setDisplayCandles: (candles: Candle[]) => void;
  setHistoryRange: (range: string) => void;
  setChartType: (type: ChartType) => void;
  setShowVolume: (visible: boolean) => void;
  setShowGrid: (visible: boolean) => void;
  setSoundEnabled: (enabled: boolean) => void;
  setForexSessions: (sessions: ForexSessionConfig) => void;
  toggleVolume: () => void;
  toggleGrid: () => void;
  toggleSound: () => void;
  triggerFitContent: () => void;
  setSeparatorTF: (tf: SeparatorTF) => void;
  toggleForexSession: (session: 'all' | 'all_kz' | keyof ForexSessionConfig) => void;
  toggleForexLocalTz: () => void;
  addIndicator: (ind: ActiveIndicator) => void;
  removeIndicator: (id: string) => void;
}

/** Slice of the store that is mirrored into localStorage. */
type PersistedSlice = Pick<
  MarketState,
  | 'currentSymbol'
  | 'activeTF'
  | 'chartType'
  | 'showVolume'
  | 'showGrid'
  | 'soundEnabled'
  | 'separatorTF'
  | 'forexSessions'
  | 'historyRange'
  | 'activeIndicators'
>;

/** Major sessions and killzones — the boolean groups the "all" toggles drive. */
const MAJOR_SESSIONS = ['sydney', 'tokyo', 'london', 'newyork'] as const;
const KILLZONES = ['asianRange', 'londonOpenKZ', 'nyOpenKZ', 'londonCloseKZ'] as const;

/**
 * Bound the daily cache, keeping `keep` and the most recently added entries.
 *
 * Insertion order is the eviction order: JavaScript object keys preserve it for
 * string keys, and re-inserting a symbol does *not* move it to the end — so the
 * freshly written symbol is passed explicitly rather than inferred.
 */
function evictOldest(
  cache: Record<string, Candle[]>,
  keep: string
): Record<string, Candle[]> {
  const symbols = Object.keys(cache);
  if (symbols.length <= MAX_CACHED_DAILY_SYMBOLS) return cache;

  const survivors = symbols
    .filter((s) => s !== keep)
    .slice(-(MAX_CACHED_DAILY_SYMBOLS - 1));

  const next: Record<string, Candle[]> = {};
  for (const symbol of survivors) next[symbol] = cache[symbol];
  next[keep] = cache[keep];
  return next;
}

function setGroup(
  config: ForexSessionConfig,
  keys: readonly (keyof ForexSessionConfig)[],
  value: boolean
): ForexSessionConfig {
  const next = { ...config };
  for (const key of keys) next[key] = value;
  return next;
}

export const useMarketStore = create<MarketState>((set, get) => ({
  currentSymbol: DEFAULT_SESSION_SETTINGS.currentSymbol,
  activeTF: TimeframeSeconds.D1,
  baseTF: TimeframeSeconds.D1,
  baseCandles: [],
  displayCandles: [],
  dailyMasterMap: {},
  sortedTimes: [],
  isImported: false,
  dataSourceLabel: null,
  isSimulatedData: false,
  hasVolumeData: false,
  historyRange: DEFAULT_SESSION_SETTINGS.historyRange,
  chartType: DEFAULT_SESSION_SETTINGS.chartType,
  showVolume: true,
  showGrid: true,
  soundEnabled: true,
  separatorTF: null,
  forexSessions: DEFAULT_FOREX_SESSIONS,
  activeIndicators: [],
  currentFitContentTrigger: 0,

  setIsImported: (isImported) => set({ isImported }),

  setDataSource: (dataSourceLabel, isSimulatedData) => set({ dataSourceLabel, isSimulatedData }),

  setSymbol: (symbol) => {
    const next = symbol.trim();
    if (!next || next === get().currentSymbol) return;
    useReplayStore.getState().resetReplay();
    useDrawingStore.getState().setActiveSymbol(next);
    set({ currentSymbol: next });
  },

  setTimeframe: (activeTF) => {
    if (!Number.isFinite(activeTF) || activeTF <= 0) return;
    const { baseCandles, baseTF } = get();
    if (!baseCandles.length) {
      set({ activeTF });
      return;
    }

    // Aggregation can only roll candles up. Asking for a finer timeframe than the
    // loaded data would silently display base candles under a wrong label, so the
    // caller must load finer data first.
    if (activeTF < baseTF) {
      set({ activeTF });
      return;
    }

    const replay = useReplayStore.getState();
    const source = replay.isActive
      ? baseCandles.slice(0, Math.min(baseCandles.length - 1, Math.max(0, replay.currentIndex)) + 1)
      : baseCandles;

    const aggregated = aggregateCandles(source, activeTF, baseTF);
    set({
      activeTF,
      displayCandles: aggregated,
      sortedTimes: aggregated.map((c) => c.time),
      hasVolumeData: seriesHasVolume(aggregated),
    });
  },

  setBaseCandles: (rawCandles, customBaseTF, isImported) => {
    const baseCandles = sanitizeCandles(rawCandles);
    if (baseCandles.length === 0) return;

    const baseTF =
      customBaseTF && Number.isFinite(customBaseTF) && customBaseTF > 0
        ? customBaseTF
        : detectBaseTF(baseCandles);

    const { currentSymbol: symbol, historyRange, dailyMasterMap } = get();

    const patch: Partial<MarketState> = {
      baseCandles,
      displayCandles: baseCandles,
      sortedTimes: baseCandles.map((c) => c.time),
      baseTF,
      activeTF: baseTF,
      hasVolumeData: seriesHasVolume(baseCandles),
    };
    if (isImported !== undefined) patch.isImported = isImported;

    // Keep the deep daily history per symbol so switching to an intraday
    // timeframe and back does not lose it.
    if (baseTF >= TimeframeSeconds.D1 && baseCandles.length > MASTER_DATASET_MIN_CANDLES) {
      patch.dailyMasterMap = evictOldest({ ...dailyMasterMap, [symbol]: baseCandles }, symbol);
    }

    set(patch);

    if (!useReplayStore.getState().isActive) {
      useReplayStore.getState().resetReplay();
    }

    // Never let a short intraday slice overwrite a deep dataset already cached.
    const isPersistable =
      (baseTF >= TimeframeSeconds.D1 || baseCandles.length > PERSISTABLE_MIN_CANDLES) &&
      baseCandles.length <= PERSISTABLE_MAX_CANDLES;

    if (isPersistable) {
      const save = isImported ? saveDataset : saveProviderDataset;
      void save({
        symbol,
        name: symbol,
        candlesCount: baseCandles.length,
        baseTF,
        createdAt: Date.now(),
        timeRange: historyRange,
        data: baseCandles,
        ...(isImported ? { source: 'import' as const } : {}),
      }).then((result) => {
        // A silent failure here means the session will not come back after a
        // reload; the user needs to know, especially on a quota error.
        if (!result.ok) {
          useUIStore.getState().showToast(`Sauvegarde impossible : ${result.message}`, 'warning', 6000);
        }
      });
    }
  },

  restoreDailyDataset: (targetTF = TimeframeSeconds.D1) => {
    const { dailyMasterMap, currentSymbol } = get();
    // `currentSymbol` can be user-supplied (imported dataset name); a plain index
    // read would resolve inherited members such as `toString` to a function.
    const master = Object.prototype.hasOwnProperty.call(dailyMasterMap, currentSymbol)
      ? dailyMasterMap[currentSymbol]
      : undefined;

    if (!Array.isArray(master) || master.length <= MASTER_DATASET_MIN_CANDLES) return false;

    // The master cache is daily; a finer target cannot be rebuilt from it.
    const effectiveTF = Math.max(targetTF, TimeframeSeconds.D1);
    const displayCandles = aggregateCandles(master, effectiveTF, TimeframeSeconds.D1);

    set({
      baseCandles: master,
      displayCandles,
      sortedTimes: displayCandles.map((c) => c.time),
      baseTF: TimeframeSeconds.D1,
      activeTF: effectiveTF,
      hasVolumeData: seriesHasVolume(displayCandles),
    });
    return true;
  },

  setDisplayCandles: (displayCandles) =>
    set({
      displayCandles,
      sortedTimes: displayCandles.map((c) => c.time),
      hasVolumeData: seriesHasVolume(displayCandles),
    }),

  setHistoryRange: (historyRange) => set({ historyRange }),
  setChartType: (chartType) => set({ chartType }),

  // Explicit setters: restoring a saved session by flipping toggles until the
  // state matched was brittle and silently dropped killzone flags.
  setShowVolume: (showVolume) => set({ showVolume }),
  setShowGrid: (showGrid) => set({ showGrid }),
  setSoundEnabled: (soundEnabled) => set({ soundEnabled }),
  setForexSessions: (forexSessions) => set({ forexSessions }),

  toggleVolume: () => set((s) => ({ showVolume: !s.showVolume })),
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  toggleSound: () => set((s) => ({ soundEnabled: !s.soundEnabled })),
  triggerFitContent: () => set((s) => ({ currentFitContentTrigger: s.currentFitContentTrigger + 1 })),
  setSeparatorTF: (separatorTF) => set({ separatorTF }),

  toggleForexSession: (session) =>
    set((state) => {
      const fs = state.forexSessions;
      if (session === 'all') {
        const anyOn = MAJOR_SESSIONS.some((k) => fs[k]);
        return { forexSessions: setGroup(fs, MAJOR_SESSIONS, !anyOn) };
      }
      if (session === 'all_kz') {
        const anyOn = KILLZONES.some((k) => fs[k]);
        return { forexSessions: setGroup(fs, KILLZONES, !anyOn) };
      }
      return { forexSessions: { ...fs, [session]: !fs[session] } };
    }),

  toggleForexLocalTz: () =>
    set((state) => ({
      forexSessions: { ...state.forexSessions, useLocalTz: !state.forexSessions.useLocalTz },
    })),

  addIndicator: (ind) =>
    set((state) =>
      state.activeIndicators.some((i) => i.id === ind.id)
        ? state
        : { activeIndicators: [...state.activeIndicators, ind] }
    ),

  removeIndicator: (id) =>
    set((state) => ({ activeIndicators: state.activeIndicators.filter((i) => i.id !== id) })),
}));

// ── SETTINGS PERSISTENCE ──────────────────────────────────────
function selectPersisted(state: MarketState): PersistedSlice {
  return {
    currentSymbol: state.currentSymbol,
    activeTF: state.activeTF,
    chartType: state.chartType,
    showVolume: state.showVolume,
    showGrid: state.showGrid,
    soundEnabled: state.soundEnabled,
    separatorTF: state.separatorTF,
    forexSessions: state.forexSessions,
    historyRange: state.historyRange,
    activeIndicators: state.activeIndicators,
  };
}

function sliceChanged(a: PersistedSlice, b: PersistedSlice): boolean {
  return (
    a.currentSymbol !== b.currentSymbol ||
    a.activeTF !== b.activeTF ||
    a.chartType !== b.chartType ||
    a.showVolume !== b.showVolume ||
    a.showGrid !== b.showGrid ||
    a.soundEnabled !== b.soundEnabled ||
    a.separatorTF !== b.separatorTF ||
    a.forexSessions !== b.forexSessions ||
    a.historyRange !== b.historyRange ||
    a.activeIndicators !== b.activeIndicators
  );
}

/**
 * Mirror settings to localStorage.
 *
 * The subscription fires on every store write, including the per-tick
 * `displayCandles` updates of replay playback. Serialising on each of those was
 * a synchronous main-thread write ~20×/s, so the slice is compared by reference
 * first and only a real settings change reaches `JSON.stringify`.
 */
let lastPersisted = selectPersisted(useMarketStore.getState());

useMarketStore.subscribe((state) => {
  const next = selectPersisted(state);
  if (!sliceChanged(lastPersisted, next)) return;
  lastPersisted = next;

  persistSessionSettings({
    ...next,
    // `series` holds a live chart handle owned by TradingChart — never persist it.
    activeIndicators: next.activeIndicators.map(({ series: _series, ...rest }) => rest),
  });
});
