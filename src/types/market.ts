import { Position, PendingOrder } from './trading';
import { Drawing } from './drawing';
import type { MarketCategory } from '../domain/instruments';

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
  category: MarketCategory;
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
  /**
   * Where the candles came from. A user's imported file cannot be downloaded
   * again, a provider series can: the cache must never let the second replace
   * the first. Absent on records written before the field existed.
   */
  source?: 'import' | 'provider';
}

export type IndicatorKind = 'SMA' | 'EMA' | 'RSI' | 'MACD' | 'BB' | 'VWAP';

export interface ActiveIndicator {
  id: string;
  type: IndicatorKind;
  period: number;
  color: string;
  /**
   * Live lightweight-charts series handle, owned by TradingChart.
   * Never persisted (see the settings subscription in useMarketStore) and never
   * read outside the chart layer — hence `unknown` rather than `any`.
   */
  series?: unknown;
}

export interface ForexSessionConfig {
  // Sessions majeures
  sydney: boolean;
  tokyo: boolean;
  london: boolean;
  newyork: boolean;
  // Killzones ICT / SMC
  asianRange: boolean;
  londonOpenKZ: boolean;
  nyOpenKZ: boolean;
  londonCloseKZ: boolean;
  // Options d'affichage
  showHighLow: boolean;
  showLabels: boolean;
  useLocalTz: boolean;
}

export interface BacktestSession {
  id: string;
  name: string;
  symbol: string;
  baseTF: number;
  activeTF: number;
  createdAt: number;
  updatedAt: number;

  // Replay State
  replayIndex: number;
  replayActive: boolean;

  // Trading State
  balance: number;
  initialBalance: number;
  riskPercent: number;
  quantity: number;
  closedPositions: Position[];
  activePosition: Position | null;
  pendingOrders: PendingOrder[];

  // Drawings State
  drawings: Drawing[];

  // Data & Metrics
  candlesCount: number;
  timeRange?: string;
  winRate?: number;
  totalPnL?: number;
  totalTrades?: number;
  data?: Candle[];
}

export type SeparatorTF = '1D' | '1W' | '1M' | '3M' | '1Y' | null;
