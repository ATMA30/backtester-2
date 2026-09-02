export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type TimeframeType = 's' | 'm' | 'h' | 'd' | 'w' | 'mo';

export interface TimeframeDef {
  s: number;
  label: string;
  tfType: TimeframeType;
}

export interface MarketPair {
  symbol: string;
  label: string;
  category: 'Forex Majors' | 'Forex Minors' | 'Forex Exotics' | 'Métaux & Matières' | 'Indices Mondiaux' | 'Indices Synthétiques (Deriv)' | 'Crypto';
  decimals: number;
  pip: number;
  derivSymbol?: string;
  binanceSymbol?: string;
}

export interface DatasetMeta {
  id?: number;
  symbol: string;
  name: string;
  candlesCount: number;
  baseTF: number;
  createdAt: number;
  timeRange: string;
  data?: Candle[];
}

export interface ActiveIndicator {
  id: string;
  type: 'SMA' | 'EMA' | 'RSI' | 'MACD' | 'BB' | 'VWAP';
  period: number;
  color: string;
  series?: any;
}

export interface ForexSessionConfig {
  sydney: boolean;
  tokyo: boolean;
  london: boolean;
  newyork: boolean;
  useLocalTz: boolean;
}

export type SeparatorTF = '1D' | '1W' | '1M' | '3M' | '1Y' | null;
