/**
 * Timeframe vocabulary shared by the store, the replay engine and the data
 * providers. Durations are always expressed in seconds.
 */

import { TimeframeDef } from '../types/market';

/** Named durations, so the codebase stops sprinkling 86400 / 14400 literals. */
export const TimeframeSeconds = {
  M1: 60,
  M3: 180,
  M5: 300,
  M15: 900,
  M30: 1_800,
  H1: 3_600,
  H2: 7_200,
  H4: 14_400,
  D1: 86_400,
  W1: 604_800,
  MN1: 2_592_000,
} as const;

export type TimeframeSecondsValue = (typeof TimeframeSeconds)[keyof typeof TimeframeSeconds];

export const TIMEFRAME_DEFS: readonly TimeframeDef[] = [
  { s: TimeframeSeconds.M1, label: '1m', tfType: 'm' },
  { s: TimeframeSeconds.M3, label: '3m', tfType: 'm' },
  { s: TimeframeSeconds.M5, label: '5m', tfType: 'm' },
  { s: TimeframeSeconds.M15, label: '15m', tfType: 'm' },
  { s: TimeframeSeconds.M30, label: '30m', tfType: 'm' },
  { s: TimeframeSeconds.H1, label: '1h', tfType: 'h' },
  { s: TimeframeSeconds.H2, label: '2h', tfType: 'h' },
  { s: TimeframeSeconds.H4, label: '4h', tfType: 'h' },
  { s: TimeframeSeconds.D1, label: '1D', tfType: 'd' },
  { s: TimeframeSeconds.W1, label: '1W', tfType: 'w' },
  { s: TimeframeSeconds.MN1, label: '1M', tfType: 'mo' },
];

export const TIMEFRAME_VALUES: readonly number[] = TIMEFRAME_DEFS.map((d) => d.s);

export interface DownloadableBase {
  readonly baseSeconds: number;
  readonly interval: string;
}

/**
 * Returns the underlying downloadable base interval and duration for any
 * requested timeframe.
 *
 * Forex/crypto/index providers (Dukascopy, Yahoo, ECB, Binance) only serve
 * specific native granularities ('1m', '5m', '15m', '30m', '1h', '1d').
 * Non-native timeframes (3m, 2h, 4h, 1W, 1M) are aggregated client-side
 * from their respective native base (1m for 3m; 1h for 2h & 4h; 1d for 1W & 1M).
 */
export function getDownloadableBaseTF(requestedSeconds: number): DownloadableBase {
  if (requestedSeconds <= TimeframeSeconds.M3) {
    return { baseSeconds: TimeframeSeconds.M1, interval: '1m' };
  }
  if (requestedSeconds <= TimeframeSeconds.M5) {
    return { baseSeconds: TimeframeSeconds.M5, interval: '5m' };
  }
  if (requestedSeconds <= TimeframeSeconds.M15) {
    return { baseSeconds: TimeframeSeconds.M15, interval: '15m' };
  }
  if (requestedSeconds <= TimeframeSeconds.M30) {
    return { baseSeconds: TimeframeSeconds.M30, interval: '30m' };
  }
  if (requestedSeconds <= TimeframeSeconds.H4) {
    return { baseSeconds: TimeframeSeconds.H1, interval: '1h' };
  }
  return { baseSeconds: TimeframeSeconds.D1, interval: '1d' };
}

/**
 * Provider-facing interval label (`'1m'`, `'4h'`, `'1d'`, …) for a duration.
 * Falls back to the daily label, which every provider supports.
 */
export function intervalLabelFor(seconds: number): string {
  if (seconds === TimeframeSeconds.MN1) return '1mo';
  if (seconds === TimeframeSeconds.W1) return '1wk';
  return TIMEFRAME_DEFS.find((d) => d.s === seconds)?.label.toLowerCase() ?? '1d';
}

/** Duration in seconds for a provider interval label. */
export function secondsForInterval(label: string): number {
  const normalized = label.trim().toLowerCase();
  if (normalized === '1mo' || normalized === '1mth' || normalized === '1month') return TimeframeSeconds.MN1;
  if (normalized === '1w' || normalized === '1wk' || normalized === '1week') return TimeframeSeconds.W1;
  if (normalized === '1d' || normalized === '1day') return TimeframeSeconds.D1;
  if (normalized === '4h') return TimeframeSeconds.H4;
  if (normalized === '2h') return TimeframeSeconds.H2;
  if (normalized === '1h' || normalized === '60m') return TimeframeSeconds.H1;
  if (normalized === '30m') return TimeframeSeconds.M30;
  if (normalized === '15m') return TimeframeSeconds.M15;
  if (normalized === '5m') return TimeframeSeconds.M5;
  if (normalized === '3m') return TimeframeSeconds.M3;
  if (normalized === '1m') return TimeframeSeconds.M1;
  const match = TIMEFRAME_DEFS.find((d) => d.label.toLowerCase() === normalized);
  return match?.s ?? TimeframeSeconds.D1;
}

/** True when `seconds` is one of the timeframes the app can display. */
export function isKnownTimeframe(seconds: number): boolean {
  return TIMEFRAME_VALUES.includes(seconds);
}

/**
 * Unité de temps la plus large pour laquelle les séances de marché ont un sens.
 *
 * Une bougie journalière couvre toutes les séances à la fois : on ne peut pas
 * dire qu'elle « appartient » à la killzone de Londres. Au-delà de cette
 * limite, l'affichage des séances est masqué — le contrôle doit donc le dire
 * plutôt que de rester sans effet.
 */
export const SESSIONS_MAX_TIMEFRAME: number = TimeframeSeconds.H1;

/** True quand les séances de marché sont exploitables à cette granularité. */
export function supportsSessions(timeframeSeconds: number): boolean {
  return Number.isFinite(timeframeSeconds) && timeframeSeconds > 0 && timeframeSeconds <= SESSIONS_MAX_TIMEFRAME;
}
