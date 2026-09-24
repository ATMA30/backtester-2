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
import { TimeframeSeconds } from './timeframes';

/** Upper bounds, so an oversized file cannot lock up the main thread. */
const MAX_CANDLES = 200_000;
const MAX_POSITIONS = 50_000;
const MAX_ORDERS = 1_000;

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

function parseList<T>(value: unknown, parse: (item: unknown) => T | null, limit: number): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const item of value.slice(0, limit)) {
    const parsed = parse(item);
    if (parsed) out.push(parsed);
  }
  return out;
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

  const symbol = stringOr(value.symbol, '');
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

  const closedPositions = parseList(value.closedPositions, parsePosition, MAX_POSITIONS);
  const pendingOrders = parseList(value.pendingOrders, parseOrder, MAX_ORDERS);
  const activePosition = parsePosition(value.activePosition);

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
      closedPositions,
      activePosition,
      pendingOrders,
      drawings,
      candlesCount: candles.length || Math.max(0, Math.floor(numberOr(value.candlesCount, 0))),
      timeRange: typeof value.timeRange === 'string' ? value.timeRange : undefined,
      winRate: Number.isFinite(Number(value.winRate)) ? Number(value.winRate) : undefined,
      totalPnL: Number.isFinite(Number(value.totalPnL)) ? Number(value.totalPnL) : undefined,
      totalTrades: Number.isFinite(Number(value.totalTrades)) ? Number(value.totalTrades) : undefined,
      data: candles.length > 0 ? candles : undefined,
    },
    warnings,
  };
}
