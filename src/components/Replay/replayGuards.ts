import { useTradeStore } from '../../store/useTradeStore';
import { useReplayStore } from '../../store/useReplayStore';
import { useUIStore } from '../../store/useUIStore';
import { useMarketStore } from '../../store/useMarketStore';

/**
 * Guards shared by every path that moves or leaves the replay cursor.
 *
 * Five places can relocate the cursor (chart click, date prompt, random start,
 * session start, leaving the replay) and each one used to do it regardless of
 * the account. With a position open, a jump skipped every candle in between —
 * the stop could be blown through unseen — and leaving the replay hid the only
 * buttons able to close it. A single guard keeps the rule in one place.
 */

/** True when the account has a position or a pending order. */
export function hasOpenTrading(): boolean {
  const { activePosition, pendingOrders } = useTradeStore.getState();
  return activePosition !== null || pendingOrders.length > 0;
}

/**
 * Refuse a cursor relocation while trading is open, and say why.
 * @returns `true` when the action must NOT proceed.
 */
export function blockRelocationWhileTrading(action: string): boolean {
  if (!hasOpenTrading()) return false;
  useUIStore
    .getState()
    .showToast(
      `${action} impossible : une position ou un ordre est en cours. Fermez la position et annulez les ordres d’abord.`,
      'warning',
      6000
    );
  return true;
}

/**
 * Refuse an order action while the user is looking at candles they have
 * already gone past.
 *
 * Stepping back to review is useful; trading there is lookahead — the user has
 * already seen what follows. @returns `true` when the action must NOT proceed.
 */
export function blockTradingInThePast(): boolean {
  const { currentIndex, furthestIndex } = useReplayStore.getState();
  if (currentIndex >= furthestIndex) return false;
  useUIStore
    .getState()
    .showToast(
      `Vous revoyez une bougie déjà dépassée : vous connaissez la suite. Revenez à la bougie la plus récente (→) pour trader.`,
      'warning',
      6000
    );
  return true;
}

/**
 * The candle the trader is looking at: the replay cursor's base candle, or the
 * last loaded candle outside a replay. Any manual close must use its price and
 * time — `closePosition('MANUAL')` without them fell back to the entry price
 * (a P&L of exactly zero) and to the wall clock.
 */
export function currentTradingCandle(): { close: number; time: number } | null {
  const { isActive, currentIndex } = useReplayStore.getState();
  const { baseCandles } = useMarketStore.getState();
  const candle = isActive ? baseCandles[currentIndex] : baseCandles[baseCandles.length - 1];
  return candle ? { close: candle.close, time: candle.time } : null;
}
