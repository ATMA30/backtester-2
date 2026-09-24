/**
 * Candle sanitisation, timeframe detection and aggregation.
 *
 * This is the single trust boundary for OHLC data: everything entering the app
 * (network responses, imported files, IndexedDB, localStorage) must pass through
 * `sanitizeCandles` before reaching the store or the chart library.
 *
 * Previously three near-copies of this logic existed (useMarketStore,
 * services/historicalApi, netlify/functions/history) and they had already
 * diverged: two of them used `if (open <= 0) skip`, which does NOT reject NaN
 * (`NaN <= 0` is false), so non-numeric fields reached lightweight-charts as NaN
 * and blanked the chart.
 */

import { Candle } from '../types/market';
import { TimeframeSeconds } from './timeframes';

/**
 * Epoch cut-off used to tell seconds from milliseconds.
 * 2500000000s ≈ 2049-03-22; any value above that is assumed to be milliseconds.
 * Datasets reaching past 2049 in second-precision would be misread, which is an
 * acceptable trade-off for a backtester fed with historical data.
 */
const SECONDS_MS_THRESHOLD = 2_500_000_000;

export interface SanitizeOptions {
  /**
   * How to resolve two candles sharing a timestamp.
   * `'last'` (default) matches "a later record supersedes an earlier one", which
   * is what merging paginated feeds and multi-file imports expect.
   */
  readonly duplicates?: 'first' | 'last';
}

/** Shape of the untrusted rows we accept — every field is treated as unknown. */
export interface RawCandleLike {
  time?: unknown;
  open?: unknown;
  high?: unknown;
  low?: unknown;
  close?: unknown;
  volume?: unknown;
}

/** Coerce an unknown value to a finite number, or null. */
function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Normalise a raw timestamp to whole seconds, or null when unusable. */
export function normalizeEpochSeconds(value: unknown): number | null {
  const n = finite(value);
  if (n === null) return null;
  const seconds = Math.floor(n > SECONDS_MS_THRESHOLD ? n / 1000 : n);
  return seconds > 0 ? seconds : null;
}

/**
 * Validate, normalise, sort and deduplicate raw OHLC rows.
 *
 * Guarantees on the returned array — relied upon by the chart layer, which
 * throws on unsorted or duplicated timestamps:
 *  - every numeric field is finite (no NaN, no Infinity);
 *  - `close` and `open` are strictly positive;
 *  - `high >= max(open, close)` and `low <= min(open, close)`;
 *  - `volume` is a non-negative integer;
 *  - timestamps are whole seconds, strictly ascending and unique.
 *
 * Rows that cannot be repaired are dropped rather than guessed at.
 */
export function sanitizeCandles(
  rows: readonly RawCandleLike[] | null | undefined,
  options: SanitizeOptions = {}
): Candle[] {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const keep = options.duplicates ?? 'last';

  const cleaned: Candle[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;

    const time = normalizeEpochSeconds(row.time);
    if (time === null) continue;

    const close = finite(row.close);
    if (close === null || close <= 0) continue;

    const open = finite(row.open) ?? close;
    if (open <= 0) continue;

    // A missing or inconsistent wick is clamped to the body rather than dropped:
    // the body is the trustworthy part of the record.
    const high = Math.max(finite(row.high) ?? close, open, close);
    const low = Math.min(finite(row.low) ?? close, open, close);

    const volume = finite(row.volume) ?? 0;

    cleaned.push({
      time,
      open,
      high,
      low,
      close,
      volume: volume > 0 ? Math.floor(volume) : 0,
    });
  }

  if (cleaned.length === 0) return [];

  cleaned.sort((a, b) => a.time - b.time);

  const deduped: Candle[] = [];
  for (const candle of cleaned) {
    const previous = deduped[deduped.length - 1];
    if (previous && previous.time === candle.time) {
      if (keep === 'last') deduped[deduped.length - 1] = candle;
      continue;
    }
    deduped.push(candle);
  }
  return deduped;
}

/** True when the array is safe to hand to lightweight-charts. */
export function isStrictlyAscending(candles: readonly Candle[]): boolean {
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].time <= candles[i - 1].time) return false;
  }
  return true;
}

/**
 * Infer the base timeframe of a series from the modal gap between candles.
 * Samples the head of the series; gaps are snapped to the closest known timeframe
 * so that weekend and holiday holes do not skew the result.
 */
export function detectBaseTF(
  candles: readonly Candle[],
  knownTimeframes: readonly number[]
): number {
  if (!candles || candles.length < 2 || knownTimeframes.length === 0) {
    return TimeframeSeconds.D1;
  }

  const counts = new Map<number, number>();
  const sampleLimit = Math.min(200, candles.length);

  for (let i = 1; i < sampleLimit; i++) {
    const delta = candles[i].time - candles[i - 1].time;
    if (delta <= 0) continue;

    let closest = knownTimeframes[0];
    let minDiff = Math.abs(delta - closest);
    for (const tf of knownTimeframes) {
      const diff = Math.abs(delta - tf);
      if (diff < minDiff) {
        minDiff = diff;
        closest = tf;
      }
    }
    counts.set(closest, (counts.get(closest) ?? 0) + 1);
  }

  let bestTF: number = TimeframeSeconds.D1;
  let maxCount = 0;
  for (const [tf, count] of counts) {
    if (count > maxCount) {
      maxCount = count;
      bestTF = tf;
    }
  }
  return bestTF;
}

/**
 * Start of the calendar bucket containing `epochSeconds` for a given timeframe.
 * Daily, weekly (ISO, Monday-anchored) and monthly buckets follow the UTC
 * calendar; everything below uses a fixed modulo grid.
 */
export function getCalendarBucket(epochSeconds: number, targetTF: number): number {
  if (targetTF === TimeframeSeconds.D1) {
    const d = new Date(epochSeconds * 1000);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000;
  }
  if (targetTF === TimeframeSeconds.W1) {
    const d = new Date(epochSeconds * 1000);
    const weekday = d.getUTCDay();
    const daysSinceMonday = weekday === 0 ? 6 : weekday - 1;
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - daysSinceMonday) / 1000;
  }
  if (targetTF === TimeframeSeconds.MN1) {
    const d = new Date(epochSeconds * 1000);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
  }
  return Math.floor(epochSeconds / targetTF) * targetTF;
}

/**
 * Roll `candles` up to `targetTF`.
 *
 * Returns a defensive copy when no aggregation applies, so callers can never
 * mutate the source series through the result.
 *
 * Note: high/low are folded with a loop rather than `Math.max(...group)`; the
 * spread form throws `RangeError: Maximum call stack size exceeded` once a
 * bucket holds more than ~65k candles (e.g. monthly buckets over 1-minute data).
 */
export function aggregateCandles(
  candles: readonly Candle[],
  targetTF: number,
  baseTF: number
): Candle[] {
  if (!candles.length) return [];
  if (!Number.isFinite(targetTF) || targetTF <= 0) return candles.slice();
  if (targetTF <= baseTF) return candles.slice();

  const buckets = new Map<number, Candle>();

  for (const candle of candles) {
    const bucket = getCalendarBucket(candle.time, targetTF);
    const existing = buckets.get(bucket);

    if (!existing) {
      buckets.set(bucket, {
        time: bucket,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      });
      continue;
    }

    // `candles` is sorted, so the last write wins for `close`.
    if (candle.high > existing.high) existing.high = candle.high;
    if (candle.low < existing.low) existing.low = candle.low;
    existing.close = candle.close;
    existing.volume += candle.volume;
  }

  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

/**
 * Index of the first candle at or after `epochSeconds`, or `-1`.
 *
 * `candles` must be sorted (guaranteed by `sanitizeCandles`). The chart's hover
 * handler ran a linear `findIndex` on every mousemove over up to 12 000 candles;
 * this is O(log n).
 */
export function indexAtOrAfter(candles: readonly Candle[], epochSeconds: number): number {
  let low = 0;
  let high = candles.length - 1;
  let found = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (candles[mid].time >= epochSeconds) {
      found = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  return found;
}

/**
 * True dès qu'au moins une bougie porte un volume exploitable.
 *
 * Toutes les sources n'en publient pas : la BCE (Frankfurter) diffuse des cours
 * de référence quotidiens sans volume, et Deriv n'en publie pas pour ses indices
 * synthétiques. Le code fabriquait autrefois un chiffre plausible à leur place,
 * ce qui rendait une invention indiscernable d'un volume de marché ; il vaut
 * zéro désormais, et l'interface doit savoir ne pas réserver de place pour un
 * histogramme vide.
 */
export function seriesHasVolume(candles: readonly Candle[]): boolean {
  for (const candle of candles) {
    if (candle.volume > 0) return true;
  }
  return false;
}

/**
 * True when a series carries closes only: every wick glued to the body.
 *
 * That is what the ECB publishes (one reference rate per day). Such series used
 * to be cached as the daily forex history, and a session restore would serve
 * them forever. Judged on the most recent candles, which a real feed always
 * gives wicks to; a handful of doji-like bars does not trip it.
 */
export function isClosesOnlySeries(candles: readonly Candle[], sample = 300): boolean {
  const tail = candles.slice(-sample);
  if (tail.length < 20) return false;
  let glued = 0;
  for (const c of tail) {
    if (c.high === Math.max(c.open, c.close) && c.low === Math.min(c.open, c.close)) glued++;
  }
  return glued / tail.length > 0.95;
}
