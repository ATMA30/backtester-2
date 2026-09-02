import { create } from 'zustand';
import { Candle, MarketPair, TimeframeDef } from '../types/market';

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
  { symbol: 'SPX500', label: 'S&P 500 (US 500 Index)', category: 'Indices Mondiaux', decimals: 2, pip: 0.1 },
  { symbol: 'NAS100', label: 'Nasdaq 100 (US Tech Index)', category: 'Indices Mondiaux', decimals: 2, pip: 0.1 },
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

interface MarketState {
  currentSymbol: string;
  activeTF: number;
  baseTF: number;
  baseCandles: Candle[];
  displayCandles: Candle[];
  sortedTimes: number[];
  isLiveConnected: boolean;
  isLivePaused: boolean;
  historyRange: string;
  chartType: 'Candlestick' | 'Bar' | 'Line' | 'Area';
  showVolume: boolean;
  showGrid: boolean;

  setSymbol: (symbol: string) => void;
  setTimeframe: (tfSec: number) => void;
  setBaseCandles: (candles: Candle[]) => void;
  setDisplayCandles: (candles: Candle[]) => void;
  setLiveConnected: (connected: boolean) => void;
  setLivePaused: (paused: boolean) => void;
  setHistoryRange: (range: string) => void;
  setChartType: (type: 'Candlestick' | 'Bar' | 'Line' | 'Area') => void;
  toggleVolume: () => void;
  toggleGrid: () => void;
  updateLatestCandle: (candle: Candle) => void;
}

export const useMarketStore = create<MarketState>((set, get) => ({
  currentSymbol: 'EURUSD',
  activeTF: 86400,
  baseTF: 86400,
  baseCandles: [],
  displayCandles: [],
  sortedTimes: [],
  isLiveConnected: false,
  isLivePaused: false,
  historyRange: 'max',
  chartType: 'Candlestick',
  showVolume: true,
  showGrid: true,

  setSymbol: (symbol) => set({ currentSymbol: symbol }),
  setTimeframe: (activeTF) => set({ activeTF }),
  setBaseCandles: (baseCandles) => {
    const sortedTimes = baseCandles.map((c) => c.time);
    set({ baseCandles, displayCandles: baseCandles, sortedTimes });
  },
  setDisplayCandles: (displayCandles) => {
    const sortedTimes = displayCandles.map((c) => c.time);
    set({ displayCandles, sortedTimes });
  },
  setLiveConnected: (isLiveConnected) => set({ isLiveConnected }),
  setLivePaused: (isLivePaused) => set({ isLivePaused }),
  setHistoryRange: (historyRange) => set({ historyRange }),
  setChartType: (chartType) => set({ chartType }),
  toggleVolume: () => set((state) => ({ showVolume: !state.showVolume })),
  toggleGrid: () => set((state) => ({ showGrid: !state.showGrid })),
  updateLatestCandle: (candle) => {
    const { baseCandles, displayCandles } = get();
    if (!baseCandles.length) return;
    const last = baseCandles[baseCandles.length - 1];
    let newBase = [...baseCandles];
    if (candle.time === last.time) {
      newBase[newBase.length - 1] = candle;
    } else if (candle.time > last.time) {
      newBase.push(candle);
    }
    set({
      baseCandles: newBase,
      displayCandles: newBase,
      sortedTimes: newBase.map((c) => c.time),
    });
  },
}));
