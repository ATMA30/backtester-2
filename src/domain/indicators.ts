/**
 * Technical indicators — pure functions over a close series.
 *
 * Extracted from the 190-line chart effect that computed them inline. Beyond
 * testability, the SMA was O(n·p): a nested loop re-summed the whole window for
 * every bar, so a 200-period average over a 12 000-candle series cost ~2.4M
 * operations — repeated on *every* replay tick, because `currentIndex` is in the
 * effect's dependency list. All four are now single-pass.
 */

import { Candle } from '../types/market';

export interface IndicatorPoint {
  readonly time: number;
  readonly value: number;
}

/** Standard MACD periods. The chart plots the MACD line only. */
export const MACD_FAST = 12;
export const MACD_SLOW = 26;

function isUsablePeriod(period: number, length: number): boolean {
  return Number.isFinite(period) && period >= 1 && length >= period;
}

/**
 * Simple moving average, computed with a rolling sum (O(n) instead of O(n·p)).
 */
export function simpleMovingAverage(candles: readonly Candle[], period: number): IndicatorPoint[] {
  if (!isUsablePeriod(period, candles.length)) return [];

  const points: IndicatorPoint[] = [];
  let sum = 0;

  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    if (i >= period - 1) points.push({ time: candles[i].time, value: sum / period });
  }
  return points;
}

/** Exponential moving average, seeded on the first close. */
export function exponentialMovingAverage(
  candles: readonly Candle[],
  period: number
): IndicatorPoint[] {
  if (!isUsablePeriod(period, candles.length)) return [];

  const k = 2 / (period + 1);
  const points: IndicatorPoint[] = [];
  let ema = candles[0].close;

  for (let i = 0; i < candles.length; i++) {
    ema = candles[i].close * k + ema * (1 - k);
    if (i >= period - 1) points.push({ time: candles[i].time, value: ema });
  }
  return points;
}

/**
 * Wilder's RSI.
 *
 * The previous inline version mapped a zero average loss to `rs = 100`, which
 * yields 99.01 rather than the conventional 100 — and, on a perfectly flat
 * series where both averages are zero, also 99.01 instead of the neutral 50.
 */
export function relativeStrengthIndex(candles: readonly Candle[], period: number): IndicatorPoint[] {
  if (!Number.isFinite(period) || period < 1 || candles.length <= period) return [];

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const delta = candles[i].close - candles[i - 1].close;
    if (delta >= 0) gains += delta;
    else losses -= delta;
  }

  let averageGain = gains / period;
  let averageLoss = losses / period;

  const rsiFrom = (gain: number, loss: number): number => {
    if (loss === 0) return gain === 0 ? 50 : 100;
    return 100 - 100 / (1 + gain / loss);
  };

  const points: IndicatorPoint[] = [
    { time: candles[period].time, value: rsiFrom(averageGain, averageLoss) },
  ];

  for (let i = period + 1; i < candles.length; i++) {
    const delta = candles[i].close - candles[i - 1].close;
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? -delta : 0;

    averageGain = (averageGain * (period - 1) + gain) / period;
    averageLoss = (averageLoss * (period - 1) + loss) / period;
    points.push({ time: candles[i].time, value: rsiFrom(averageGain, averageLoss) });
  }

  return points;
}

/** MACD line: EMA(12) − EMA(26), emitted once the slow EMA has warmed up. */
export function macdLine(candles: readonly Candle[]): IndicatorPoint[] {
  if (candles.length < MACD_SLOW) return [];

  const fastK = 2 / (MACD_FAST + 1);
  const slowK = 2 / (MACD_SLOW + 1);
  let fast = candles[0].close;
  let slow = candles[0].close;

  const points: IndicatorPoint[] = [];
  for (let i = 1; i < candles.length; i++) {
    const close = candles[i].close;
    fast = close * fastK + fast * (1 - fastK);
    slow = close * slowK + slow * (1 - slowK);
    if (i >= MACD_SLOW) points.push({ time: candles[i].time, value: fast - slow });
  }
  return points;
}

export type SupportedIndicator = 'SMA' | 'EMA' | 'RSI' | 'MACD' | 'BB' | 'VWAP';

/** Default period per indicator when none is configured. */
export const DEFAULT_PERIODS: Readonly<Record<SupportedIndicator, number>> = {
  SMA: 20,
  EMA: 20,
  RSI: 14,
  MACD: MACD_FAST,
  BB: 20,
  VWAP: 20,
};

/** Dispatch to the right series for an indicator kind. */
export function computeIndicator(
  type: SupportedIndicator,
  candles: readonly Candle[],
  period: number
): IndicatorPoint[] {
  switch (type) {
    case 'RSI':
      return relativeStrengthIndex(candles, period);
    case 'MACD':
      return macdLine(candles);
    case 'EMA':
      return exponentialMovingAverage(candles, period);
    // SMA is also the stand-in for BB and VWAP, which have no dedicated
    // renderer yet — same behaviour as before, now stated explicitly.
    case 'SMA':
    case 'BB':
    case 'VWAP':
      return simpleMovingAverage(candles, period);
    default:
      return [];
  }
}
