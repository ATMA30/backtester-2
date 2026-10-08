/**
 * The trading journal: what the trader writes about each trade, and the views
 * that slice the history by date, side and setup.
 */

import { EMOTIONS, Position, PositionType, TradeAnnotation, TradeMetrics } from '../types/trading';

/** Longest setup name and note kept: they are shown in lists and exported. */
const MAX_SETUP_LENGTH = 40;
const MAX_NOTE_LENGTH = 2_000;

/**
 * Keep only what the journal can show: trimmed strings of bounded length and a
 * known emotion. `undefined` when nothing is left, so an emptied annotation
 * disappears instead of lingering as `{}`.
 */
export function parseAnnotation(value: unknown): TradeAnnotation | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const text = (v: unknown, max: number) =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;
  const setup = text(raw.setup, MAX_SETUP_LENGTH);
  const note = text(raw.note, MAX_NOTE_LENGTH);
  const emotion = (EMOTIONS as readonly unknown[]).includes(raw.emotion) ? (raw.emotion as TradeAnnotation['emotion']) : undefined;
  const annotation: TradeAnnotation = {
    ...(setup ? { setup } : {}),
    ...(emotion ? { emotion } : {}),
    ...(note ? { note } : {}),
  };
  return Object.keys(annotation).length > 0 ? annotation : undefined;
}

/** A result in multiples of the risk taken: `+1.50 R`. */
export function formatR(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)} R`;
}

// ── FILTERS ──────────────────────────────────────────────────

/** `null` on a field means "no constraint". */
export interface JournalFilter {
  /** Earliest close, epoch seconds, inclusive. */
  readonly from: number | null;
  /** Latest close, epoch seconds, inclusive. */
  readonly to: number | null;
  readonly side: PositionType | null;
  /** A setup name, `NO_SETUP` for trades without one, `null` for all. */
  readonly setup: string | null;
}

/** Filter value selecting the trades nobody named a setup for. */
export const NO_SETUP = '\u0000none';

export const EMPTY_FILTER: JournalFilter = { from: null, to: null, side: null, setup: null };

export function isFilterActive(filter: JournalFilter): boolean {
  return filter.from !== null || filter.to !== null || filter.side !== null || filter.setup !== null;
}

/** Setups compare without case or surrounding spaces: "Cassure" is "cassure ". */
function setupKey(setup: string | undefined): string | null {
  const key = setup?.trim().toLocaleLowerCase('fr');
  return key ? key : null;
}

export function matchesFilter(trade: Position, filter: JournalFilter): boolean {
  const closedAt = trade.closeTime ?? trade.time;
  if (filter.from !== null && closedAt < filter.from) return false;
  if (filter.to !== null && closedAt > filter.to) return false;
  if (filter.side !== null && trade.type !== filter.side) return false;
  if (filter.setup !== null) {
    const key = setupKey(trade.annotation?.setup);
    if (filter.setup === NO_SETUP ? key !== null : key !== setupKey(filter.setup)) return false;
  }
  return true;
}

export function filterTrades(trades: readonly Position[], filter: JournalFilter): Position[] {
  return isFilterActive(filter) ? trades.filter((t) => matchesFilter(t, filter)) : [...trades];
}

/**
 * Setups used so far, each under its most frequent spelling, most used first:
 * what the filter offers and what the setup field suggests.
 */
export function setupsOf(trades: readonly Position[]): string[] {
  const byKey = new Map<string, { count: number; spellings: Map<string, number> }>();
  for (const trade of trades) {
    const setup = trade.annotation?.setup?.trim();
    const key = setupKey(setup);
    if (!setup || !key) continue;
    const entry = byKey.get(key) ?? { count: 0, spellings: new Map<string, number>() };
    entry.count++;
    entry.spellings.set(setup, (entry.spellings.get(setup) ?? 0) + 1);
    byKey.set(key, entry);
  }
  const mostFrequent = (spellings: Map<string, number>) =>
    [...spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'))[0][0];
  return [...byKey.values()]
    .sort((a, b) => b.count - a.count || mostFrequent(a.spellings).localeCompare(mostFrequent(b.spellings), 'fr'))
    .map((entry) => mostFrequent(entry.spellings));
}

// ── METRICS ──────────────────────────────────────────────────

/**
 * Performance of a set of closed trades, as if they were the whole account:
 * the equity curve starts at `initialBalance` and adds each result in close
 * order. For the full history, the final balance is the account balance; for
 * a filtered view it answers "what would these trades alone have given?".
 */
export function computeMetrics(trades: readonly Position[], initialBalance: number): TradeMetrics {
  let wins = 0;
  let losses = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let rSum = 0;
  let rCount = 0;
  let totalFees = 0;

  for (const p of trades) {
    const pnl = p.pnl ?? 0;
    if (pnl > 0) {
      wins++;
      grossProfit += pnl;
    } else if (pnl < 0) {
      losses++;
      grossLoss += -pnl;
    }
    if (Number.isFinite(p.fees)) totalFees += p.fees as number;
    if (p.riskAmount && p.riskAmount > 0 && Number.isFinite(p.pnl)) {
      rSum += (p.pnl as number) / p.riskAmount;
      rCount++;
    }
  }

  // Order by close time rather than trusting insertion order: a restored or
  // imported session can arrive in any order, and the equity curve — hence the
  // drawdown — is meaningless if replayed out of sequence.
  const chronological = [...trades].sort((a, b) => (a.closeTime ?? a.time) - (b.closeTime ?? b.time));
  let peak = initialBalance;
  let equity = initialBalance;
  let maxDrawdown = 0;
  for (const position of chronological) {
    equity += position.pnl ?? 0;
    if (equity > peak) peak = equity;
    if (peak > 0) {
      const drawdown = ((peak - equity) / peak) * 100;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }
  }

  const total = trades.length;
  return {
    balance: equity,
    initialBalance,
    totalTrades: total,
    winningTrades: wins,
    losingTrades: losses,
    winRate: total > 0 ? (wins / total) * 100 : 0,
    // Infinity is the honest value for "profits, no losses"; the previous
    // sentinel of 99 was indistinguishable from a real profit factor of 99.
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    maxDrawdown: Math.round(maxDrawdown * 100) / 100,
    totalPnL: equity - initialBalance,
    expectancy: total > 0 ? (grossProfit - grossLoss) / total : 0,
    averageWin: wins > 0 ? grossProfit / wins : 0,
    averageLoss: losses > 0 ? grossLoss / losses : 0,
    averageR: rCount > 0 ? rSum / rCount : null,
    totalFees,
  };
}
