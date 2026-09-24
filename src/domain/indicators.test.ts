import { describe, expect, it } from 'vitest';
import {
  computeIndicator,
  exponentialMovingAverage,
  macdLine,
  relativeStrengthIndex,
  simpleMovingAverage,
} from './indicators';
import { Candle } from '../types/market';

function series(closes: readonly number[]): Candle[] {
  return closes.map((close, i) => ({
    time: i * 60,
    open: close,
    high: close,
    low: close,
    close,
    volume: 0,
  }));
}

describe('simpleMovingAverage', () => {
  it('averages over the trailing window', () => {
    const points = simpleMovingAverage(series([1, 2, 3, 4, 5]), 3);
    expect(points.map((p) => p.value)).toEqual([2, 3, 4]);
  });

  it('emits its first point once the window is full', () => {
    const points = simpleMovingAverage(series([1, 2, 3, 4, 5]), 3);
    expect(points).toHaveLength(3);
    expect(points[0].time).toBe(120);
  });

  it('returns nothing when the series is shorter than the period', () => {
    expect(simpleMovingAverage(series([1, 2]), 5)).toEqual([]);
  });

  it('matches a naive recomputation over a long series', () => {
    // Guards the rolling-sum rewrite (previously an O(n·p) nested loop).
    const closes = Array.from({ length: 500 }, (_, i) => 100 + Math.sin(i / 7) * 10);
    const candles = series(closes);
    const period = 50;

    const rolling = simpleMovingAverage(candles, period);
    const naive: number[] = [];
    for (let i = period - 1; i < closes.length; i++) {
      let sum = 0;
      for (let k = i - period + 1; k <= i; k++) sum += closes[k];
      naive.push(sum / period);
    }

    expect(rolling).toHaveLength(naive.length);
    rolling.forEach((point, i) => expect(point.value).toBeCloseTo(naive[i], 9));
  });
});

describe('exponentialMovingAverage', () => {
  it('converges to a constant series', () => {
    const points = exponentialMovingAverage(series(Array(50).fill(42)), 10);
    expect(points[points.length - 1].value).toBeCloseTo(42, 6);
  });

  it('reacts faster than the simple average mid-transition', () => {
    // Measured 3 bars after the step: by bar 10 the SMA window holds only new
    // values and both have fully converged, so the comparison must be made
    // while the transition is still in progress.
    const closes = [...Array(30).fill(100), ...Array(3).fill(120)];
    const ema = exponentialMovingAverage(series(closes), 10);
    const sma = simpleMovingAverage(series(closes), 10);
    expect(ema[ema.length - 1].value).toBeGreaterThan(sma[sma.length - 1].value);
  });
});

describe('relativeStrengthIndex', () => {
  it('reports 100 for an unbroken advance', () => {
    // Regression: mapping a zero average loss to `rs = 100` produced 99.01.
    const points = relativeStrengthIndex(series([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 5);
    expect(points[points.length - 1].value).toBe(100);
  });

  it('reports 0 for an unbroken decline', () => {
    const points = relativeStrengthIndex(series([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]), 5);
    expect(points[points.length - 1].value).toBe(0);
  });

  it('reports the neutral 50 on a flat series', () => {
    // Regression: both averages zero also yielded 99.01.
    const points = relativeStrengthIndex(series(Array(20).fill(100)), 14);
    expect(points[points.length - 1].value).toBe(50);
  });

  it('stays within 0..100', () => {
    const closes = Array.from({ length: 200 }, (_, i) => 100 + Math.sin(i / 3) * 15);
    const points = relativeStrengthIndex(series(closes), 14);
    expect(points.every((p) => p.value >= 0 && p.value <= 100)).toBe(true);
  });

  it('returns nothing when the series is too short', () => {
    expect(relativeStrengthIndex(series([1, 2, 3]), 14)).toEqual([]);
  });
});

describe('macdLine', () => {
  it('is positive while price trends up', () => {
    const closes = Array.from({ length: 80 }, (_, i) => 100 + i);
    const points = macdLine(series(closes));
    expect(points[points.length - 1].value).toBeGreaterThan(0);
  });

  it('is ~0 on a flat series', () => {
    const points = macdLine(series(Array(80).fill(100)));
    expect(points[points.length - 1].value).toBeCloseTo(0, 6);
  });

  it('needs at least 26 candles', () => {
    expect(macdLine(series(Array(20).fill(100)))).toEqual([]);
  });
});

describe('computeIndicator', () => {
  const candles = series(Array.from({ length: 60 }, (_, i) => 100 + i));

  it('dispatches to the matching implementation', () => {
    expect(computeIndicator('SMA', candles, 10)).toEqual(simpleMovingAverage(candles, 10));
    expect(computeIndicator('EMA', candles, 10)).toEqual(exponentialMovingAverage(candles, 10));
    expect(computeIndicator('RSI', candles, 14)).toEqual(relativeStrengthIndex(candles, 14));
    expect(computeIndicator('MACD', candles, 12)).toEqual(macdLine(candles));
  });

  it('never returns non-finite values', () => {
    for (const type of ['SMA', 'EMA', 'RSI', 'MACD'] as const) {
      const points = computeIndicator(type, candles, 14);
      expect(points.every((p) => Number.isFinite(p.value) && Number.isFinite(p.time))).toBe(true);
    }
  });
});
