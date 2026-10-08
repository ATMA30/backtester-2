/**
 * How a displayed series changed from one render to the next, so the chart can
 * touch only what moved.
 *
 * Both rely on `ReplayAggregator`'s invariants: a finished bar stays the same
 * object from one call to the next, the last bar is a new object when it changes.
 */

import { Candle } from '../types/market';

/** Most bars a replay tick may append and still go through `series.update()`. */
export const MAX_TAIL_APPEND = 8;

/**
 * True when `next` is `prev` with only its tail changed: the last bar updated
 * and/or a few bars appended, every earlier bar being the very same object.
 *
 * That is what a replay tick produces. The chart then updates those bars
 * instead of calling `setData` on the whole series — on 500 000 candles, the
 * difference between a replay that plays and one that freezes the page.
 */
export function isTailUpdate(prev: readonly Candle[], next: readonly Candle[]): boolean {
  const p = prev.length;
  const n = next.length;
  if (p < 2 || n < p || n - p > MAX_TAIL_APPEND) return false;
  return next[0] === prev[0] && next[p - 2] === prev[p - 2];
}

/**
 * How many bars of `prev` precede the first bar of `next` (0 if none): the
 * bars the replay window dropped on the left when it slid forward, by which a
 * panned-away view must move back to stay on the same candles.
 */
export function droppedLeadingBars(prev: readonly Candle[] | null, next: readonly Candle[]): number {
  if (!prev || prev.length === 0 || next.length === 0 || prev[0] === next[0]) return 0;
  const first = next[0].time;
  let lo = 0;
  let hi = prev.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (prev[mid].time < first) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
