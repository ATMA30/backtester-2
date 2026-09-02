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
}
