export type PositionType = 'LONG' | 'SHORT';
export type OrderType = 'MARKET' | 'LIMIT' | 'STOP';

export interface Position {
  id: string;
  type: PositionType;
  entry: number;
  tp: number | null;
  sl: number | null;
  size: number;
  time: number;
  closeTime?: number;
  exitPrice?: number;
  pnl?: number;
  pnlPercent?: number;
  status: 'OPEN' | 'CLOSED' | 'CANCELLED';
  closeReason?: 'TP' | 'SL' | 'MANUAL';
}

export interface TradeMetrics {
  balance: number;
  initialBalance: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  totalPnL: number;
}
