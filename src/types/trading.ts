export type PositionType = 'LONG' | 'SHORT';
export type OrderType = 'MARKET' | 'LIMIT' | 'STOP';

/**
 * An executed or executing position.
 *
 * `size` is expressed in **base-asset units**, never in lots, so that
 * `pnl = (exit - entry) * size` holds for every asset class. Use
 * `unitsToLots(symbol, size)` from `domain/instruments` for display.
 */
export interface Position {
  id: string;
  /**
   * Instrument the position was opened on. Required for sizing and formatting;
   * optional in the type only so that sessions saved before it existed still
   * deserialise.
   */
  symbol?: string;
  type: PositionType;
  entry: number;
  tp: number | null;
  sl: number | null;
  /** Size in base-asset units (see note above). */
  size: number;
  time: number;
  /**
   * Time of the last candle the stop/target engine evaluated this position
   * against. A candle at or before it is ignored, so stepping backwards,
   * switching timeframe or re-rendering can never close a position on a candle
   * that precedes its entry or was already processed. Defaults to `time`.
   */
  lastCheckedTime?: number;
  /**
   * Amount lost at the stop when the position opened, in account currency.
   * Frozen at entry — moving the stop to breakeven must not change what the
   * trade was risking — and used to express results in R. Absent without a stop.
   */
  riskAmount?: number;
  /**
   * Trading costs in account currency: spread and slippage paid so far, plus
   * commissions once closed. Informative — spread and slippage are already in
   * the entry and exit prices, commissions are already deducted from `pnl`.
   */
  fees?: number;
  closeTime?: number;
  exitPrice?: number;
  pnl?: number;
  pnlPercent?: number;
  status: 'OPEN' | 'CLOSED' | 'CANCELLED';
  closeReason?: 'TP' | 'SL' | 'MANUAL';
}

export interface PendingOrder {
  id: string;
  /** Instrument the order was placed on. See `Position.symbol`. */
  symbol?: string;
  type: PositionType;
  orderType: 'LIMIT' | 'STOP';
  targetPrice: number;
  sl: number | null;
  tp: number | null;
  /** Size in base-asset units. */
  size: number;
  time: number;
  /** See `Position.lastCheckedTime`. Defaults to `time`. */
  lastCheckedTime?: number;
}

export interface TradeMetrics {
  balance: number;
  initialBalance: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  /** Gross profit / gross loss. `Infinity` when there are profits and no losses. */
  profitFactor: number;
  /** Peak-to-trough equity decline, in percent. */
  maxDrawdown: number;
  totalPnL: number;
  /** Mean P&L per trade, in account currency. 0 without trades. */
  expectancy: number;
  /** Mean winning trade. 0 without wins. */
  averageWin: number;
  /** Mean losing trade, as a positive amount. 0 without losses. */
  averageLoss: number;
  /** Mean result in R over the trades that had a stop, or `null` if none did. */
  averageR: number | null;
  /** Spread, slippage and commissions paid on closed trades. */
  totalFees: number;
}
