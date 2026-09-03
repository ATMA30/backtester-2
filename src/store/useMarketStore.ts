import { create } from 'zustand';
import { Candle, MarketPair, TimeframeDef, ActiveIndicator, ForexSessionConfig, SeparatorTF } from '../types/market';
import { useReplayStore } from './useReplayStore';
import { saveDataset } from '../services/db';

const SESSION_SETTINGS_KEY = 'tv_pro_session_settings';

export interface SessionSettings {
  currentSymbol: string;
  activeTF: number;
  chartType: 'Candlestick' | 'Bar' | 'Line' | 'Area';
  showVolume: boolean;
  showGrid: boolean;
  soundEnabled: boolean;
  separatorTF: SeparatorTF;
  forexSessions: ForexSessionConfig;
  historyRange: string;
  activeIndicators: ActiveIndicator[];
}

export function loadSessionSettings(): SessionSettings | null {
  try {
    const raw = localStorage.getItem(SESSION_SETTINGS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function persistSessionSettings(settings: SessionSettings) {
  try {
    localStorage.setItem(SESSION_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Best-effort persistence (e.g. localStorage full or disabled) — safe to ignore.
  }
}

export const TIMEFRAME_DEFS: TimeframeDef[] = [
  { s: 60, label: '1m', tfType: 'm' },
  { s: 180, label: '3m', tfType: 'm' },
  { s: 300, label: '5m', tfType: 'm' },
  { s: 900, label: '15m', tfType: 'm' },
  { s: 1800, label: '30m', tfType: 'm' },
  { s: 3600, label: '1h', tfType: 'h' },
  { s: 7200, label: '2h', tfType: 'h' },
  { s: 14400, label: '4h', tfType: 'h' },
  { s: 86400, label: '1D', tfType: 'd' },
  { s: 604800, label: '1W', tfType: 'w' },
  { s: 2592000, label: '1M', tfType: 'mo' },
];

export const ALL_MARKET_PAIRS: MarketPair[] = [
  // Forex Majors
  { symbol: 'EURUSD', derivSymbol: 'frxEURUSD', label: 'EUR / USD (Euro / US Dollar)', category: 'Forex Majors', decimals: 5, pip: 0.0001 },
  { symbol: 'GBPUSD', derivSymbol: 'frxGBPUSD', label: 'GBP / USD (Livre / US Dollar)', category: 'Forex Majors', decimals: 5, pip: 0.0001 },
  { symbol: 'USDJPY', derivSymbol: 'frxUSDJPY', label: 'USD / JPY (US Dollar / Yen Japonais)', category: 'Forex Majors', decimals: 3, pip: 0.01 },
  { symbol: 'USDCHF', derivSymbol: 'frxUSDCHF', label: 'USD / CHF (US Dollar / Franc Suisse)', category: 'Forex Majors', decimals: 5, pip: 0.0001 },
  { symbol: 'AUDUSD', derivSymbol: 'frxAUDUSD', label: 'AUD / USD (Dollar Aussie / US Dollar)', category: 'Forex Majors', decimals: 5, pip: 0.0001 },
  { symbol: 'USDCAD', derivSymbol: 'frxUSDCAD', label: 'USD / CAD (US Dollar / Dollar Canadien)', category: 'Forex Majors', decimals: 5, pip: 0.0001 },
  { symbol: 'NZDUSD', derivSymbol: 'frxNZDUSD', label: 'NZD / USD (Dollar Kiwi / US Dollar)', category: 'Forex Majors', decimals: 5, pip: 0.0001 },

  // Forex Minors
  { symbol: 'EURGBP', derivSymbol: 'frxEURGBP', label: 'EUR / GBP (Euro / Livre)', category: 'Forex Minors', decimals: 5, pip: 0.0001 },
  { symbol: 'EURJPY', derivSymbol: 'frxEURJPY', label: 'EUR / JPY (Euro / Yen)', category: 'Forex Minors', decimals: 3, pip: 0.01 },
  { symbol: 'GBPJPY', derivSymbol: 'frxGBPJPY', label: 'GBP / JPY (Livre / Yen)', category: 'Forex Minors', decimals: 3, pip: 0.01 },
  { symbol: 'AUDJPY', derivSymbol: 'frxAUDJPY', label: 'AUD / JPY (Aussie / Yen)', category: 'Forex Minors', decimals: 3, pip: 0.01 },
  { symbol: 'CADJPY', derivSymbol: 'frxCADJPY', label: 'CAD / JPY (Dollar Canadien / Yen)', category: 'Forex Minors', decimals: 3, pip: 0.01 },
  { symbol: 'CHFJPY', derivSymbol: 'frxCHFJPY', label: 'CHF / JPY (Franc Suisse / Yen)', category: 'Forex Minors', decimals: 3, pip: 0.01 },
  { symbol: 'NZDJPY', derivSymbol: 'frxNZDJPY', label: 'NZD / JPY (Kiwi / Yen)', category: 'Forex Minors', decimals: 3, pip: 0.01 },
  { symbol: 'EURAUD', derivSymbol: 'frxEURAUD', label: 'EUR / AUD (Euro / Aussie)', category: 'Forex Minors', decimals: 5, pip: 0.0001 },
  { symbol: 'EURCAD', derivSymbol: 'frxEURCAD', label: 'EUR / CAD (Euro / Dollar Canadien)', category: 'Forex Minors', decimals: 5, pip: 0.0001 },
  { symbol: 'EURCHF', derivSymbol: 'frxEURCHF', label: 'EUR / CHF (Euro / Franc Suisse)', category: 'Forex Minors', decimals: 5, pip: 0.0001 },
  { symbol: 'GBPAUD', derivSymbol: 'frxGBPAUD', label: 'GBP / AUD (Livre / Aussie)', category: 'Forex Minors', decimals: 5, pip: 0.0001 },
  { symbol: 'GBPCAD', derivSymbol: 'frxGBPCAD', label: 'GBP / CAD (Livre / Dollar Canadien)', category: 'Forex Minors', decimals: 5, pip: 0.0001 },
  { symbol: 'GBPCHF', derivSymbol: 'frxGBPCHF', label: 'GBP / CHF (Livre / Franc Suisse)', category: 'Forex Minors', decimals: 5, pip: 0.0001 },

  // Commodities & Indices
  { symbol: 'XAUUSD', derivSymbol: 'frxXAUUSD', label: 'XAU / USD (Or / Gold Spot)', category: 'Métaux & Matières', decimals: 2, pip: 0.01 },
  { symbol: 'XAGUSD', derivSymbol: 'frxXAGUSD', label: 'XAG / USD (Argent / Silver Spot)', category: 'Métaux & Matières', decimals: 3, pip: 0.01 },
  { symbol: 'SPX500', derivSymbol: 'OTC_SPC', label: 'S&P 500 (US 500 Index)', category: 'Indices Mondiaux', decimals: 2, pip: 0.1 },
  { symbol: 'NAS100', derivSymbol: 'OTC_NDX', label: 'Nasdaq 100 (US Tech Index)', category: 'Indices Mondiaux', decimals: 2, pip: 0.1 },
  { symbol: 'USOIL', label: 'Pétrole Brut WTI (Crude Oil)', category: 'Métaux & Matières', decimals: 2, pip: 0.01 },
  { symbol: 'UKOIL', label: 'Pétrole Brent (Brent Oil)', category: 'Métaux & Matières', decimals: 2, pip: 0.01 },

  // Synthetics
  { symbol: 'R_10', derivSymbol: 'R_10', label: 'Volatility 10 Index', category: 'Indices Synthétiques (Deriv)', decimals: 3, pip: 0.001 },
  { symbol: 'R_25', derivSymbol: 'R_25', label: 'Volatility 25 Index', category: 'Indices Synthétiques (Deriv)', decimals: 3, pip: 0.001 },
  { symbol: 'R_50', derivSymbol: 'R_50', label: 'Volatility 50 Index', category: 'Indices Synthétiques (Deriv)', decimals: 4, pip: 0.0001 },
  { symbol: 'R_75', derivSymbol: 'R_75', label: 'Volatility 75 Index', category: 'Indices Synthétiques (Deriv)', decimals: 4, pip: 0.0001 },
  { symbol: 'R_100', derivSymbol: 'R_100', label: 'Volatility 100 Index', category: 'Indices Synthétiques (Deriv)', decimals: 2, pip: 0.01 },
  { symbol: '1HZ10V', derivSymbol: '1HZ10V', label: 'Volatility 10 (1s) Index', category: 'Indices Synthétiques (Deriv)', decimals: 2, pip: 0.01 },
  { symbol: '1HZ100V', derivSymbol: '1HZ100V', label: 'Volatility 100 (1s) Index', category: 'Indices Synthétiques (Deriv)', decimals: 2, pip: 0.01 },
  { symbol: 'BOOM500', derivSymbol: 'BOOM500', label: 'Boom 500 Index', category: 'Indices Synthétiques (Deriv)', decimals: 3, pip: 0.001 },
  { symbol: 'CRASH500', derivSymbol: 'CRASH500', label: 'Crash 500 Index', category: 'Indices Synthétiques (Deriv)', decimals: 3, pip: 0.001 },

  // Crypto
  { symbol: 'BTCUSDT', binanceSymbol: 'BTCUSDT', label: 'BTC / USDT (Bitcoin)', category: 'Crypto', decimals: 2, pip: 0.1 },
  { symbol: 'ETHUSDT', binanceSymbol: 'ETHUSDT', label: 'ETH / USDT (Ethereum)', category: 'Crypto', decimals: 2, pip: 0.01 },
  { symbol: 'SOLUSDT', binanceSymbol: 'SOLUSDT', label: 'SOL / USDT (Solana)', category: 'Crypto', decimals: 2, pip: 0.01 },
  { symbol: 'BNBUSDT', binanceSymbol: 'BNBUSDT', label: 'BNB / USDT (BNB)', category: 'Crypto', decimals: 2, pip: 0.01 },
  { symbol: 'XRPUSDT', binanceSymbol: 'XRPUSDT', label: 'XRP / USDT (Ripple)', category: 'Crypto', decimals: 4, pip: 0.0001 },
  { symbol: 'ADAUSDT', binanceSymbol: 'ADAUSDT', label: 'ADA / USDT (Cardano)', category: 'Crypto', decimals: 4, pip: 0.0001 },
  { symbol: 'DOGEUSDT', binanceSymbol: 'DOGEUSDT', label: 'DOGE / USDT (Dogecoin)', category: 'Crypto', decimals: 5, pip: 0.00001 },
];

export function detectBaseTF(candles: Candle[]): number {
  if (!candles || candles.length < 2) return 86400;
  const counts: Record<number, number> = {};
  const sampleLimit = Math.min(200, candles.length);
  for (let i = 1; i < sampleLimit; i++) {
    const dt = candles[i].time - candles[i - 1].time;
    if (dt > 0) {
      let closest = TIMEFRAME_DEFS[0].s;
      let minDiff = Math.abs(dt - closest);
      for (const tf of TIMEFRAME_DEFS) {
        const diff = Math.abs(dt - tf.s);
        if (diff < minDiff) {
          minDiff = diff;
          closest = tf.s;
        }
      }
      counts[closest] = (counts[closest] || 0) + 1;
    }
  }

  let bestTF = 86400, maxCount = 0;
  for (const [tfStr, count] of Object.entries(counts)) {
    if (count > maxCount) {
      maxCount = count;
      bestTF = parseInt(tfStr, 10);
    }
  }
  return bestTF;
}

export function getCalendarBucket(t: number, targetTF: number): number {
  const d = new Date(t * 1000);
  if (targetTF === 86400) {
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000;
  }
  if (targetTF === 604800) {
    const day = d.getUTCDay();
    const diff = day === 0 ? 6 : day - 1;
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff) / 1000;
  }
  if (targetTF === 2592000) {
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
  }
  return Math.floor(t / targetTF) * targetTF;
}

export function aggregateCandles(candles: Candle[], targetTF: number, baseTF: number): Candle[] {
  if (targetTF <= baseTF || !candles.length) return candles;
  const groups = new Map<number, Candle[]>();
  for (const c of candles) {
    const bucket = getCalendarBucket(c.time, targetTF);
    if (!groups.has(bucket)) groups.set(bucket, []);
    groups.get(bucket)!.push(c);
  }
  const result: Candle[] = [];
  for (const [bucket, group] of groups.entries()) {
    const open = group[0].open;
    const high = Math.max(...group.map((c) => c.high));
    const low = Math.min(...group.map((c) => c.low));
    const close = group[group.length - 1].close;
    const volume = group.reduce((sum, c) => sum + c.volume, 0);
    result.push({ time: bucket, open, high, low, close, volume });
  }
  result.sort((a, b) => a.time - b.time);
  return result;
}

interface MarketState {
  currentSymbol: string;
  activeTF: number;
  baseTF: number;
  baseCandles: Candle[];
  displayCandles: Candle[];
  sortedTimes: number[];
  isLiveConnected: boolean;
  historyRange: string;
  chartType: 'Candlestick' | 'Bar' | 'Line' | 'Area';
  showVolume: boolean;
  showGrid: boolean;
  soundEnabled: boolean;
  separatorTF: SeparatorTF;
  forexSessions: ForexSessionConfig;
  activeIndicators: ActiveIndicator[];
  currentFitContentTrigger: number;

  dailyMasterCandles: Candle[];
  restoreDailyDataset: (targetTF?: number) => boolean;
  setSymbol: (symbol: string) => void;
  setTimeframe: (tfSec: number) => void;
  setBaseCandles: (candles: Candle[], baseTF?: number) => void;
  setDisplayCandles: (candles: Candle[]) => void;
  setLiveConnected: (connected: boolean) => void;
  setHistoryRange: (range: string) => void;
  setChartType: (type: 'Candlestick' | 'Bar' | 'Line' | 'Area') => void;
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

export const useMarketStore = create<MarketState>((set, get) => ({
  currentSymbol: 'EURUSD',
  activeTF: 86400,
  baseTF: 86400,
  baseCandles: [],
  displayCandles: [],
  dailyMasterCandles: [],
  sortedTimes: [],
  isLiveConnected: false,
  historyRange: 'max',
  chartType: 'Candlestick',
  showVolume: true,
  showGrid: true,
  soundEnabled: true,
  separatorTF: null,
  forexSessions: {
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
  },
  activeIndicators: [],
  currentFitContentTrigger: 0,

  setSymbol: (symbol) => set({ currentSymbol: symbol }),
  setTimeframe: (activeTF) => {
    const { baseCandles, baseTF } = get();
    if (!baseCandles.length) {
      set({ activeTF });
      return;
    }
    const replayState = useReplayStore.getState();
    let sourceCandles = baseCandles;
    if (replayState.isActive && baseCandles.length > 0) {
      const curIdx = Math.min(baseCandles.length - 1, Math.max(0, replayState.currentIndex));
      sourceCandles = baseCandles.slice(0, curIdx + 1);
    }
    const aggregated = aggregateCandles(sourceCandles, activeTF, baseTF);
    set({
      activeTF,
      displayCandles: aggregated,
      sortedTimes: aggregated.map((c) => c.time),
    });
  },
  setBaseCandles: (baseCandles, customBaseTF) => {
    const baseTF = customBaseTF || detectBaseTF(baseCandles);
    const sortedTimes = baseCandles.map((c) => c.time);
    const state = get();

    const updatePayload: any = {
      baseCandles,
      displayCandles: baseCandles,
      sortedTimes,
      baseTF,
      activeTF: baseTF,
    };

    // Protect master daily dataset in memory if this is a rich daily dataset (>= 500 bars)
    if (baseTF >= 86400 && baseCandles.length > 500) {
      updatePayload.dailyMasterCandles = baseCandles;
    }

    set(updatePayload);

    if (!useReplayStore.getState().isActive) {
      useReplayStore.getState().resetReplay();
    }

    const symbol = state.currentSymbol;
    const { historyRange } = state;
    // Do not overwrite a full 7,000-candle dataset in IndexedDB with a small intraday slice
    if (baseTF >= 86400 || baseCandles.length > 3000) {
      saveDataset({
        symbol,
        name: symbol,
        candlesCount: baseCandles.length,
        baseTF,
        createdAt: Date.now(),
        timeRange: historyRange,
        data: baseCandles,
      });
    }
  },
  restoreDailyDataset: (targetTF: number = 86400) => {
    const { dailyMasterCandles } = get();
    if (dailyMasterCandles && dailyMasterCandles.length > 500) {
      const sortedTimes = dailyMasterCandles.map((c) => c.time);
      set({
        baseCandles: dailyMasterCandles,
        displayCandles: aggregateCandles(dailyMasterCandles, targetTF, 86400),
        sortedTimes,
        baseTF: 86400,
        activeTF: targetTF,
      });
      return true;
    }
    return false;
  },
  setDisplayCandles: (displayCandles) => {
    set({
      displayCandles,
      sortedTimes: displayCandles.map((c) => c.time),
    });
  },
  setLiveConnected: (isLiveConnected) => set({ isLiveConnected }),
  setHistoryRange: (historyRange) => set({ historyRange }),
  setChartType: (chartType) => set({ chartType }),
  toggleVolume: () => set((state) => ({ showVolume: !state.showVolume })),
  toggleGrid: () => set((state) => ({ showGrid: !state.showGrid })),
  toggleSound: () => set((state) => ({ soundEnabled: !state.soundEnabled })),
  triggerFitContent: () => set((state) => ({ currentFitContentTrigger: state.currentFitContentTrigger + 1 })),
  setSeparatorTF: (separatorTF) => set({ separatorTF }),
  toggleForexSession: (session) =>
    set((state) => {
      const fs = { ...state.forexSessions };
      if (session === 'all') {
        const anyOn = fs.sydney || fs.tokyo || fs.london || fs.newyork;
        fs.sydney = !anyOn;
        fs.tokyo = !anyOn;
        fs.london = !anyOn;
        fs.newyork = !anyOn;
      } else if (session === 'all_kz') {
        const anyOn = fs.asianRange || fs.londonOpenKZ || fs.nyOpenKZ || fs.londonCloseKZ;
        fs.asianRange = !anyOn;
        fs.londonOpenKZ = !anyOn;
        fs.nyOpenKZ = !anyOn;
        fs.londonCloseKZ = !anyOn;
      } else {
        (fs as any)[session] = !(fs as any)[session];
      }
      return { forexSessions: fs };
    }),
  toggleForexLocalTz: () =>
    set((state) => ({
      forexSessions: {
        ...state.forexSessions,
        useLocalTz: !state.forexSessions.useLocalTz,
      },
    })),
  addIndicator: (ind) => set((state) => ({ activeIndicators: [...state.activeIndicators, ind] })),
  removeIndicator: (id) =>
    set((state) => ({ activeIndicators: state.activeIndicators.filter((i) => i.id !== id) })),
}));

useMarketStore.subscribe((state) => {
  persistSessionSettings({
    currentSymbol: state.currentSymbol,
    activeTF: state.activeTF,
    chartType: state.chartType,
    showVolume: state.showVolume,
    showGrid: state.showGrid,
    soundEnabled: state.soundEnabled,
    separatorTF: state.separatorTF,
    forexSessions: state.forexSessions,
    historyRange: state.historyRange,
    // `series` holds a lightweight-charts handle kept only in TradingChart's local ref map — never persist it.
    activeIndicators: state.activeIndicators.map(({ series: _series, ...rest }) => rest),
  });
});
