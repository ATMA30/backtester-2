import { Candle } from '../types/market';
import { aggregateCandles, getCalendarBucket } from './candles';

/**
 * Incremental view of `base[0..index]` rolled up to `targetTF`.
 *
 * The replay used to rebuild that view from scratch on every candle: slice the
 * whole prefix, aggregate it, and hand the result to the chart, which rebuilt
 * every point in turn. On 500 000 one-minute candles at 32×, the replay moved
 * 0.6 candles a second instead of 50, with the main thread blocked 8 s out of
 * 10. Moving forward now only folds the new base candles into the last bucket
 * or appends a new one.
 *
 * Invariants relied upon by the chart's incremental path:
 *  - every bucket except the last is the *same object* from one call to the
 *    next (a finished bucket is never touched again);
 *  - the last bucket is a *new object* whenever it changes.
 * Anything else (going back, another series or timeframe) rebuilds from scratch.
 *
 * Only the last `window` bars are handed out. lightweight-charts 4 rebuilds its
 * array of drawn points on every `series.update()`, so each tick costs time in
 * proportion to the length of the series, whatever we do on our side: 2.8
 * candles a second at 500 000 bars, 33 at 50 000. The window slides forward in
 * whole `chunk`s, so between two slides its first bar stays the same object and
 * the chart keeps its incremental path; a slide costs one full `setData`.
 */
export const REPLAY_WINDOW_BARS = 20_000;
export const REPLAY_WINDOW_CHUNK = 2_000;

/**
 * Index of the first bar shown out of `length`. It only moves in whole chunks,
 * and depends on nothing but `length`, so it never goes back while playing.
 * The window therefore holds between `window - chunk` and `window` bars.
 */
export function replayWindowStart(length: number, window: number, chunk: number): number {
  const excess = length - window;
  return excess <= 0 ? 0 : Math.ceil(excess / chunk) * chunk;
}

export class ReplayAggregator {
  private base: readonly Candle[] | null = null;
  private targetTF = 0;
  private baseTF = 0;
  private index = -1;
  private view: Candle[] = [];

  constructor(
    private readonly window = REPLAY_WINDOW_BARS,
    private readonly chunk = REPLAY_WINDOW_CHUNK
  ) {}

  /** The last `window` bars of `base[0..index]` aggregated, as a fresh array. */
  advance(base: readonly Candle[], index: number, targetTF: number, baseTF: number): Candle[] {
    const reusable =
      base === this.base && targetTF === this.targetTF && baseTF === this.baseTF && index >= this.index;

    if (!reusable) {
      this.base = base;
      this.targetTF = targetTF;
      this.baseTF = baseTF;
      this.index = index;
      const prefix = base.slice(0, index + 1);
      const aggregated = aggregateCandles(prefix, targetTF, baseTF);
      this.view = aggregated.length > 0 ? aggregated : prefix;
      return this.visible();
    }

    const aggregating = targetTF > baseTF;
    for (let i = this.index + 1; i <= index; i++) {
      const candle = base[i];
      if (!aggregating) {
        this.view.push(candle);
        continue;
      }
      const bucket = getCalendarBucket(candle.time, targetTF);
      const last = this.view[this.view.length - 1];
      if (last && last.time === bucket) {
        this.view[this.view.length - 1] = {
          time: last.time,
          open: last.open,
          high: candle.high > last.high ? candle.high : last.high,
          low: candle.low < last.low ? candle.low : last.low,
          close: candle.close,
          volume: last.volume + candle.volume,
        };
      } else {
        this.view.push({ time: bucket, open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume });
      }
    }
    this.index = index;
    return this.visible();
  }

  /**
   * A new array for the store (its identity signals the change), sharing every
   * candle object with the previous one.
   */
  private visible(): Candle[] {
    return this.view.slice(replayWindowStart(this.view.length, this.window, this.chunk));
  }

  reset(): void {
    this.base = null;
    this.index = -1;
    this.view = [];
  }
}
