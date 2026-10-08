/**
 * Validation for `BacktestSession` payloads.
 *
 * Sessions are an interchange format: `handleExportSession` writes a `.json`
 * file that users share, and the importer used to cast the parsed object with
 * `as BacktestSession` without checking a single field. A hand-edited or
 * corrupted file was written straight into IndexedDB and then fed to
 * `restoreDrawings` / `restoreTradeState`, where a non-array `drawings` threw
 * inside the canvas render loop — leaving a broken state that survived reloads.
 */

import { BacktestSession, Candle } from '../types/market';
import { Position, PendingOrder } from '../types/trading';
import { parseDrawings } from '../store/useDrawingStore';
import { sanitizeCandles } from './candles';
import { parseAnnotation } from './journal';
import { isAccountCurrency } from './instruments';
import { TimeframeSeconds } from './timeframes';

/** Upper bounds, so an oversized file cannot lock up the main thread. */
const MAX_CANDLES = 200_000;
const MAX_POSITIONS = 50_000;
const MAX_ORDERS = 1_000;
const MAX_OPEN_POSITIONS = 1_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberOr(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, MAX_TEXT) : fallback;
}

/** Longest free-text field kept (names, symbols). */
const MAX_TEXT = 64;
/** Epoch seconds a date may take: `1e300` made `toISOString()` throw in the export. */
const MAX_EPOCH = 4_000_000_000;
/**
 * Ids and symbols end up in exported CSV cells and DOM attributes; a shared
 * session file could carry `=HYPERLINK(…)` there. Keep them to a plain token.
 */
const TOKEN = /^[\w.:-]{1,64}$/;

function tokenOr(value: unknown): string | undefined {
  return typeof value === 'string' && TOKEN.test(value) ? value : undefined;
}

function epochOr(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= MAX_EPOCH ? n : undefined;
}

function parsePosition(value: unknown): Position | null {
  if (!isRecord(value)) return null;
  const { id, type, entry, size, time, status } = value;

  if (typeof id !== 'string' || !TOKEN.test(id)) return null;
  if (type !== 'LONG' && type !== 'SHORT') return null;
  if (!Number.isFinite(Number(entry)) || !Number.isFinite(Number(size))) return null;

  const riskAmount = Number(value.riskAmount);
  const fees = Number(value.fees);
  const lastCheckedTime = epochOr(value.lastCheckedTime);
  const annotation = parseAnnotation(value.annotation);
  return {
    id,
    symbol: tokenOr(value.symbol),
    type,
    entry: Number(entry),
    size: Number(size),
    sl: Number.isFinite(Number(value.sl)) ? Number(value.sl) : null,
    tp: Number.isFinite(Number(value.tp)) ? Number(value.tp) : null,
    time: epochOr(time) ?? 0,
    ...(lastCheckedTime !== undefined ? { lastCheckedTime } : {}),
    // Sans lui, les métriques en R disparaissaient après l'import d'une session.
    ...(Number.isFinite(riskAmount) && riskAmount > 0 ? { riskAmount } : {}),
    ...(Number.isFinite(fees) && fees >= 0 ? { fees } : {}),
    status: status === 'CLOSED' || status === 'CANCELLED' ? status : 'OPEN',
    closeTime: epochOr(value.closeTime),
    exitPrice: Number.isFinite(Number(value.exitPrice)) ? Number(value.exitPrice) : undefined,
    pnl: Number.isFinite(Number(value.pnl)) ? Number(value.pnl) : undefined,
    pnlPercent: Number.isFinite(Number(value.pnlPercent)) ? Number(value.pnlPercent) : undefined,
    closeReason:
      value.closeReason === 'TP' || value.closeReason === 'SL' || value.closeReason === 'MANUAL'
        ? value.closeReason
        : undefined,
    ...(annotation ? { annotation } : {}),
    ...(value.hasScreenshot === true ? { hasScreenshot: true } : {}),
  };
}

function parseOrder(value: unknown): PendingOrder | null {
  if (!isRecord(value)) return null;
  const { id, type, orderType, targetPrice, size } = value;

  if (typeof id !== 'string' || !TOKEN.test(id)) return null;
  if (type !== 'LONG' && type !== 'SHORT') return null;
  if (orderType !== 'LIMIT' && orderType !== 'STOP') return null;
  if (!Number.isFinite(Number(targetPrice)) || !Number.isFinite(Number(size))) return null;

  const lastCheckedTime = epochOr(value.lastCheckedTime);
  return {
    id,
    symbol: tokenOr(value.symbol),
    type,
    orderType,
    targetPrice: Number(targetPrice),
    size: Number(size),
    sl: Number.isFinite(Number(value.sl)) ? Number(value.sl) : null,
    tp: Number.isFinite(Number(value.tp)) ? Number(value.tp) : null,
    time: epochOr(value.time) ?? 0,
    ...(lastCheckedTime !== undefined ? { lastCheckedTime } : {}),
  };
}

/**
 * Parse each item, keeping the first of any id seen twice: every id-keyed
 * update (`annotate`, a stop moved on the chart) would otherwise change several
 * trades at once, and React keys would collide.
 */
function parseList<T extends { id: string }>(
  value: unknown,
  parse: (item: unknown) => T | null,
  limit: number,
  seen = new Set<string>()
): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const item of value.slice(0, limit)) {
    const parsed = parse(item);
    if (!parsed || seen.has(parsed.id)) continue;
    seen.add(parsed.id);
    out.push(parsed);
  }
  return out;
}

/** Longest instrument name kept. */
const MAX_SYMBOL = 32;

/**
 * An instrument name from a file: printable characters only (letters, digits,
 * space and `. _ : / -`), bounded. Imported datasets are named by the user and
 * may contain spaces, so the stricter `TOKEN` does not apply.
 */
function symbolOr(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[^\p{L}\p{N} ._:/-]/gu, '').trim().slice(0, MAX_SYMBOL);
}

export interface SessionParseResult {
  readonly session: BacktestSession;
  /** Fields that were repaired or dropped, for an honest toast. */
  readonly warnings: string[];
}

/**
 * Validate an untrusted session payload into a usable `BacktestSession`.
 * Returns `null` only when the payload cannot be identified as a session.
 */
export function parseBacktestSession(value: unknown): SessionParseResult | null {
  if (!isRecord(value)) return null;

  const symbol = symbolOr(value.symbol);
  if (!symbol) return null;

  const warnings: string[] = [];

  let candles: Candle[] = [];
  if (value.data !== undefined) {
    if (Array.isArray(value.data)) {
      candles = sanitizeCandles(value.data.slice(0, MAX_CANDLES));
      if (candles.length !== value.data.length) warnings.push('bougies invalides ignorées');
    } else {
      warnings.push('champ "data" ignoré (format inattendu)');
    }
  }

  const drawings = parseDrawings(value.drawings);
  if (Array.isArray(value.drawings) && drawings.length !== value.drawings.length) {
    warnings.push('tracés invalides ignorés');
  } else if (value.drawings !== undefined && !Array.isArray(value.drawings)) {
    warnings.push('champ "drawings" ignoré (format inattendu)');
  }

  // One id space for open and closed trades: a position cannot be both.
  const ids = new Set<string>();
  const closedPositions = parseList(value.closedPositions, parsePosition, MAX_POSITIONS, ids);
  const pendingOrders = parseList(value.pendingOrders, parseOrder, MAX_ORDERS);
  // Sessions saved before several positions could be open carry one
  // `activePosition`; those before the account currency could change were in USD.
  const legacyPosition = parsePosition(value.activePosition);
  const openPositions = Array.isArray(value.openPositions)
    ? parseList(value.openPositions, parsePosition, MAX_OPEN_POSITIONS, ids)
    : legacyPosition && !ids.has(legacyPosition.id)
      ? [legacyPosition]
      : [];

  const baseTF = numberOr(value.baseTF, TimeframeSeconds.D1);
  const now = Date.now();

  return {
    session: {
      id: stringOr(value.id, ''),
      name: stringOr(value.name, symbol),
      symbol,
      baseTF: baseTF > 0 ? baseTF : TimeframeSeconds.D1,
      activeTF: numberOr(value.activeTF, baseTF),
      createdAt: numberOr(value.createdAt, now),
      updatedAt: numberOr(value.updatedAt, now),
      replayIndex: Math.max(0, Math.floor(numberOr(value.replayIndex, 0))),
      replayActive: value.replayActive === true,
      balance: numberOr(value.balance, 10_000),
      initialBalance: numberOr(value.initialBalance, 10_000),
      riskPercent: numberOr(value.riskPercent, 2),
      quantity: numberOr(value.quantity, 1),
      accountCurrency: isAccountCurrency(value.accountCurrency) ? value.accountCurrency : 'USD',
      closedPositions,
      openPositions,
      pendingOrders,
      drawings,
      candlesCount: candles.length || Math.max(0, Math.floor(numberOr(value.candlesCount, 0))),
      timeRange: typeof value.timeRange === 'string' ? value.timeRange.slice(0, MAX_TEXT) : undefined,
      winRate: Number.isFinite(Number(value.winRate)) ? Number(value.winRate) : undefined,
      totalPnL: Number.isFinite(Number(value.totalPnL)) ? Number(value.totalPnL) : undefined,
      totalTrades: Number.isFinite(Number(value.totalTrades)) ? Number(value.totalTrades) : undefined,
      data: candles.length > 0 ? candles : undefined,
    },
    warnings,
  };
}

/**
 * A session arriving from a file, made independent of this browser's trades.
 *
 * Its trade ids come from another browser — or from this one, if the file is a
 * re-import — and captures are keyed by trade id: a shared id showed a local
 * capture on the imported trade, and deleting it from one erased the other's.
 * Every trade gets a fresh id, and loses a capture flag whose image stayed
 * where the file was made.
 */
export function detachImportedSession(session: BacktestSession, newTradeId: () => string): BacktestSession {
  const detach = (p: Position): Position => {
    const copy: Position = { ...p, id: newTradeId() };
    delete copy.hasScreenshot;
    return copy;
  };
  return {
    ...session,
    closedPositions: session.closedPositions.map(detach),
    openPositions: session.openPositions.map(detach),
    pendingOrders: session.pendingOrders.map((o) => ({ ...o, id: newTradeId() })),
  };
}

