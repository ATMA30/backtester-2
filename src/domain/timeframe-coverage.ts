/**
 * Why a finer timeframe cannot serve the period the replay is parked on.
 *
 * The four refusals below were each announced by a one-line toast written at the
 * call site: they vanished after a few seconds, said "archives insuffisantes"
 * without naming what *was* available, and offered nothing to do next. The user
 * was left to guess how far their data actually reached.
 *
 * The diagnosis is data here, not prose: what was asked, where the replay sits,
 * which window the granularity really covers, and which timeframe is the finest
 * one that still reaches that far. The dialog renders it; the tests pin it.
 */

import { TimeframeDef } from '../types/market';
import { archiveLimitFor } from './archive-limits';
import { TIMEFRAME_DEFS } from './timeframes';

const SECONDS_PER_DAY = 86_400;

export type CoverageCause =
  /** The provider's archive does not reach back to the replay cursor. */
  | 'archive-depth'
  /** The loaded candles are coarser: there is nothing to subdivide. */
  | 'source-resolution'
  /** The feed came back, but its window does not contain the cursor. */
  | 'feed-window'
  /** The window contains the cursor, with too little history in front of it. */
  | 'not-enough-context';

export interface CoverageWindow {
  readonly fromEpoch: number;
  readonly toEpoch: number;
}

export interface TimeframeCoverage {
  readonly cause: CoverageCause;
  readonly symbol: string;
  readonly requestedSeconds: number;
  readonly requestedLabel: string;
  readonly currentSeconds: number;
  readonly currentLabel: string;
  /** Where the replay is parked, in epoch seconds. */
  readonly cutEpoch: number;
  /** How old that position is, in days. */
  readonly cutAgeDays: number;
  /** The window actually covered at the requested granularity, when known. */
  readonly window: CoverageWindow | null;
  /** Days served at that granularity, when an archive rule applies. */
  readonly availableDays: number | null;
  /** Bars of history before the cut — only for `not-enough-context`. */
  readonly contextBars: number | null;
  /** Days between the start of the window and the cursor. Null without a window. */
  readonly shortfallDays: number | null;
  /** Finest timeframe whose archive still reaches the cursor. */
  readonly finestCovering: TimeframeDef | null;
}

export interface CoverageInput {
  readonly cause: CoverageCause;
  readonly symbol: string;
  readonly requestedSeconds: number;
  readonly currentSeconds: number;
  readonly cutEpoch: number;
  readonly window?: CoverageWindow | null;
  readonly contextBars?: number | null;
  /**
   * Finest resolution the loaded data can produce, in seconds. Zero when a
   * finer feed can still be downloaded; the base resolution for a file.
   */
  readonly floorSeconds?: number;
  /** Injectable clock, in milliseconds, so the rules are testable. */
  readonly nowMs?: number;
}

/** Display label for a duration, falling back to the raw seconds. */
export function timeframeLabel(seconds: number): string {
  return TIMEFRAME_DEFS.find((d) => d.s === seconds)?.label ?? `${seconds}s`;
}

/**
 * Finest timeframe whose archive still covers a position `ageDays` old.
 *
 * `floorSeconds` is what the loaded data can actually produce. Without it the
 * dialog offered "Passer en 1h" on a file whose candles are 4H — a promise the
 * next click refused, reopening the same dialog. The archive table says how far
 * back a granularity reaches; it says nothing about whether the source can
 * produce it, and both constraints have to hold.
 *
 * `TIMEFRAME_DEFS` runs fine to coarse and `archiveLimitFor` returns null above
 * 4H, so a daily-or-coarser answer normally exists. It can still return null —
 * a nonsensical age, or a floor above every listed timeframe — and the caller
 * must handle that rather than assume.
 */
export function finestTimeframeCovering(
  ageDays: number,
  floorSeconds = 0
): TimeframeDef | null {
  if (!Number.isFinite(ageDays)) return null;
  return (
    TIMEFRAME_DEFS.find((def) => {
      if (def.s < floorSeconds) return false;
      const limit = archiveLimitFor(def.s);
      return limit === null || ageDays <= limit.maxAgeDays;
    }) ?? null
  );
}

/** Whole days between two epoch-second instants, never negative. */
export function daysBetween(fromEpoch: number, toEpoch: number): number {
  if (!Number.isFinite(fromEpoch) || !Number.isFinite(toEpoch)) return 0;
  return Math.max(0, Math.floor((toEpoch - fromEpoch) / SECONDS_PER_DAY));
}

export function describeCoverage(input: CoverageInput): TimeframeCoverage {
  const { cause, symbol, requestedSeconds, currentSeconds, cutEpoch } = input;
  const nowEpoch = Math.floor((input.nowMs ?? Date.now()) / 1000);

  const cutAgeDays = daysBetween(cutEpoch, nowEpoch);
  const limit = archiveLimitFor(requestedSeconds);
  const availableDays = limit?.maxAgeDays ?? null;

  // For an archive-depth refusal the window is the rule itself: the provider
  // serves the last `availableDays` at that granularity, nothing older.
  const window =
    input.window ??
    (cause === 'archive-depth' && availableDays !== null
      ? { fromEpoch: nowEpoch - availableDays * SECONDS_PER_DAY, toEpoch: nowEpoch }
      : null);

  return {
    cause,
    symbol,
    requestedSeconds,
    requestedLabel: timeframeLabel(requestedSeconds),
    currentSeconds,
    currentLabel: timeframeLabel(currentSeconds),
    cutEpoch,
    cutAgeDays,
    window,
    availableDays,
    contextBars: input.contextBars ?? null,
    shortfallDays: window ? daysBetween(cutEpoch, window.fromEpoch) : null,
    finestCovering: finestTimeframeCovering(cutAgeDays, input.floorSeconds ?? 0),
  };
}

/**
 * Should we offer to switch to `finestCovering`?
 *
 * Only when it is a real move: coarser than what was refused, and not the
 * timeframe the user is already on — otherwise the dialog would propose the
 * thing that just failed, or the thing already on screen.
 */
export function suggestsAlternative(coverage: TimeframeCoverage): boolean {
  const { finestCovering, requestedSeconds, currentSeconds } = coverage;
  if (!finestCovering) return false;
  return finestCovering.s > requestedSeconds && finestCovering.s !== currentSeconds;
}
