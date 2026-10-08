import { describe, expect, it } from 'vitest';
import { ReplayAggregator, replayWindowStart } from './replay-aggregator';
import { aggregateCandles } from './candles';
import { TimeframeSeconds } from './timeframes';

const minuteCandles = (n: number) => {
  let seed = 9;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let p = 1.1;
  return Array.from({ length: n }, (_, i) => {
    const o = p;
    const c = o + (rnd() - 0.5) * 0.001;
    p = c;
    return { time: 1_577_836_800 + i * 60, open: o, high: Math.max(o, c) + rnd() * 0.0005, low: Math.min(o, c) - rnd() * 0.0005, close: c, volume: Math.round(rnd() * 100) };
  });
};

describe('ReplayAggregator', () => {
  const base = minuteCandles(3_000);

  for (const [label, tf] of [['1m', TimeframeSeconds.M1], ['15m', TimeframeSeconds.M15], ['1h', TimeframeSeconds.H1], ['1D', TimeframeSeconds.D1]] as const) {
    it(`gives exactly the full aggregation at every step (${label})`, () => {
      const agg = new ReplayAggregator();
      // Irregular steps: one candle, several, a jump.
      for (const index of [10, 11, 12, 40, 41, 300, 301, 302, 1_999, 2_999]) {
        expect(agg.advance(base, index, tf, TimeframeSeconds.M1)).toEqual(
          aggregateCandles(base.slice(0, index + 1), tf, TimeframeSeconds.M1)
        );
      }
    });
  }

  it('keeps finished buckets as the same objects and replaces the last one', () => {
    const agg = new ReplayAggregator();
    const a = agg.advance(base, 100, TimeframeSeconds.M15, TimeframeSeconds.M1);
    const b = agg.advance(base, 101, TimeframeSeconds.M15, TimeframeSeconds.M1);
    expect(b).not.toBe(a);
    expect(b[b.length - 2]).toBe(a[a.length - 2]);
  });

  it('rebuilds when going back in time', () => {
    const agg = new ReplayAggregator();
    agg.advance(base, 500, TimeframeSeconds.H1, TimeframeSeconds.M1);
    expect(agg.advance(base, 200, TimeframeSeconds.H1, TimeframeSeconds.M1)).toEqual(
      aggregateCandles(base.slice(0, 201), TimeframeSeconds.H1, TimeframeSeconds.M1)
    );
  });

  it('hands out only the tail window, sliding in whole chunks', () => {
    const agg = new ReplayAggregator(100, 20);
    const full = (i: number) => base.slice(0, i + 1);
    // Below the window: everything.
    expect(agg.advance(base, 59, TimeframeSeconds.M1, TimeframeSeconds.M1)).toEqual(full(59));
    // 101 bars → one chunk dropped, 81 left; the same start until the next slide.
    const a = agg.advance(base, 100, TimeframeSeconds.M1, TimeframeSeconds.M1);
    expect(a).toEqual(full(100).slice(20));
    const b = agg.advance(base, 115, TimeframeSeconds.M1, TimeframeSeconds.M1);
    expect(b[0]).toBe(a[0]);
    expect(b).toEqual(full(115).slice(20));
    // 121 bars → the second chunk goes.
    expect(agg.advance(base, 120, TimeframeSeconds.M1, TimeframeSeconds.M1)).toEqual(full(120).slice(40));
  });

  it('windows the aggregated bars, not the base ones', () => {
    const agg = new ReplayAggregator(50, 10);
    const view = agg.advance(base, 2_999, TimeframeSeconds.M15, TimeframeSeconds.M1);
    const all = aggregateCandles(base, TimeframeSeconds.M15, TimeframeSeconds.M1);
    expect(view).toEqual(all.slice(replayWindowStart(all.length, 50, 10)));
    expect(view.length).toBeLessThanOrEqual(50);
    expect(view.length).toBeGreaterThan(40);
  });

  it('never moves the window start backwards while the series grows', () => {
    let previous = 0;
    for (let length = 0; length < 1_000; length++) {
      const start = replayWindowStart(length, 300, 50);
      expect(start).toBeGreaterThanOrEqual(previous);
      expect(length - start).toBeLessThanOrEqual(300);
      previous = start;
    }
  });
});
