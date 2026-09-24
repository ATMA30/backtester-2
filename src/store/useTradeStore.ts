import { create } from 'zustand';
import { Candle } from '../types/market';
import { Position, PositionType, PendingOrder, TradeMetrics } from '../types/trading';
import { sound } from '../services/audio';
import { quoteToAccountRate, unitsToLots } from '../domain/instruments';
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
  activePosition: Position | null;
  pendingOrders: PendingOrder[];
  closedPositions: Position[];
}

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
  /** Close the whole position at market: the bid for a long, the ask for a short. */
  closeAtMarket: (bid: number, closeTime?: number) => void;
  setRiskPercent: (risk: number) => void;
  setQuantity: (qty: number) => void;
  openTrade: (input: OpenTradeInput) => OrderOutcome;
  placePendingOrder: (input: PlaceOrderInput) => OrderOutcome;
  updateActivePositionSlTp: (sl: number | null, tp: number | null) => void;
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
    reason?: 'TP' | 'SL' | 'MANUAL',
    exitPrice?: number,
    closeTime?: number,
    exitCostPerUnit?: number
  ) => void;
  /**
   * Close `percent` of the position at market. `bid` is the displayed price;
   * `closeTime` is the replay candle's time — omit it only outside a replay.
   */
  closePartial: (percent: number, bid: number, closeTime?: number) => void;
  setBreakeven: () => void;
  updatePrice: (tick: PriceTick | number, currentTime?: number) => void;
  resetAccount: () => void;
  /** `symbol`, when given, binds the restored account to that instrument. */
  restoreTradeState: (restored: Partial<TradeSnapshot>, symbol?: string) => void;
  getMetrics: () => TradeMetrics;
}

const INITIAL_SNAPSHOT: TradeSnapshot = {
  balance: DEFAULT_BALANCE,
  initialBalance: DEFAULT_BALANCE,
  riskPercent: DEFAULT_RISK_PERCENT,
  quantity: DEFAULT_QUANTITY_LOTS,
  activePosition: null,
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

export const useTradeStore = create<TradeState>((set, get) => {
  /** Costs of `symbol` at `price` under the current settings. */
  const costsOf = (symbol: string | undefined, price: number) => resolveCosts(symbol ?? '', price, get().costs);

  return {
  ...INITIAL_SNAPSHOT,
  accountSymbol: null,
  costs: loadCosts(),

  setAccountSymbol: (accountSymbol) => set({ accountSymbol }),

  setCosts: (patch) => {
    const costs = parseCostSettings({ ...get().costs, ...patch });
    saveCosts(costs);
    set({ costs });
  },

  setRiskPercent: (riskPercent) =>
    set({ riskPercent: safeNumber(riskPercent, DEFAULT_RISK_PERCENT, { min: 0 }) }),

  setQuantity: (quantity) => set({ quantity: safeNumber(quantity, DEFAULT_QUANTITY_LOTS, { min: 0 }) }),

  openTrade: ({ symbol, type, entry: bid, sl, tp, time, lots }) => {
    const { balance, riskPercent, quantity, activePosition } = get();

    if (activePosition) {
      sound.playError();
      return { ok: false, reason: 'POSITION_ALREADY_OPEN' };
    }

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

    set({ activePosition: position });
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

  updateActivePositionSlTp: (sl, tp) => {
    const { activePosition } = get();
    if (!activePosition) return;
    set({ activePosition: { ...activePosition, sl, tp } });
    sound.playClick();
  },

  updatePendingOrder: (id, updates) =>
    set((state) => ({
      pendingOrders: state.pendingOrders.map((o) => (o.id === id ? { ...o, ...updates } : o)),
    })),

  cancelPendingOrder: (id) =>
    set((state) => ({ pendingOrders: state.pendingOrders.filter((o) => o.id !== id) })),

  closePosition: (reason = 'MANUAL', exitPrice, closeTime, exitCostPerUnit = 0) => {
    const { activePosition, closedPositions, balance } = get();
    if (!activePosition) return;

    const exit = Number.isFinite(exitPrice) ? (exitPrice as number) : activePosition.entry;
    const at = Number.isFinite(closeTime) ? (closeTime as number) : Date.now() / 1000;
    const { symbol, size } = activePosition;
    // Entry and exit commissions, charged when the trade is booked.
    const commission = 2 * commissionFor(symbol ?? '', size, costsOf(symbol, exit));
    const pnl = computePnl(activePosition.type, activePosition.entry, exit, size, symbol) - commission;
    const fees = (activePosition.fees ?? 0) + costAmount(symbol, exitCostPerUnit, size, exit) + commission;

    const closed: Position = {
      ...activePosition,
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
      activePosition: null,
      closedPositions: [closed, ...closedPositions],
    });
  },

  closeAtMarket: (bid, closeTime) => {
    const { activePosition } = get();
    if (!activePosition || !Number.isFinite(bid) || bid <= 0) return;
    const exit = marketExitPrice(activePosition.type, bid, costsOf(activePosition.symbol, bid));
    get().closePosition('MANUAL', exit, closeTime, exit - bid);
  },

  closePartial: (percent, bid, closeTime) => {
    const { activePosition, closedPositions, balance } = get();
    if (!activePosition) return;
    if (!Number.isFinite(percent) || percent <= 0 || percent >= 100) return;
    if (!Number.isFinite(bid) || bid <= 0) return;

    // Un reliquat sous le demi-lot minimum n'est plus une position : clôture totale.
    const leftover = activePosition.size * (1 - percent / 100);
    if (unitsToLots(activePosition.symbol ?? '', leftover) < MIN_LOT / 2) {
      get().closeAtMarket(bid, closeTime);
      return;
    }

    const { symbol } = activePosition;
    const costs = costsOf(symbol, bid);
    const currentPrice = marketExitPrice(activePosition.type, bid, costs);
    const closedSize = activePosition.size * (percent / 100);
    const remainingSize = activePosition.size - closedSize;
    const commission = 2 * commissionFor(symbol ?? '', closedSize, costs);
    const pnl =
      computePnl(activePosition.type, activePosition.entry, currentPrice, closedSize, symbol) - commission;
    const share = percent / 100;
    const entryFees = activePosition.fees ?? 0;
    // Replay time, not wall-clock time. `Date.now()` dated every partial close
    // in 2026 inside a 2019 replay; `getMetrics` sorts by `closeTime`, so the
    // partial landed at the end of the equity curve and skewed the drawdown.
    const at = Number.isFinite(closeTime) ? (closeTime as number) : Date.now() / 1000;

    const closedPart: Position = {
      ...activePosition,
      // A partial close is a distinct fill: reusing the parent id made the two
      // rows indistinguishable in the history and in any id-keyed lookup.
      id: newId('trade'),
      size: closedSize,
      // The risk splits with the size, or each half would claim the whole.
      riskAmount:
        activePosition.riskAmount === undefined ? undefined : activePosition.riskAmount * (percent / 100),
      status: 'CLOSED',
      exitPrice: currentPrice,
      closeTime: at,
      closeReason: 'MANUAL',
      pnl,
      fees: entryFees * share + costAmount(symbol, currentPrice - bid, closedSize, currentPrice) + commission,
      pnlPercent: balance > 0 ? (pnl / balance) * 100 : 0,
    };

    if (pnl > 0) sound.playOrderWin();
    else sound.playOrderLoss();

    set({
      balance: balance + pnl,
      activePosition: {
        ...activePosition,
        size: remainingSize,
        fees: entryFees * (1 - share),
        riskAmount:
          activePosition.riskAmount === undefined
            ? undefined
            : activePosition.riskAmount * (1 - percent / 100),
      },
      closedPositions: [closedPart, ...closedPositions],
    });
  },

  setBreakeven: () => {
    const { activePosition } = get();
    if (!activePosition) return;
    set({ activePosition: { ...activePosition, sl: activePosition.entry } });
    sound.playClick();
  },

  /**
   * Advance the simulation by one price tick: fill eligible pending orders, then
   * test the open position against its stop and target.
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

    const { pendingOrders, activePosition } = get();

    if (pendingOrders.length > 0) {
      const remaining: PendingOrder[] = [];
      let activated: Position | null = null;
      let changed = false;

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

        // Only one position at a time: any other triggered order stays pending.
        if (triggered && !activated && !activePosition) {
          activated = {
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
          };
          changed = true;
          sound.playClick();
        } else {
          remaining.push({ ...order, lastCheckedTime: time });
          changed = true;
        }
      }

      if (activated) set({ pendingOrders: remaining, activePosition: activated });
      else if (changed) set({ pendingOrders: remaining });
    }

    const position = get().activePosition;
    if (!position) return;

    // A position filled by a pending order on this very candle is tested on it
    // too (stop first): the fill and the extremes share the candle, and the
    // pessimistic reading is the right default. Any other position only reacts
    // to candles after the last one it saw.
    const filledThisTick = position.time === time && position.lastCheckedTime === undefined;
    if (!filledThisTick && time <= (position.lastCheckedTime ?? position.time)) return;

    // A long exits on the bid (the candle as drawn); a short buys back on the
    // ask, so its stop and target are tested against `price + spread`. Stops
    // execute at market and suffer slippage; targets are limits.
    const { closePosition } = get();
    const costs = costsOf(position.symbol, close);
    if (position.type === 'LONG') {
      if (position.sl !== null && low <= position.sl) {
        closePosition('SL', Math.min(open, position.sl) - costs.slippage, time, costs.slippage);
        return;
      }
      if (position.tp !== null && high >= position.tp) {
        closePosition('TP', Math.max(open, position.tp), time);
        return;
      }
    } else {
      const s = costs.spread;
      if (position.sl !== null && high + s >= position.sl) {
        closePosition('SL', Math.max(open + s, position.sl) + costs.slippage, time, s + costs.slippage);
        return;
      }
      if (position.tp !== null && low + s <= position.tp) {
        closePosition('TP', Math.min(open + s, position.tp), time, s);
        return;
      }
    }

    set({ activePosition: { ...position, lastCheckedTime: time } });
  },

  resetAccount: () => set({ ...INITIAL_SNAPSHOT }),

  /**
   * Restore a snapshot from IndexedDB or an imported session file.
   * Every field is validated: session files are exchanged between users, so the
   * payload is untrusted input, not a typed object.
   */
  restoreTradeState: (restored, symbol) =>
    set({
      ...(symbol ? { accountSymbol: symbol } : {}),
      balance: safeNumber(restored.balance, DEFAULT_BALANCE),
      initialBalance: safeNumber(restored.initialBalance, DEFAULT_BALANCE),
      riskPercent: safeNumber(restored.riskPercent, DEFAULT_RISK_PERCENT, { min: 0 }),
      quantity: safeNumber(restored.quantity, DEFAULT_QUANTITY_LOTS, { min: 0 }),
      activePosition: safePositions(restored.activePosition ? [restored.activePosition] : [])[0] ?? null,
      pendingOrders: safeOrders(restored.pendingOrders),
      closedPositions: safePositions(restored.closedPositions),
    }),

  getMetrics: (): TradeMetrics => {
    const { balance, initialBalance, closedPositions } = get();

    let wins = 0;
    let losses = 0;
    let grossProfit = 0;
    let grossLoss = 0;

    for (const p of closedPositions) {
      const pnl = p.pnl ?? 0;
      if (pnl > 0) {
        wins++;
        grossProfit += pnl;
      } else if (pnl < 0) {
        losses++;
        grossLoss += -pnl;
      }
    }

    // Order by close time rather than trusting insertion order: a restored or
    // imported session can arrive in any order, and the equity curve — hence the
    // drawdown — is meaningless if replayed out of sequence.
    const chronological = [...closedPositions].sort(
      (a, b) => (a.closeTime ?? a.time) - (b.closeTime ?? b.time)
    );

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

    const total = closedPositions.length;

    let rSum = 0;
    let rCount = 0;
    let totalFees = 0;
    for (const p of closedPositions) {
      if (Number.isFinite(p.fees)) totalFees += p.fees as number;
      if (p.riskAmount && p.riskAmount > 0 && Number.isFinite(p.pnl)) {
        rSum += (p.pnl as number) / p.riskAmount;
        rCount++;
      }
    }

    return {
      balance,
      initialBalance,
      totalTrades: total,
      winningTrades: wins,
      losingTrades: losses,
      winRate: total > 0 ? (wins / total) * 100 : 0,
      // Infinity is the honest value for "profits, no losses"; the previous
      // sentinel of 99 was indistinguishable from a real profit factor of 99.
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
      maxDrawdown: Math.round(maxDrawdown * 100) / 100,
      totalPnL: balance - initialBalance,
      expectancy: total > 0 ? (grossProfit - grossLoss) / total : 0,
      averageWin: wins > 0 ? grossProfit / wins : 0,
      averageLoss: losses > 0 ? grossLoss / losses : 0,
      averageR: rCount > 0 ? rSum / rCount : null,
      totalFees,
    };
  },
};
});
