import { create } from 'zustand';
import { Candle } from '../types/market';
import { Position, PositionType, PendingOrder, TradeAnnotation, TradeMetrics } from '../types/trading';
import { computeMetrics, parseAnnotation } from '../domain/journal';
import { sound } from '../services/audio';
import {
  AccountCurrency,
  isAccountCurrency,
  quoteToAccountRate,
  setAccountCurrency as setDomainAccountCurrency,
  unitsToLots,
} from '../domain/instruments';
import {
  CostSettings,
  DEFAULT_COST_SETTINGS,
  ResolvedCosts,
  commissionFor,
  marketEntryPrice,
  marketExitPrice,
  parseCostSettings,
  resolveCosts,
} from '../domain/trading-costs';
import {
  MIN_LOT,
  OrderRejection,
  computePnl,
  resolveSizeUnits,
  validateOrder,
} from '../domain/position-sizing';
import { newId } from '../utils/id';

const DEFAULT_BALANCE = 10_000;
const DEFAULT_RISK_PERCENT = 2.0;
const DEFAULT_QUANTITY_LOTS = 1.0;

/** Price tick used to drive the simulation: a full candle, or a bare last price. */
export type PriceTick = Pick<Candle, 'close'> & Partial<Omit<Candle, 'close'>>;

export type OrderOutcome =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly reason: OrderRejection };

/** Data-only projection of the store, used for session save/restore. */
export interface TradeSnapshot {
  balance: number;
  initialBalance: number;
  riskPercent: number;
  quantity: number;
  /** Currency of `balance` and of every amount below. */
  accountCurrency: AccountCurrency;
  /** Every position still open, oldest first. Long and short may coexist. */
  openPositions: Position[];
  pendingOrders: PendingOrder[];
  closedPositions: Position[];
}

/** A snapshot as saved, including the shape of sessions from before several positions. */
export type RestorableTradeState = Partial<TradeSnapshot> & { activePosition?: Position | null };

export interface OpenTradeInput {
  readonly symbol: string;
  readonly type: PositionType;
  readonly entry: number;
  readonly sl: number | null;
  readonly tp: number | null;
  readonly time: number;
  /**
   * Explicit size in lots. When supplied it is authoritative — this is what
   * makes the QTY field truthful. Omit it to fall back to risk-based sizing.
   */
  readonly lots?: number | null;
}

export interface PlaceOrderInput extends OpenTradeInput {
  readonly orderType: 'LIMIT' | 'STOP';
  readonly targetPrice: number;
}

interface TradeState extends TradeSnapshot {
  /**
   * Instrument this account belongs to, or `null` before the app has chosen one.
   *
   * Held here rather than in a ref inside `App`: the rule "a new instrument
   * wipes the account" ran in an effect *after* whatever changed the symbol, so
   * loading a saved session for another instrument restored its trades and then
   * immediately erased them. A restore now claims the symbol in the same
   * synchronous step, and the rule sees an account that already matches.
   */
  accountSymbol: string | null;
  /** Bind the account to `symbol` without touching its contents. */
  setAccountSymbol: (symbol: string | null) => void;
  /**
   * Spread, commission and slippage. A preference, not part of the account:
   * `resetAccount` keeps it, and it survives reloads.
   */
  costs: CostSettings;
  setCosts: (patch: Partial<CostSettings>) => void;
  /**
   * Denominate the account in `currency`. The balance and every booked result
   * are amounts in the old currency, so this opens a fresh account: the caller
   * asks first when there is anything to lose.
   */
  setAccountCurrency: (currency: AccountCurrency) => void;
  /** Close the whole position at market: the bid for a long, the ask for a short. */
  closeAtMarket: (id: string, bid: number, closeTime?: number) => void;
  /** Close every open position at market. */
  closeAllAtMarket: (bid: number, closeTime?: number) => void;
  setRiskPercent: (risk: number) => void;
  setQuantity: (qty: number) => void;
  openTrade: (input: OpenTradeInput) => OrderOutcome;
  placePendingOrder: (input: PlaceOrderInput) => OrderOutcome;
  updatePositionSlTp: (id: string, sl: number | null, tp: number | null) => void;
  updatePendingOrder: (
    id: string,
    updates: { targetPrice?: number; sl?: number | null; tp?: number | null }
  ) => void;
  cancelPendingOrder: (id: string) => void;
  /**
   * Close at an execution price already on the right side of the spread.
   * `exitCostPerUnit` is the spread/slippage share of that price, recorded in
   * the trade's fees for display only (it is already inside the price).
   */
  closePosition: (
    id: string,
    reason?: 'TP' | 'SL' | 'MANUAL',
    exitPrice?: number,
    closeTime?: number,
    exitCostPerUnit?: number
  ) => void;
  /**
   * Close `percent` of the position at market. `bid` is the displayed price;
   * `closeTime` is the replay candle's time — omit it only outside a replay.
   */
  closePartial: (id: string, percent: number, bid: number, closeTime?: number) => void;
  /** Move the stop of `id` to its entry price, or of every open position without `id`. */
  setBreakeven: (id?: string) => void;
  /** Merge journal fields into an open or closed position. */
  annotate: (id: string, patch: TradeAnnotation) => void;
  /** Record that the chart capture of `id` is stored. */
  markScreenshot: (id: string, stored: boolean) => void;
  updatePrice: (tick: PriceTick | number, currentTime?: number) => void;
  resetAccount: () => void;
  /** `symbol`, when given, binds the restored account to that instrument. */
  restoreTradeState: (restored: RestorableTradeState, symbol?: string) => void;
  getMetrics: () => TradeMetrics;
}

const INITIAL_SNAPSHOT: TradeSnapshot = {
  balance: DEFAULT_BALANCE,
  initialBalance: DEFAULT_BALANCE,
  riskPercent: DEFAULT_RISK_PERCENT,
  quantity: DEFAULT_QUANTITY_LOTS,
  accountCurrency: 'USD',
  openPositions: [],
  pendingOrders: [],
  closedPositions: [],
};


/** Coerce an untrusted number (session file, IndexedDB) to a usable value. */
function safeNumber(value: unknown, fallback: number, { min = -Infinity } = {}): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

function isPositionType(value: unknown): value is Position['type'] {
  return value === 'LONG' || value === 'SHORT';
}

/**
 * Keep only positions that can be simulated safely.
 *
 * `type` was not checked. Nothing downstream re-validates it either: `computePnl`
 * and the stop/target engine both branch on `type === 'LONG'` and treat anything
 * else as a short, so a restored position with a missing or misspelt side was
 * silently booked with the **opposite** sign — a loss recorded as a profit, in an
 * account whose whole purpose is to measure that number.
 */
/** A price level from an untrusted file: a finite positive number, or no level. */
function safeLevel(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return value !== null && value !== undefined && Number.isFinite(n) && n > 0 ? n : null;
}

/** An optional finite number, dropped when unusable. */
function safeOptional(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  return value !== null && value !== undefined && Number.isFinite(n) ? n : undefined;
}

/**
 * Coerce the optional numeric fields of a restored position or order.
 *
 * A `NaN` stop made `low <= sl` false forever: the stop displayed on screen
 * never fired — the "NaN passes the guard" trap of `lessons.md`.
 */
function normalizeLevels<T extends { sl: number | null; tp: number | null; lastCheckedTime?: number }>(
  item: T
): T {
  const lastCheckedTime = safeOptional(item.lastCheckedTime);
  const normalized = { ...item, sl: safeLevel(item.sl), tp: safeLevel(item.tp) };
  if (lastCheckedTime === undefined) delete normalized.lastCheckedTime;
  else normalized.lastCheckedTime = lastCheckedTime;
  return normalized;
}

function safePositions(value: unknown): Position[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((p): p is Position => {
      if (!p || typeof p !== 'object') return false;
      const candidate = p as Partial<Position>;
      return (
        typeof candidate.id === 'string' &&
        candidate.id.length > 0 &&
        isPositionType(candidate.type) &&
        Number.isFinite(candidate.entry) &&
        Number.isFinite(candidate.size)
      );
    })
    .map((p) => {
      const position = normalizeLevels(p);
      const risk = safeOptional(position.riskAmount);
      const fees = safeOptional(position.fees);
      return {
        ...position,
        riskAmount: risk !== undefined && risk > 0 ? risk : undefined,
        fees: fees !== undefined && fees >= 0 ? fees : undefined,
        annotation: parseAnnotation(position.annotation),
        hasScreenshot: position.hasScreenshot === true ? true : undefined,
      };
    });
}

function safeOrders(value: unknown): PendingOrder[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((o): o is PendingOrder => {
      if (!o || typeof o !== 'object') return false;
      const candidate = o as Partial<PendingOrder>;
      return (
        typeof candidate.id === 'string' &&
        candidate.id.length > 0 &&
        isPositionType(candidate.type) &&
        // Same reasoning for the fill side: a LIMIT and a STOP trigger on
        // opposite sides of the target price.
        (candidate.orderType === 'LIMIT' || candidate.orderType === 'STOP') &&
        Number.isFinite(candidate.targetPrice) &&
        Number.isFinite(candidate.size)
      );
    })
    .map(normalizeLevels);
}

const COSTS_KEY = 'backtest-costs-v1';

function loadCosts(): CostSettings {
  try {
    const raw = localStorage.getItem(COSTS_KEY);
    return raw ? parseCostSettings(JSON.parse(raw)) : DEFAULT_COST_SETTINGS;
  } catch {
    return DEFAULT_COST_SETTINGS;
  }
}

function saveCosts(costs: CostSettings): void {
  try {
    localStorage.setItem(COSTS_KEY, JSON.stringify(costs));
  } catch {
    // Storage unavailable: the setting simply lasts for this session.
  }
}

const CURRENCY_KEY = 'backtest-account-currency-v1';

function loadCurrency(): AccountCurrency {
  try {
    const raw = localStorage.getItem(CURRENCY_KEY);
    return isAccountCurrency(raw) ? raw : 'USD';
  } catch {
    return 'USD';
  }
}

/** The store and the conversion code must agree: this is the only writer of both. */
function applyCurrency(currency: AccountCurrency): void {
  setDomainAccountCurrency(currency);
  try {
    localStorage.setItem(CURRENCY_KEY, currency);
  } catch {
    // Storage unavailable: the choice lasts for this session.
  }
}

/** Replace the position `id` in `list` with `update(position)`. */
function replaceById(list: Position[], id: string, update: (p: Position) => Position): Position[] {
  return list.map((p) => (p.id === id ? update(p) : p));
}

/**
 * Loss at the stop, frozen at entry, commissions included. `undefined` without
 * a stop. A short's stop triggers on the ask, so it executes at the stop level
 * itself; the spread it pays is already inside that level.
 */
function riskAt(
  symbol: string | undefined,
  type: PositionType,
  entry: number,
  sl: number | null,
  size: number,
  costs: ResolvedCosts
) {
  if (sl === null) return undefined;
  const loss = -computePnl(type, entry, sl, size, symbol) + 2 * commissionFor(symbol ?? '', size, costs);
  return loss > 0 ? loss : undefined;
}

/** Spread and slippage paid on `size` units, in account currency. */
function costAmount(symbol: string | undefined, perUnit: number, size: number, price: number): number {
  const amount = Math.abs(perUnit) * size * quoteToAccountRate(symbol ?? '', price);
  return Number.isFinite(amount) ? amount : 0;
}

/** Normalise a tick into the OHLC fields the fill logic needs. */
function readTick(tick: PriceTick | number, currentTime?: number) {
  const fallbackTime = currentTime ?? Date.now() / 1000;
  if (typeof tick === 'number') {
    return { close: tick, open: tick, high: tick, low: tick, time: fallbackTime };
  }
  const close = tick.close;
  return {
    close,
    open: tick.open ?? close,
    high: tick.high ?? close,
    low: tick.low ?? close,
    time: tick.time ?? fallbackTime,
  };
}

/**
 * Told of every fill that closes, full or partial, right after it is booked.
 *
 * An event rather than state: restoring a session also changes
 * `closedPositions`, and what listens here (the chart capture) must react to a
 * trade closing now, never to history arriving.
 */
type CloseListener = (closed: Position) => void;
const closeListeners = new Set<CloseListener>();

export function onPositionClosed(listener: CloseListener): () => void {
  closeListeners.add(listener);
  return () => closeListeners.delete(listener);
}

function notifyClosed(closed: Position): void {
  for (const listener of closeListeners) {
    try {
      listener(closed);
    } catch (error) {
      console.error('[trade] close listener failed:', error);
    }
  }
}

export const useTradeStore = create<TradeState>((set, get) => {
  /** Costs of `symbol` at `price` under the current settings. */
  const costsOf = (symbol: string | undefined, price: number) => resolveCosts(symbol ?? '', price, get().costs);
  const findOpen = (id: string) => get().openPositions.find((p) => p.id === id) ?? null;

  const initialCurrency = loadCurrency();
  setDomainAccountCurrency(initialCurrency);

  return {
  ...INITIAL_SNAPSHOT,
  accountCurrency: initialCurrency,
  accountSymbol: null,
  costs: loadCosts(),

  setAccountSymbol: (accountSymbol) => set({ accountSymbol }),

  setCosts: (patch) => {
    const costs = parseCostSettings({ ...get().costs, ...patch });
    saveCosts(costs);
    set({ costs });
  },

  setAccountCurrency: (currency) => {
    if (!isAccountCurrency(currency)) return;
    applyCurrency(currency);
    const { riskPercent, quantity } = get();
    set({ ...INITIAL_SNAPSHOT, riskPercent, quantity, accountCurrency: currency });
  },

  setRiskPercent: (riskPercent) =>
    set({ riskPercent: safeNumber(riskPercent, DEFAULT_RISK_PERCENT, { min: 0 }) }),

  setQuantity: (quantity) => set({ quantity: safeNumber(quantity, DEFAULT_QUANTITY_LOTS, { min: 0 }) }),

  openTrade: ({ symbol, type, entry: bid, sl, tp, time, lots }) => {
    const { balance, riskPercent, quantity } = get();

    // `entry` is the displayed (bid) price; a buy pays the ask.
    const costs = costsOf(symbol, bid);
    const entry = marketEntryPrice(type, bid, costs);

    const sizeUnits = resolveSizeUnits({
      symbol,
      balance,
      riskPercent,
      defaultQuantityLots: quantity,
      entry,
      sl,
      explicitLots: lots,
    });

    const validation = validateOrder({ type, entry, sl, tp, sizeUnits });
    if (!validation.ok) {
      sound.playError();
      return { ok: false, reason: validation.reason };
    }

    const position: Position = {
      id: newId('trade'),
      symbol,
      type,
      entry,
      sl,
      tp,
      size: sizeUnits,
      time,
      // Entered at this candle's close: its range is already history.
      lastCheckedTime: time,
      riskAmount: riskAt(symbol, type, entry, sl, sizeUnits, costs),
      fees: costAmount(symbol, entry - bid, sizeUnits, entry),
      status: 'OPEN',
    };

    set({ openPositions: [...get().openPositions, position] });
    sound.playClick();
    return { ok: true, id: position.id };
  },

  placePendingOrder: ({ symbol, type, orderType, targetPrice, sl, tp, time, lots }) => {
    const { balance, riskPercent, quantity, pendingOrders } = get();

    const sizeUnits = resolveSizeUnits({
      symbol,
      balance,
      riskPercent,
      defaultQuantityLots: quantity,
      entry: targetPrice,
      sl,
      explicitLots: lots,
    });

    const validation = validateOrder({ type, entry: targetPrice, sl, tp, sizeUnits });
    if (!validation.ok) {
      sound.playError();
      return { ok: false, reason: validation.reason };
    }

    const order: PendingOrder = {
      id: newId('order'),
      symbol,
      type,
      orderType,
      targetPrice,
      sl,
      tp,
      size: sizeUnits,
      time,
    };

    set({ pendingOrders: [...pendingOrders, order] });
    sound.playClick();
    return { ok: true, id: order.id };
  },

  updatePositionSlTp: (id, sl, tp) => {
    if (!findOpen(id)) return;
    set({ openPositions: replaceById(get().openPositions, id, (p) => ({ ...p, sl, tp })) });
    sound.playClick();
  },

  updatePendingOrder: (id, updates) =>
    set((state) => ({
      pendingOrders: state.pendingOrders.map((o) => (o.id === id ? { ...o, ...updates } : o)),
    })),

  cancelPendingOrder: (id) =>
    set((state) => ({ pendingOrders: state.pendingOrders.filter((o) => o.id !== id) })),

  closePosition: (id, reason = 'MANUAL', exitPrice, closeTime, exitCostPerUnit = 0) => {
    const position = findOpen(id);
    if (!position) return;
    const { closedPositions, balance, openPositions } = get();

    const exit = Number.isFinite(exitPrice) ? (exitPrice as number) : position.entry;
    const at = Number.isFinite(closeTime) ? (closeTime as number) : Date.now() / 1000;
    const { symbol, size } = position;
    // Entry and exit commissions, charged when the trade is booked.
    const commission = 2 * commissionFor(symbol ?? '', size, costsOf(symbol, exit));
    const pnl = computePnl(position.type, position.entry, exit, size, symbol) - commission;
    const fees = (position.fees ?? 0) + costAmount(symbol, exitCostPerUnit, size, exit) + commission;

    const closed: Position = {
      ...position,
      status: 'CLOSED',
      exitPrice: exit,
      closeTime: at,
      closeReason: reason,
      pnl,
      fees,
      // Guard against a wiped-out account: `pnl / 0` would store Infinity and
      // poison every metric derived from it.
      pnlPercent: balance > 0 ? (pnl / balance) * 100 : 0,
    };

    if (pnl > 0) sound.playOrderWin();
    else sound.playOrderLoss();

    set({
      balance: balance + pnl,
      openPositions: openPositions.filter((p) => p.id !== id),
      closedPositions: [closed, ...closedPositions],
    });
    notifyClosed(closed);
  },

  closeAtMarket: (id, bid, closeTime) => {
    const position = findOpen(id);
    if (!position || !Number.isFinite(bid) || bid <= 0) return;
    const exit = marketExitPrice(position.type, bid, costsOf(position.symbol, bid));
    get().closePosition(id, 'MANUAL', exit, closeTime, exit - bid);
  },

  closeAllAtMarket: (bid, closeTime) => {
    for (const { id } of get().openPositions) get().closeAtMarket(id, bid, closeTime);
  },

  closePartial: (id, percent, bid, closeTime) => {
    const position = findOpen(id);
    if (!position) return;
    if (!Number.isFinite(percent) || percent <= 0 || percent >= 100) return;
    if (!Number.isFinite(bid) || bid <= 0) return;

    // Un reliquat sous le demi-lot minimum n'est plus une position : clôture totale.
    const leftover = position.size * (1 - percent / 100);
    if (unitsToLots(position.symbol ?? '', leftover) < MIN_LOT / 2) {
      get().closeAtMarket(id, bid, closeTime);
      return;
    }

    const { closedPositions, balance, openPositions } = get();
    const { symbol } = position;
    const costs = costsOf(symbol, bid);
    const currentPrice = marketExitPrice(position.type, bid, costs);
    const closedSize = position.size * (percent / 100);
    const remainingSize = position.size - closedSize;
    const commission = 2 * commissionFor(symbol ?? '', closedSize, costs);
    const pnl = computePnl(position.type, position.entry, currentPrice, closedSize, symbol) - commission;
    const share = percent / 100;
    const entryFees = position.fees ?? 0;
    // Replay time, not wall-clock time. `Date.now()` dated every partial close
    // in 2026 inside a 2019 replay; `getMetrics` sorts by `closeTime`, so the
    // partial landed at the end of the equity curve and skewed the drawdown.
    const at = Number.isFinite(closeTime) ? (closeTime as number) : Date.now() / 1000;

    const closedPart: Position = {
      ...position,
      // A partial close is a distinct fill: reusing the parent id made the two
      // rows indistinguishable in the history and in any id-keyed lookup.
      id: newId('trade'),
      size: closedSize,
      // The risk splits with the size, or each half would claim the whole.
      riskAmount: position.riskAmount === undefined ? undefined : position.riskAmount * share,
      status: 'CLOSED',
      exitPrice: currentPrice,
      closeTime: at,
      closeReason: 'MANUAL',
      pnl,
      fees: entryFees * share + costAmount(symbol, currentPrice - bid, closedSize, currentPrice) + commission,
      pnlPercent: balance > 0 ? (pnl / balance) * 100 : 0,
      // The capture belongs to the fill it was taken for.
      hasScreenshot: undefined,
    };

    if (pnl > 0) sound.playOrderWin();
    else sound.playOrderLoss();

    set({
      balance: balance + pnl,
      openPositions: replaceById(openPositions, id, (p) => ({
        ...p,
        size: remainingSize,
        fees: entryFees * (1 - share),
        riskAmount: p.riskAmount === undefined ? undefined : p.riskAmount * (1 - share),
      })),
      closedPositions: [closedPart, ...closedPositions],
    });
    notifyClosed(closedPart);
  },

  setBreakeven: (id) => {
    const { openPositions } = get();
    if (openPositions.length === 0 || (id !== undefined && !findOpen(id))) return;
    set({
      openPositions: openPositions.map((p) => (id === undefined || p.id === id ? { ...p, sl: p.entry } : p)),
    });
    sound.playClick();
  },

  annotate: (id, patch) => {
    const merge = (p: Position): Position => {
      const annotation = parseAnnotation({ ...p.annotation, ...patch });
      // Emptied: the field goes, rather than lingering as `annotation: undefined`.
      const { annotation: _previous, ...rest } = p;
      return annotation ? { ...rest, annotation } : rest;
    };
    const { openPositions, closedPositions } = get();
    set({
      openPositions: replaceById(openPositions, id, merge),
      closedPositions: replaceById(closedPositions, id, merge),
    });
  },

  markScreenshot: (id, stored) => {
    const mark = (p: Position): Position => ({ ...p, hasScreenshot: stored ? true : undefined });
    const { openPositions, closedPositions } = get();
    set({
      openPositions: replaceById(openPositions, id, mark),
      closedPositions: replaceById(closedPositions, id, mark),
    });
  },

  /**
   * Advance the simulation by one price tick: fill eligible pending orders, then
   * test every open position against its stop and target.
   *
   * Fills use the candle body so gaps are honoured — a long stop below a gapped
   * open fills at the open (worse), a long target above a gapped open fills at
   * the open (better). When a single candle touches both stop and target the
   * stop is assumed to come first, the conservative reading for a backtest.
   *
   * Every order and position only reacts to candles strictly **after** the last
   * one it saw (`lastCheckedTime`, initially its own creation time). The replay
   * feeds this function whenever the cursor or the timeframe changes, including
   * backwards: without the guard, pressing ← after a buy tested the stop against
   * the previous candle — a candle that ended before the entry existed — and a
   * pending order was filled against the very candle it was typed on.
   */
  updatePrice: (tick, currentTime) => {
    const { close, open, high, low, time } = readTick(tick, currentTime);
    if (!Number.isFinite(close)) return;

    const { pendingOrders } = get();

    if (pendingOrders.length > 0) {
      const remaining: PendingOrder[] = [];
      const activated: Position[] = [];

      for (const order of pendingOrders) {
        if (time <= (order.lastCheckedTime ?? order.time)) {
          remaining.push(order);
          continue;
        }

        let triggered = false;
        let fill = order.targetPrice;
        // A buy order executes on the ask (bid + spread), a sell on the bid.
        // Stop orders execute at market and suffer slippage; limits do not.
        const costs = costsOf(order.symbol, order.targetPrice);
        const s = order.type === 'LONG' ? costs.spread : 0;

        if (order.type === 'LONG') {
          if (order.orderType === 'LIMIT' && low + s <= order.targetPrice) {
            triggered = true;
            fill = Math.min(open + s, order.targetPrice);
          } else if (order.orderType === 'STOP' && high + s >= order.targetPrice) {
            triggered = true;
            fill = Math.max(open + s, order.targetPrice) + costs.slippage;
          }
        } else if (order.orderType === 'LIMIT' && high >= order.targetPrice) {
          triggered = true;
          fill = Math.max(open, order.targetPrice);
        } else if (order.orderType === 'STOP' && low <= order.targetPrice) {
          triggered = true;
          fill = Math.min(open, order.targetPrice) - costs.slippage;
        }
        const entryCostPerUnit =
          (order.type === 'LONG' ? costs.spread : 0) + (order.orderType === 'STOP' ? costs.slippage : 0);

        if (triggered) {
          activated.push({
            id: newId('trade'),
            symbol: order.symbol,
            type: order.type,
            entry: fill,
            sl: order.sl,
            tp: order.tp,
            size: order.size,
            riskAmount: riskAt(order.symbol, order.type, fill, order.sl, order.size, costs),
            fees: costAmount(order.symbol, entryCostPerUnit, order.size, fill),
            time,
            status: 'OPEN',
          });
        } else {
          remaining.push({ ...order, lastCheckedTime: time });
        }
      }

      if (activated.length > 0) sound.playClick();
      set({ pendingOrders: remaining, openPositions: [...get().openPositions, ...activated] });
    }

    // Snapshot the list: closing a position rewrites `openPositions`.
    for (const position of get().openPositions) {
      // A position filled by a pending order on this very candle is tested on
      // it too (stop first): the fill and the extremes share the candle, and
      // the pessimistic reading is the right default. Any other position only
      // reacts to candles after the last one it saw.
      const filledThisTick = position.time === time && position.lastCheckedTime === undefined;
      if (!filledThisTick && time <= (position.lastCheckedTime ?? position.time)) continue;

      // A long exits on the bid (the candle as drawn); a short buys back on the
      // ask, so its stop and target are tested against `price + spread`. Stops
      // execute at market and suffer slippage; targets are limits.
      const { closePosition } = get();
      const costs = costsOf(position.symbol, close);
      const { id } = position;
      if (position.type === 'LONG') {
        if (position.sl !== null && low <= position.sl) {
          closePosition(id, 'SL', Math.min(open, position.sl) - costs.slippage, time, costs.slippage);
          continue;
        }
        if (position.tp !== null && high >= position.tp) {
          closePosition(id, 'TP', Math.max(open, position.tp), time);
          continue;
        }
      } else {
        const s = costs.spread;
        if (position.sl !== null && high + s >= position.sl) {
          closePosition(id, 'SL', Math.max(open + s, position.sl) + costs.slippage, time, s + costs.slippage);
          continue;
        }
        if (position.tp !== null && low + s <= position.tp) {
          closePosition(id, 'TP', Math.min(open + s, position.tp), time, s);
          continue;
        }
      }

      set({ openPositions: replaceById(get().openPositions, id, (p) => ({ ...p, lastCheckedTime: time })) });
    }
  },

  resetAccount: () => set({ ...INITIAL_SNAPSHOT, accountCurrency: get().accountCurrency }),

  /**
   * Restore a snapshot from IndexedDB or an imported session file.
   * Every field is validated: session files are exchanged between users, so the
   * payload is untrusted input, not a typed object.
   *
   * Sessions saved before several positions could be open carry a single
   * `activePosition`; those saved before the currency could change were in USD.
   */
  restoreTradeState: (restored, symbol) => {
    const legacy = restored.activePosition;
    const open = Array.isArray(restored.openPositions) ? restored.openPositions : legacy ? [legacy] : [];
    const currency = isAccountCurrency(restored.accountCurrency) ? restored.accountCurrency : 'USD';
    applyCurrency(currency);
    set({
      ...(symbol ? { accountSymbol: symbol } : {}),
      balance: safeNumber(restored.balance, DEFAULT_BALANCE),
      initialBalance: safeNumber(restored.initialBalance, DEFAULT_BALANCE),
      riskPercent: safeNumber(restored.riskPercent, DEFAULT_RISK_PERCENT, { min: 0 }),
      quantity: safeNumber(restored.quantity, DEFAULT_QUANTITY_LOTS, { min: 0 }),
      accountCurrency: currency,
      openPositions: safePositions(open),
      pendingOrders: safeOrders(restored.pendingOrders),
      closedPositions: safePositions(restored.closedPositions),
    });
  },

  getMetrics: (): TradeMetrics => {
    const { balance, initialBalance, closedPositions } = get();
    // The balance is the account's own figure: it is what every other screen shows.
    const metrics = computeMetrics(closedPositions, initialBalance);
    return { ...metrics, balance, totalPnL: balance - initialBalance };
  },
};
});
