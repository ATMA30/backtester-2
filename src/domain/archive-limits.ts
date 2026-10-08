/**
 * How far back each intraday feed actually reaches.
 *
 * Switching timeframe while a replay is anchored on an old date only works if
 * the provider still serves that date at the requested granularity. This used
 * to be five near-identical `if` blocks inside a JSX `onClick`, each repeating
 * the same shape with different numbers and a hand-written sentence — a data
 * table written as control flow, impossible to test and easy to let drift.
 */

import { TimeframeSeconds } from './timeframes';

/**
 * Days of history the server fetches from Dukascopy per interval — the single
 * source for both what `/api/history` downloads and what the UI promises.
 *
 * They were two separate tables: the UI announced five years of hourly
 * archives, which only the dev server delivered. Production now runs the same
 * provider, inside a serverless function cut at 10 s, with a 5.5 s budget for
 * this source. Measured with the server's settings (batches of 20, 250 ms
 * apart): 1m/30 d 0.5 s, 5m/60 d 1.3 s, 15m/120 d 2.0 s, 1h/3 y 0.5 s — but
 * 30m/240 d took 6.2 s, hence 180 days. Changing a value here changes both
 * sides at once.
 */
export const DUKASCOPY_SPAN_DAYS: Readonly<Record<string, number>> = {
  '1m': 30,
  '5m': 60,
  '15m': 120,
  '30m': 180,
  '1h': 1_095,
  '4h': 1_095,
};

/**
 * First day of Dukascopy daily candles the server asks for.
 *
 * It was 2008, an arbitrary cut: everything before was filled with ECB closes —
 * no wicks, no volume — although Dukascopy publishes real daily OHLC with volume
 * from 1990–1991 for the major pairs (measured: EURUSD from 1991-01-02 in 0.7 s,
 * USDCHF from 1990). Asking from 1990 returns whatever each instrument has.
 */
export const DUKASCOPY_DAILY_FROM = '1990-01-01';

const years = (days: number): number => Math.round(days / 365);

export interface ArchiveLimit {
  /** Applies to timeframes at or below this duration, in seconds. */
  readonly maxTimeframeSeconds: number;
  /** How many days of history the provider serves at that granularity. */
  readonly maxAgeDays: number;
  /** Short label used in the message, e.g. "1m". */
  readonly label: string;
  /** What the user should switch to instead. */
  readonly fallbackHint: string;
}

const DEEP_HISTORY_HINT = `Utilisez le 1H/4H (${years(DUKASCOPY_SPAN_DAYS['1h'])} ans d’archives) ou le 1D (27 ans).`;

/** Ordered from the finest granularity up; the first match wins. */
export const ARCHIVE_LIMITS: readonly ArchiveLimit[] = [
  {
    maxTimeframeSeconds: TimeframeSeconds.M1,
    maxAgeDays: DUKASCOPY_SPAN_DAYS['1m'],
    label: '1m',
    fallbackHint: DEEP_HISTORY_HINT,
  },
  {
    maxTimeframeSeconds: TimeframeSeconds.M5,
    maxAgeDays: DUKASCOPY_SPAN_DAYS['5m'],
    label: '5m',
    fallbackHint: DEEP_HISTORY_HINT,
  },
  {
    maxTimeframeSeconds: TimeframeSeconds.M15,
    maxAgeDays: DUKASCOPY_SPAN_DAYS['15m'],
    label: '15m',
    fallbackHint: DEEP_HISTORY_HINT,
  },
  {
    maxTimeframeSeconds: TimeframeSeconds.M30,
    maxAgeDays: DUKASCOPY_SPAN_DAYS['30m'],
    label: '30m',
    fallbackHint: DEEP_HISTORY_HINT,
  },
  {
    maxTimeframeSeconds: TimeframeSeconds.H4,
    maxAgeDays: DUKASCOPY_SPAN_DAYS['1h'],
    label: '1H/4H',
    fallbackHint: 'Utilisez le 1D (27 ans d’historique).',
  },
];

/** The limit governing a timeframe, or null when it has no practical cap (1D+). */
export function archiveLimitFor(timeframeSeconds: number): ArchiveLimit | null {
  return ARCHIVE_LIMITS.find((limit) => timeframeSeconds <= limit.maxTimeframeSeconds) ?? null;
}

export interface ArchiveCheck {
  readonly allowed: boolean;
  /** Populated only when `allowed` is false. */
  readonly message?: string;
}

const ALLOWED: ArchiveCheck = { allowed: true };

/**
 * Can `timeframeSeconds` serve a replay anchored at `replayCutEpoch`?
 *
 * @param replayCutEpoch Epoch seconds of the replay cursor, or null when replay
 *   is off — in which case there is nothing to preserve and any timeframe is fine.
 * @param now Injectable clock, so the rule is testable without mocking Date.
 */
export function checkArchiveDepth(
  timeframeSeconds: number,
  replayCutEpoch: number | null,
  now: number = Date.now()
): ArchiveCheck {
  if (replayCutEpoch === null || !Number.isFinite(replayCutEpoch)) return ALLOWED;

  const limit = archiveLimitFor(timeframeSeconds);
  if (!limit) return ALLOWED;

  const ageDays = Math.floor((Math.floor(now / 1000) - replayCutEpoch) / 86_400);
  if (ageDays <= limit.maxAgeDays) return ALLOWED;

  const cutDate = new Date(replayCutEpoch * 1000).toLocaleDateString('fr-FR');
  return {
    allowed: false,
    message:
      `⚠️ Limite d’archive ${limit.label} : ces données remontent à ${limit.maxAgeDays} jours, ` +
      `mais votre Replay est au ${cutDate} (il y a ${ageDays} jours). ${limit.fallbackHint} ` +
      `Le Replay reste en place.`,
  };
}

/** Profondeur demandée, en jours, par clé de plage de l'interface. */
export const RANGE_DAYS: Readonly<Record<string, number>> = {
  '1y': 365,
  '2y': 730,
  '5y': 1_825,
  '10y': 3_650,
  max: 20_000,
};

export interface CoverageEstimate {
  /** Profondeur réellement obtenue, en jours. */
  readonly effectiveDays: number;
  /** True quand le fournisseur, et non l'utilisateur, fixe la limite. */
  readonly cappedByProvider: boolean;
  /** Unités de temps atteignables ensuite sans nouveau téléchargement. */
  readonly upgradableTo: readonly string[];
}

/**
 * Ce que la combinaison granularité × profondeur va réellement donner.
 *
 * Les deux menus étaient indépendants et muets : demander « 10 ans » en 5 min
 * affichait « 10 ans » alors que le fournisseur s'arrête à 60 jours. La
 * contrainte n'apparaissait qu'après le téléchargement, sous forme de surprise.
 */
export function estimateCoverage(
  intervalSeconds: number,
  rangeKey: string,
  availableTimeframes: readonly { s: number; label: string }[] = []
): CoverageEstimate {
  const requested = RANGE_DAYS[rangeKey] ?? RANGE_DAYS.max;
  const limit = archiveLimitFor(intervalSeconds);
  const allowed = limit?.maxAgeDays ?? requested;

  return {
    effectiveDays: Math.min(requested, allowed),
    cappedByProvider: allowed < requested,
    // On agrège toujours vers le haut ; descendre exige un nouveau flux.
    upgradableTo: availableTimeframes
      .filter((t) => t.s > intervalSeconds)
      .map((t) => t.label),
  };
}
