import { describe, expect, it } from 'vitest';
import {
  isClosesOnlySeries,
  aggregateCandles,
  detectBaseTF,
  indexAtOrAfter,
  isStrictlyAscending,
  normalizeEpochSeconds,
  sanitizeCandles,
  seriesHasVolume,
} from './candles';
import { TIMEFRAME_VALUES, TimeframeSeconds } from './timeframes';
import { Candle } from '../types/market';

const DAY = TimeframeSeconds.D1;

function candle(time: number, close: number, extra: Partial<Candle> = {}): Candle {
  return { time, open: close, high: close, low: close, close, volume: 0, ...extra };
}

describe('normalizeEpochSeconds', () => {
  it('keeps second precision as-is', () => {
    expect(normalizeEpochSeconds(1_700_000_000)).toBe(1_700_000_000);
  });

  it('converts millisecond timestamps', () => {
    expect(normalizeEpochSeconds(1_700_000_000_000)).toBe(1_700_000_000);
  });

  it('rejects values that are not usable timestamps', () => {
    expect(normalizeEpochSeconds(0)).toBeNull();
    expect(normalizeEpochSeconds(-5)).toBeNull();
    expect(normalizeEpochSeconds('nope')).toBeNull();
    expect(normalizeEpochSeconds(Number.NaN)).toBeNull();
    expect(normalizeEpochSeconds(undefined)).toBeNull();
  });
});

describe('sanitizeCandles', () => {
  it('drops rows whose prices are not finite', () => {
    // Regression: `if (open <= 0) continue` does not reject NaN, so non-numeric
    // fields used to reach lightweight-charts and blank the chart.
    const result = sanitizeCandles([
      { time: 1, open: 'abc', high: 2, low: 1, close: 1.5 },
      { time: 2, open: 1, high: 2, low: 1, close: Number.NaN },
      { time: 3, open: 1, high: 2, low: 1, close: Number.POSITIVE_INFINITY },
      { time: 4, open: 1, high: 2, low: 0.5, close: 1.5 },
    ]);

    expect(result).toHaveLength(2);
    expect(result.every((c) => Number.isFinite(c.open) && Number.isFinite(c.close))).toBe(true);
  });

  it('rejects non-positive prices', () => {
    expect(sanitizeCandles([{ time: 1, open: 0, high: 0, low: 0, close: 0 }])).toEqual([]);
    expect(sanitizeCandles([{ time: 1, open: -1, high: 1, low: -2, close: -1 }])).toEqual([]);
  });

  it('repairs wicks that contradict the body', () => {
    const [c] = sanitizeCandles([{ time: 1, open: 10, high: 5, low: 20, close: 12 }]);
    expect(c.high).toBe(12);
    expect(c.low).toBe(10);
  });

  it('sorts and deduplicates, keeping the last record for a timestamp', () => {
    const result = sanitizeCandles([
      { time: 3, open: 1, high: 1, low: 1, close: 3 },
      { time: 1, open: 1, high: 1, low: 1, close: 1 },
      { time: 3, open: 1, high: 1, low: 1, close: 99 },
    ]);

    expect(result.map((c) => c.time)).toEqual([1, 3]);
    expect(result[1].close).toBe(99);
    expect(isStrictlyAscending(result)).toBe(true);
  });

  it('normalises millisecond timestamps mixed into a series', () => {
    const result = sanitizeCandles([
      { time: 1_700_000_000_000, open: 1, high: 1, low: 1, close: 1 },
      { time: 1_700_000_060, open: 1, high: 1, low: 1, close: 1 },
    ]);
    expect(result.map((c) => c.time)).toEqual([1_700_000_000, 1_700_000_060]);
  });

  it('never returns a negative volume', () => {
    const [c] = sanitizeCandles([{ time: 1, open: 1, high: 1, low: 1, close: 1, volume: -50 }]);
    expect(c.volume).toBe(0);
  });
});

describe('aggregateCandles', () => {
  it('rolls candles up to the target timeframe', () => {
    const hour = TimeframeSeconds.H1;
    const base = [
      candle(0, 10, { open: 10, high: 12, low: 9 }),
      candle(hour, 11, { open: 11, high: 15, low: 8 }),
      candle(hour * 2, 13, { open: 13, high: 14, low: 12 }),
      candle(hour * 3, 12, { open: 12, high: 13, low: 7 }),
    ].map((c) => ({ ...c, volume: 100 }));

    const [bar] = aggregateCandles(base, TimeframeSeconds.H4, hour);
    expect(bar.open).toBe(10);
    expect(bar.high).toBe(15);
    expect(bar.low).toBe(7);
    expect(bar.close).toBe(12);
    expect(bar.volume).toBe(400);
  });

  it('returns a defensive copy when no aggregation applies', () => {
    const base = [candle(0, 1)];
    const result = aggregateCandles(base, TimeframeSeconds.H1, DAY);
    expect(result).toEqual(base);
    expect(result).not.toBe(base);
  });

  it('handles buckets larger than the JS argument limit', () => {
    // Regression: `Math.max(...group)` throws RangeError past ~65k elements.
    const minute = TimeframeSeconds.M1;
    const base: Candle[] = [];
    for (let i = 0; i < 120_000; i++) base.push(candle(i * minute, 1 + (i % 7)));

    expect(() => aggregateCandles(base, TimeframeSeconds.MN1, minute)).not.toThrow();
    const rolled = aggregateCandles(base, TimeframeSeconds.MN1, minute);
    expect(rolled.length).toBeGreaterThan(0);
    expect(rolled.every((c) => Number.isFinite(c.high) && Number.isFinite(c.low))).toBe(true);
  });

  it('anchors weekly buckets on Monday', () => {
    // 2024-01-03 is a Wednesday; its week starts Monday 2024-01-01.
    const wednesday = Math.floor(Date.UTC(2024, 0, 3) / 1000);
    const [week] = aggregateCandles([candle(wednesday, 1)], TimeframeSeconds.W1, DAY);
    expect(new Date(week.time * 1000).toISOString().slice(0, 10)).toBe('2024-01-01');
  });
});

describe('detectBaseTF', () => {
  it('infers the modal gap between candles', () => {
    const hour = TimeframeSeconds.H1;
    const series = Array.from({ length: 30 }, (_, i) => candle(i * hour, 1));
    expect(detectBaseTF(series, TIMEFRAME_VALUES)).toBe(hour);
  });

  it('falls back to daily for a series too short to infer', () => {
    expect(detectBaseTF([candle(0, 1)], TIMEFRAME_VALUES)).toBe(DAY);
  });

  it('is not skewed by weekend gaps', () => {
    // Daily bars with a two-day hole every five entries.
    const times: number[] = [];
    let t = 0;
    for (let i = 0; i < 40; i++) {
      times.push(t);
      t += i % 5 === 4 ? DAY * 3 : DAY;
    }
    expect(detectBaseTF(times.map((time) => candle(time, 1)), TIMEFRAME_VALUES)).toBe(DAY);
  });
});

describe('indexAtOrAfter', () => {
  const series = [10, 20, 30, 40].map((t) => candle(t, 1));

  it('finds the first candle at or after a time', () => {
    expect(indexAtOrAfter(series, 10)).toBe(0);
    expect(indexAtOrAfter(series, 25)).toBe(2);
    expect(indexAtOrAfter(series, 40)).toBe(3);
  });

  it('returns -1 past the end', () => {
    expect(indexAtOrAfter(series, 41)).toBe(-1);
  });

  it('returns the first index for a time before the series', () => {
    expect(indexAtOrAfter(series, 0)).toBe(0);
  });
});

describe('seriesHasVolume', () => {
  it('détecte une série sans aucun volume', () => {
    // Cas réel : la BCE publie des cours de référence sans volume, et Deriv
    // n'en publie pas pour ses indices synthétiques.
    const series = [candle(0, 1), candle(DAY, 1.1), candle(DAY * 2, 1.2)];
    expect(seriesHasVolume(series)).toBe(false);
  });

  it('détecte un volume dès la première bougie qui en porte', () => {
    const series = [candle(0, 1), candle(DAY, 1.1, { volume: 4200 })];
    expect(seriesHasVolume(series)).toBe(true);
  });

  it('ignore les volumes nuls', () => {
    expect(seriesHasVolume([candle(0, 1, { volume: 0 })])).toBe(false);
  });

  it('gère une série vide', () => {
    expect(seriesHasVolume([])).toBe(false);
  });
});

describe('isClosesOnlySeries', () => {
  const candle = (t: number, wick: boolean) => ({
    time: t, open: 1, close: 1.1, high: wick ? 1.2 : 1.1, low: wick ? 0.9 : 1, volume: 0,
  });

  it('flags a series whose wicks are all glued to the body', () => {
    expect(isClosesOnlySeries(Array.from({ length: 50 }, (_, i) => candle(i, false)))).toBe(true);
  });

  it('accepts a real series with a few doji-like bars', () => {
    const series = Array.from({ length: 50 }, (_, i) => candle(i, i % 10 !== 0));
    expect(isClosesOnlySeries(series)).toBe(false);
  });
});
