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

/**
 * Provider-facing interval label (`'1m'`, `'4h'`, `'1d'`, …) for a duration.
 * Falls back to the daily label, which every provider supports.
 */
export function intervalLabelFor(seconds: number): string {
  return TIMEFRAME_DEFS.find((d) => d.s === seconds)?.label.toLowerCase() ?? '1d';
}

/** Duration in seconds for a provider interval label. */
export function secondsForInterval(label: string): number {
  const normalized = label.trim().toLowerCase();
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
