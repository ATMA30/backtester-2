/**
 * Historical USD value of the currencies that quote crosses (EURGBP → GBP,
 * GBPJPY → JPY…), for converting their P&L into the account currency.
 *
 * A fixed reference table was a few percent off, and the error moved with the
 * market: GBP at 1.27 is a 10 % mistake on a 2022 trade (1.15). The ECB series
 * gives the rate of the candle's own day. This module is only the registry —
 * pure and synchronous; `services/fxRates` fills it.
 */

interface RateSeries {
  /** Epoch seconds, ascending. */
  readonly times: readonly number[];
  /** USD value of one unit of the currency at `times[i]`. */
  readonly usdPerUnit: readonly number[];
}

const registry = new Map<string, RateSeries>();

/**
 * Time conversions are made at when the caller gives none: the replay cursor.
 * The engine processes one candle at a time, so "now" in a replay is the
 * candle being evaluated — its close is the moment a trade is booked.
 */
let clock: number | null = null;

export function setConversionClock(epochSeconds: number | null): void {
  clock = epochSeconds !== null && Number.isFinite(epochSeconds) ? epochSeconds : null;
}

export function registerUsdRates(currency: string, points: ReadonlyArray<readonly [number, number]>): void {
  const clean = points
    .filter(([t, v]) => Number.isFinite(t) && Number.isFinite(v) && v > 0)
    .slice()
    .sort((a, b) => a[0] - b[0]);
  if (clean.length === 0) return;
  registry.set(currency.toUpperCase(), {
    times: clean.map(([t]) => t),
    usdPerUnit: clean.map(([, v]) => v),
  });
}

export function hasUsdRates(currency: string): boolean {
  return registry.has(currency.toUpperCase());
}

/**
 * USD value of one unit of `currency` on the last published day at or before
 * `time` (the clock, or the latest rate, when omitted); `null` when unknown.
 */
export function usdPerUnitAt(currency: string, time: number | null = clock): number | null {
  const series = registry.get(currency.toUpperCase());
  if (!series) return null;
  const { times, usdPerUnit } = series;
  if (time === null) return usdPerUnit[usdPerUnit.length - 1];
  if (time <= times[0]) return usdPerUnit[0];

  let low = 0;
  let high = times.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (times[mid] <= time) low = mid;
    else high = mid - 1;
  }
  return usdPerUnit[low];
}

/** Test helper: forget every registered series and the clock. */
export function resetFxRates(): void {
  registry.clear();
  clock = null;
}
