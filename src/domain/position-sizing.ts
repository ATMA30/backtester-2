/**
 * Position sizing and order validation — pure functions, no store access.
 *
 * Sizes are always expressed in **base-asset units**, so that
 * `pnl = (exit - entry) * units` holds for forex, metals, indices and crypto
 * alike. Lots are a presentation unit and are converted at the boundary via
 * `lotsToUnits` / `unitsToLots`.
 *
 * This replaces three incompatible sizing paths that previously coexisted:
 *  - `useTradeStore`: `size * 100000` whenever `entry < 200`, which multiplied
 *    DOGEUSDT/XRPUSDT/ADAUSDT positions (all quoted well under 200) by 100 000;
 *  - `ReplayBar`: a `pipValuePerLot` table (`isJpy ? 7 : 10`) whose gold branch
 *    was unreachable, because `XAUUSD` matched the `length === 6` forex test first;
 *  - a risk-based branch in `openTrade` that silently overrode the quantity the
 *    user had typed, making the QTY field cosmetic whenever a stop was set.
 */

import { PositionType } from '../types/trading';
import { getInstrument, lotsToUnits, quoteToAccountRate, unitsToLots } from './instruments';
import { ResolvedCosts, commissionFor, marketExitPrice } from './trading-costs';

/** Smallest tradable lot. Mirrors the granularity of retail brokers. */
export const MIN_LOT = 0.01;

export type OrderRejection =
  | 'NON_FINITE_PRICE'
  | 'NON_POSITIVE_PRICE'
  | 'NON_POSITIVE_SIZE'
  | 'SL_WRONG_SIDE'
  | 'TP_WRONG_SIDE'
  | 'POSITION_ALREADY_OPEN';

export const REJECTION_MESSAGES: Record<OrderRejection, string> = {
  NON_FINITE_PRICE: 'Prix invalide : la valeur saisie n’est pas un nombre exploitable.',
  NON_POSITIVE_PRICE: 'Prix invalide : le prix doit être strictement positif.',
  NON_POSITIVE_SIZE: 'Taille invalide : la quantité doit être strictement positive.',
  SL_WRONG_SIDE:
    'Stop loss du mauvais côté : il doit être sous le prix d’entrée pour un achat, au-dessus pour une vente.',
  TP_WRONG_SIDE:
    'Take profit du mauvais côté : il doit être au-dessus du prix d’entrée pour un achat, en dessous pour une vente.',
  POSITION_ALREADY_OPEN: 'Une position est déjà ouverte : fermez-la avant d’en ouvrir une autre.',
};

export interface OrderDraft {
  readonly type: PositionType;
  readonly entry: number;
  readonly sl: number | null;
  readonly tp: number | null;
  readonly sizeUnits: number;
}

export type ValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: OrderRejection };

const OK: ValidationResult = { ok: true };

function reject(reason: OrderRejection): ValidationResult {
  return { ok: false, reason };
}

/**
 * Reject orders that would corrupt the account.
 *
 * A stop placed on the wrong side is the important case: the engine closes on
 * `low <= sl` for a long, so a long stop above entry fires on the very next
 * candle and books the loss as a *profit* labelled `SL`. Previously nothing
 * checked this and the trade was accepted.
 */
export function validateOrder(draft: OrderDraft): ValidationResult {
  const { type, entry, sl, tp, sizeUnits } = draft;

  if (!Number.isFinite(entry)) return reject('NON_FINITE_PRICE');
  if (entry <= 0) return reject('NON_POSITIVE_PRICE');

  if (!Number.isFinite(sizeUnits)) return reject('NON_FINITE_PRICE');
  if (sizeUnits <= 0) return reject('NON_POSITIVE_SIZE');

  if (sl !== null) {
    if (!Number.isFinite(sl)) return reject('NON_FINITE_PRICE');
    if (sl <= 0) return reject('NON_POSITIVE_PRICE');
    const wrongSide = type === 'LONG' ? sl >= entry : sl <= entry;
    if (wrongSide) return reject('SL_WRONG_SIDE');
  }

  if (tp !== null) {
    if (!Number.isFinite(tp)) return reject('NON_FINITE_PRICE');
    if (tp <= 0) return reject('NON_POSITIVE_PRICE');
    const wrongSide = type === 'LONG' ? tp <= entry : tp >= entry;
    if (wrongSide) return reject('TP_WRONG_SIDE');
  }

  return OK;
}

/**
 * Units to trade so that hitting `sl` costs exactly `riskPercent` of `balance`.
 * Returns `null` when the inputs cannot yield a meaningful size.
 */
export function riskBasedUnits(
  balance: number,
  riskPercent: number,
  entry: number,
  sl: number | null,
  symbol?: string,
  costPerUnit = 0
): number | null {
  if (sl === null) return null;
  if (!Number.isFinite(balance) || balance <= 0) return null;
  if (!Number.isFinite(riskPercent) || riskPercent <= 0) return null;
  if (!Number.isFinite(entry) || !Number.isFinite(sl)) return null;

  const stopDistance = Math.abs(entry - sl);
  if (stopDistance <= 0) return null;

  // The stop distance is a quote-currency amount per unit; the risk budget is
  // in account currency. Without the conversion a USDJPY stop was sized ~150×
  // too small, then clamped up to the minimum lot.
  const rate = symbol ? quoteToAccountRate(symbol, sl) : 1;
  // `costPerUnit` (spread, commissions) makes "risk 1 %" mean 1 % once costs
  // are paid, not 1 % plus whatever the broker takes.
  const perUnit = stopDistance * rate + (Number.isFinite(costPerUnit) && costPerUnit > 0 ? costPerUnit : 0);
  return ((balance * riskPercent) / 100) / perUnit;
}

/**
 * Risk-based size expressed in lots, rounded to the broker's lot step.
 * This is what the QTY field displays, so the number the user sees is exactly
 * the number the engine trades.
 */
export function riskBasedLots(
  symbol: string,
  balance: number,
  riskPercent: number,
  entry: number,
  sl: number | null,
  costPerUnit = 0
): number | null {
  const units = riskBasedUnits(balance, riskPercent, entry, sl, symbol, costPerUnit);
  if (units === null) return null;
  const lots = unitsToLots(symbol, units);
  if (!Number.isFinite(lots) || lots <= 0) return null;
  return Math.max(MIN_LOT, Math.round(lots * 100) / 100);
}

/**
 * Resolve the size of an order, in units.
 *
 * Precedence is deliberate and now explicit:
 *  1. an explicit lot size always wins — the QTY field is authoritative;
 *  2. otherwise, risk-based sizing derived from the stop;
 *  3. otherwise, the account's default quantity.
 */
export function resolveSizeUnits(params: {
  readonly symbol: string;
  readonly balance: number;
  readonly riskPercent: number;
  readonly defaultQuantityLots: number;
  readonly entry: number;
  readonly sl: number | null;
  readonly explicitLots?: number | null;
}): number {
  const { symbol, balance, riskPercent, defaultQuantityLots, entry, sl, explicitLots } = params;

  // `explicitLots ?? undefined` rather than `explicitLots || …`: a caller passing
  // 0 means "zero lots" (rejected downstream), not "fall back to the default".
  if (explicitLots !== undefined && explicitLots !== null && Number.isFinite(explicitLots)) {
    return lotsToUnits(symbol, explicitLots);
  }

  // Route the risk branch through the same lot rounding the QTY field uses, so
  // the size shown and the size traded are the same number rather than differing
  // by a floating-point tail (1.085 - 1.083 is 0.0020000000000000018).
  const riskedLots = riskBasedLots(symbol, balance, riskPercent, entry, sl);
  if (riskedLots !== null) return lotsToUnits(symbol, riskedLots);

  return lotsToUnits(symbol, defaultQuantityLots);
}

/**
 * Realised PnL of a position closed at `exit`, in account currency.
 *
 * `delta × units` is an amount in the instrument's *quote* currency; `symbol`
 * converts it. Omitting the symbol assumes a USD-quoted instrument.
 */
export function computePnl(
  type: PositionType,
  entry: number,
  exit: number,
  sizeUnits: number,
  symbol?: string
): number {
  const delta = type === 'LONG' ? exit - entry : entry - exit;
  const rate = symbol ? quoteToAccountRate(symbol, exit) : 1;
  const pnl = delta * sizeUnits * rate;
  return Number.isFinite(pnl) ? pnl : 0;
}

/**
 * Share of the balance actually at risk once the size is rounded to the lot
 * step. Risk sizing rounds up to `MIN_LOT`, so on a small account or a tight
 * stop the real risk can exceed the one requested — the UI must say so.
 */
export function effectiveRiskPercent(
  symbol: string,
  balance: number,
  entry: number,
  sl: number | null,
  lots: number,
  costPerUnit = 0
): number | null {
  if (sl === null || !Number.isFinite(balance) || balance <= 0) return null;
  const units = lotsToUnits(symbol, lots);
  const loss =
    Math.abs(computePnl('LONG', entry, sl, units, symbol)) +
    (Number.isFinite(costPerUnit) && costPerUnit > 0 ? costPerUnit * units : 0);
  return Number.isFinite(loss) ? (loss / balance) * 100 : null;
}

/** Distance from entry to stop, expressed in the instrument's pips. */
export function stopDistanceInPips(symbol: string, entry: number, sl: number | null): number | null {
  if (sl === null || !Number.isFinite(entry) || !Number.isFinite(sl)) return null;
  const { pip } = getInstrument(symbol, entry);
  if (pip <= 0) return null;
  return Math.abs(entry - sl) / pip;
}

/**
 * P&L of an open position if it were closed now at market, net of costs:
 * exit on the right side of the spread, both commissions deducted. What the
 * trader would actually book — the gross figure overstated every open trade.
 */
export function netPnlAtMarket(
  position: { type: PositionType; entry: number; size: number; symbol?: string },
  symbol: string,
  bid: number,
  costs: ResolvedCosts
): number {
  const exit = marketExitPrice(position.type, bid, costs);
  return computePnl(position.type, position.entry, exit, position.size, symbol) - 2 * commissionFor(symbol, position.size, costs);
}
