import { beforeEach, describe, expect, it } from 'vitest';
import { useTradeStore } from './useTradeStore';
import { useDrawingStore } from './useDrawingStore';
import { Position } from '../types/trading';

/** The oldest open position, or `null` — what `activePosition` used to be. */
const firstOpen = () => useTradeStore.getState().openPositions[0] ?? null;

// Ces tests portent sur la mécanique du moteur : frais neutralisés. Les frais
// ont leurs propres tests, dans `useTradeStore.costs.test.ts`.
beforeEach(() => {
  useTradeStore.getState().setCosts({ enabled: false });
});

function closedPosition(overrides: Partial<Position> & Pick<Position, 'id' | 'pnl'>): Position {
  return {
    type: 'LONG',
    entry: 1.085,
    sl: null,
    tp: null,
    size: 100_000,
    time: 0,
    status: 'CLOSED',
    ...overrides,
  };
}

describe('useTradeStore — session restoration', () => {
  beforeEach(() => {
    useTradeStore.getState().resetAccount();
  });

  it('restores complete trading state from a saved session', () => {
    const mockPosition: Position = {
      id: 'pos-1',
      symbol: 'EURUSD',
      type: 'LONG',
      entry: 1.085,
      sl: 1.082,
      tp: 1.092,
      size: 2.5,
      time: 1700000000,
      status: 'CLOSED',
      closeReason: 'TP',
      pnl: 175.5,
      exitPrice: 1.092,
      closeTime: 1700003600,
    };

    useTradeStore.getState().restoreTradeState({
      balance: 12500,
      initialBalance: 10000,
      riskPercent: 1.5,
      quantity: 2.0,
      closedPositions: [mockPosition],
      activePosition: null,
      pendingOrders: [],
    });

    const state = useTradeStore.getState();
    expect(state.balance).toBe(12500);
    expect(state.initialBalance).toBe(10000);
    expect(state.closedPositions).toHaveLength(1);
    expect(state.closedPositions[0].id).toBe('pos-1');

    const metrics = state.getMetrics();
    expect(metrics.totalTrades).toBe(1);
    expect(metrics.winningTrades).toBe(1);
    expect(metrics.winRate).toBe(100);
    expect(metrics.totalPnL).toBe(2500);
  });

  it('rejects corrupted fields from an untrusted session file', () => {
    useTradeStore.getState().restoreTradeState({
      balance: Number.NaN,
      initialBalance: 'not-a-number' as unknown as number,
      riskPercent: -5,
      closedPositions: [{ nope: true }, null] as unknown as Position[],
      pendingOrders: 'boom' as unknown as [],
    });

    const state = useTradeStore.getState();
    expect(state.balance).toBe(10000);
    expect(state.initialBalance).toBe(10000);
    expect(state.riskPercent).toBe(2.0);
    expect(state.closedPositions).toEqual([]);
    expect(state.pendingOrders).toEqual([]);
  });
});

describe('useTradeStore — metrics', () => {
  beforeEach(() => {
    useTradeStore.getState().resetAccount();
  });

  it('calculates authentic maximum drawdown from the closed-trade equity curve', () => {
    useTradeStore.getState().restoreTradeState({
      balance: 10500,
      initialBalance: 10000,
      // Newest first, as the store stores them.
      closedPositions: [
        closedPosition({ id: 't-3', pnl: 1500, time: 300, closeTime: 300 }), // 9000 → 10500
        closedPosition({ id: 't-2', pnl: -500, time: 200, closeTime: 200 }), // 9500 → 9000
        closedPosition({ id: 't-1', pnl: -500, time: 100, closeTime: 100 }), // 10000 → 9500
      ],
    });

    const metrics = useTradeStore.getState().getMetrics();
    expect(metrics.totalTrades).toBe(3);
    expect(metrics.winningTrades).toBe(1);
    expect(metrics.losingTrades).toBe(2);
    expect(metrics.maxDrawdown).toBe(10);
    expect(metrics.profitFactor).toBe(1.5);
  });

  it('orders the equity curve by close time, not by array position', () => {
    // Same trades, shuffled: drawdown must stay 10%.
    useTradeStore.getState().restoreTradeState({
      balance: 10500,
      initialBalance: 10000,
      closedPositions: [
        closedPosition({ id: 't-1', pnl: -500, time: 100, closeTime: 100 }),
        closedPosition({ id: 't-3', pnl: 1500, time: 300, closeTime: 300 }),
        closedPosition({ id: 't-2', pnl: -500, time: 200, closeTime: 200 }),
      ],
    });

    expect(useTradeStore.getState().getMetrics().maxDrawdown).toBe(10);
  });

  it('reports an infinite profit factor when there are no losses', () => {
    useTradeStore.getState().restoreTradeState({
      balance: 11000,
      initialBalance: 10000,
      closedPositions: [closedPosition({ id: 'w', pnl: 1000, closeTime: 1 })],
    });

    expect(useTradeStore.getState().getMetrics().profitFactor).toBe(Infinity);
  });
});

describe('useTradeStore — position sizing', () => {
  beforeEach(() => {
    useTradeStore.getState().resetAccount();
    useTradeStore.getState().setRiskPercent(1.0);
  });

  it('derives forex size in units from risk% and stop distance', () => {
    useTradeStore.getState().openTrade({
      symbol: 'EURUSD',
      type: 'LONG',
      entry: 1.085,
      sl: 1.083,
      tp: 1.089,
      time: 1000,
    });

    // 1% of 10 000 = $100 risked over a 0.0020 stop = 50 000 units (0.50 lot).
    expect(firstOpen()?.size).toBe(50_000);
  });

  it('keeps crypto lots as units instead of scaling them by 100 000', () => {
    useTradeStore.getState().openTrade({
      symbol: 'BTCUSDT',
      type: 'LONG',
      entry: 60_000,
      sl: 59_000,
      tp: 62_000,
      time: 1000,
      lots: 0.5,
    });

    expect(firstOpen()?.size).toBe(0.5);
  });

  it('does not scale low-priced crypto by the forex contract size', () => {
    // Regression: the old `entry < 200` test classified DOGEUSDT (~$0.16) as
    // forex and multiplied the position by 100 000.
    useTradeStore.getState().openTrade({
      symbol: 'DOGEUSDT',
      type: 'LONG',
      entry: 0.16,
      sl: 0.15,
      tp: 0.2,
      time: 1000,
      lots: 1,
    });

    expect(firstOpen()?.size).toBe(1);
  });

  it('honours an explicit lot size instead of silently re-deriving it', () => {
    // Regression: the QTY field was cosmetic — `openTrade` recomputed a
    // risk-based size whenever a stop was set and ignored the requested lots.
    useTradeStore.getState().openTrade({
      symbol: 'EURUSD',
      type: 'LONG',
      entry: 1.085,
      sl: 1.083,
      tp: null,
      time: 1000,
      lots: 0.1,
    });

    expect(firstOpen()?.size).toBe(10_000);
  });
});

describe('useTradeStore — order validation', () => {
  beforeEach(() => {
    useTradeStore.getState().resetAccount();
  });

  it('rejects a long whose stop sits above the entry', () => {
    const outcome = useTradeStore.getState().openTrade({
      symbol: 'EURUSD',
      type: 'LONG',
      entry: 1.085,
      sl: 1.09,
      tp: 1.1,
      time: 1000,
      lots: 0.1,
    });

    expect(outcome).toEqual({ ok: false, reason: 'SL_WRONG_SIDE' });
    expect(firstOpen()).toBeNull();
  });

  it('rejects a short whose target sits above the entry', () => {
    const outcome = useTradeStore.getState().openTrade({
      symbol: 'EURUSD',
      type: 'SHORT',
      entry: 1.085,
      sl: 1.09,
      tp: 1.1,
      time: 1000,
      lots: 0.1,
    });

    expect(outcome).toEqual({ ok: false, reason: 'TP_WRONG_SIDE' });
  });

  it('rejects a non-finite entry price', () => {
    const outcome = useTradeStore.getState().openTrade({
      symbol: 'EURUSD',
      type: 'LONG',
      entry: Number.NaN,
      sl: null,
      tp: null,
      time: 1000,
      lots: 0.1,
    });

    expect(outcome).toEqual({ ok: false, reason: 'NON_FINITE_PRICE' });
  });

  it('opens a second position alongside the first', () => {
    const store = useTradeStore.getState();
    store.openTrade({ symbol: 'EURUSD', type: 'LONG', entry: 1.085, sl: null, tp: null, time: 1, lots: 0.1 });
    const outcome = store.openTrade({
      symbol: 'EURUSD',
      type: 'SHORT',
      entry: 1.085,
      sl: null,
      tp: null,
      time: 2,
      lots: 0.1,
    });

    // Several positions may be open at once, long and short together.
    expect(outcome.ok).toBe(true);
    expect(useTradeStore.getState().openPositions.map((p) => p.type)).toEqual(['LONG', 'SHORT']);
  });

  it('gives every order a distinct id even within the same millisecond', () => {
    const store = useTradeStore.getState();
    const a = store.placePendingOrder({
      symbol: 'EURUSD', type: 'LONG', orderType: 'LIMIT', targetPrice: 1.08,
      entry: 1.08, sl: null, tp: null, time: 1, lots: 0.1,
    });
    const b = store.placePendingOrder({
      symbol: 'EURUSD', type: 'LONG', orderType: 'LIMIT', targetPrice: 1.07,
      entry: 1.07, sl: null, tp: null, time: 1, lots: 0.1,
    });

    expect(a.ok && b.ok && a.id !== b.id).toBe(true);
    expect(useTradeStore.getState().pendingOrders).toHaveLength(2);
  });
});

describe('useTradeStore — stop and target fills', () => {
  beforeEach(() => {
    useTradeStore.getState().resetAccount();
  });

  it('fills a long stop at the open when the candle gaps through it', () => {
    const store = useTradeStore.getState();
    store.openTrade({ symbol: 'EURUSD', type: 'LONG', entry: 1.09, sl: 1.085, tp: null, time: 1, lots: 0.1 });

    // Gap down: opens at 1.0800, well below the 1.0850 stop.
    store.updatePrice({ open: 1.08, high: 1.081, low: 1.079, close: 1.0795, time: 2 });

    const closed = useTradeStore.getState().closedPositions[0];
    expect(closed.closeReason).toBe('SL');
    expect(closed.exitPrice).toBe(1.08);
    expect(firstOpen()).toBeNull();
  });

  it('assumes the stop is hit first when one candle spans both stop and target', () => {
    const store = useTradeStore.getState();
    store.openTrade({ symbol: 'EURUSD', type: 'LONG', entry: 1.09, sl: 1.085, tp: 1.095, time: 1, lots: 0.1 });
    store.updatePrice({ open: 1.09, high: 1.096, low: 1.084, close: 1.09, time: 2 });

    expect(useTradeStore.getState().closedPositions[0].closeReason).toBe('SL');
  });

  it('leaves the account untouched when a tick carries a non-finite price', () => {
    const store = useTradeStore.getState();
    store.openTrade({ symbol: 'EURUSD', type: 'LONG', entry: 1.09, sl: 1.085, tp: null, time: 1, lots: 0.1 });
    store.updatePrice({ close: Number.NaN, time: 2 });

    expect(firstOpen()).not.toBeNull();
    expect(useTradeStore.getState().balance).toBe(10000);
  });
});

describe('useTradeStore — restoring untrusted positions', () => {
  beforeEach(() => {
    useTradeStore.getState().resetAccount();
  });

  it('drops a position whose side is missing or unrecognised', () => {
    useTradeStore.getState().restoreTradeState({
      closedPositions: [
        { id: 'ok', type: 'SHORT', entry: 1.1, size: 1000, time: 0, sl: null, tp: null, status: 'CLOSED' },
        // `type` was never validated. Everything downstream branches on
        // `type === 'LONG'`, so these would have been simulated as shorts —
        // booking the P&L with the opposite sign.
        { id: 'no-side', entry: 1.1, size: 1000, time: 0 },
        { id: 'bad-side', type: 'BUY', entry: 1.1, size: 1000, time: 0 },
      ] as never,
    });

    const restored = useTradeStore.getState().closedPositions;
    expect(restored.map((p) => p.id)).toEqual(['ok']);
  });

  it('drops a pending order whose side or kind is unusable', () => {
    useTradeStore.getState().restoreTradeState({
      pendingOrders: [
        { id: 'ok', type: 'LONG', orderType: 'LIMIT', targetPrice: 1.08, size: 1000, time: 0, sl: null, tp: null },
        // A LIMIT and a STOP trigger on opposite sides of the target price:
        // an unrecognised kind cannot be filled correctly either way.
        { id: 'no-kind', type: 'LONG', targetPrice: 1.08, size: 1000, time: 0 },
        { id: 'bad-kind', type: 'LONG', orderType: 'TRAILING', targetPrice: 1.08, size: 1000, time: 0 },
      ] as never,
    });

    expect(useTradeStore.getState().pendingOrders.map((o) => o.id)).toEqual(['ok']);
  });

  it('rejects an active position that cannot be simulated', () => {
    useTradeStore.getState().restoreTradeState({
      activePosition: { id: 'x', entry: 1.1, size: 1000, time: 0 } as never,
    });
    expect(firstOpen()).toBeNull();
  });

  it('keeps a well-formed active position', () => {
    useTradeStore.getState().restoreTradeState({
      activePosition: {
        id: 'x',
        type: 'LONG',
        entry: 1.1,
        size: 1000,
        time: 0,
        sl: null,
        tp: null,
        status: 'OPEN',
      },
    });
    expect(firstOpen()?.id).toBe('x');
  });
});

describe('useDrawingStore', () => {
  it('restores drawings correctly for the active symbol', () => {
    useDrawingStore.getState().restoreDrawings(
      [
        {
          id: 'rect-1',
          type: 'rect',
          pts: [
            { time: 100, price: 1.05 },
            { time: 200, price: 1.1 },
          ],
          style: { color: '#3B82F6', width: 1 },
        },
      ],
      'EURUSD'
    );

    expect(useDrawingStore.getState().drawings).toHaveLength(1);
    expect(useDrawingStore.getState().drawings[0].id).toBe('rect-1');
  });
});

describe('useTradeStore — no lookahead', () => {
  beforeEach(() => {
    useTradeStore.getState().resetAccount();
  });

  const open = (time = 100) =>
    useTradeStore.getState().openTrade({
      symbol: 'EURUSD', type: 'LONG', entry: 1.09, sl: 1.085, tp: 1.1, time, lots: 0.1,
    });

  it('ignores a candle earlier than the entry (stepping back)', () => {
    open(100);
    useTradeStore.getState().updatePrice({ open: 1.09, high: 1.091, low: 1.08, close: 1.088, time: 99 });
    expect(firstOpen()).not.toBeNull();
  });

  it('ignores the entry candle itself (timeframe switch re-feeds it)', () => {
    open(100);
    useTradeStore.getState().updatePrice({ open: 1.09, high: 1.091, low: 1.08, close: 1.09, time: 100 });
    expect(firstOpen()).not.toBeNull();
  });

  it('never processes the same candle twice', () => {
    open(100);
    const store = useTradeStore.getState();
    store.updatePrice({ open: 1.09, high: 1.092, low: 1.088, close: 1.09, time: 101 });
    // Replayed later with a range that would hit the stop: already seen.
    store.updatePrice({ open: 1.09, high: 1.092, low: 1.08, close: 1.09, time: 101 });
    expect(firstOpen()).not.toBeNull();
    store.updatePrice({ open: 1.09, high: 1.092, low: 1.08, close: 1.09, time: 102 });
    expect(firstOpen()).toBeNull();
    expect(useTradeStore.getState().closedPositions[0].closeReason).toBe('SL');
  });

  it('does not fill a pending order on the candle it was placed on', () => {
    useTradeStore.getState().placePendingOrder({
      symbol: 'EURUSD', type: 'LONG', orderType: 'LIMIT', entry: 1.08, targetPrice: 1.08,
      sl: null, tp: null, time: 100, lots: 0.1,
    });
    useTradeStore.getState().updatePrice({ open: 1.09, high: 1.09, low: 1.07, close: 1.085, time: 100 });
    expect(firstOpen()).toBeNull();
    useTradeStore.getState().updatePrice({ open: 1.085, high: 1.086, low: 1.079, close: 1.08, time: 101 });
    expect(firstOpen()?.entry).toBe(1.08);
  });

  it('dates a partial close with the replay candle, not the wall clock', () => {
    open(100);
    useTradeStore.getState().closePartial(firstOpen()!.id, 50, 1.095, 150);
    expect(useTradeStore.getState().closedPositions[0].closeTime).toBe(150);
  });
});

describe('useTradeStore — metrics in R', () => {
  beforeEach(() => useTradeStore.getState().resetAccount());

  it('freezes the risk at entry and reports the mean result in R', () => {
    const store = useTradeStore.getState();
    // 0.1 lot, 50-pip stop: $50 at risk.
    store.openTrade({ symbol: 'EURUSD', type: 'LONG', entry: 1.1, sl: 1.095, tp: null, time: 1, lots: 0.1 });
    expect(firstOpen()?.riskAmount).toBeCloseTo(50, 6);
    // Moving the stop to breakeven must not erase what the trade risked.
    useTradeStore.getState().setBreakeven();
    useTradeStore.getState().closePosition(firstOpen()!.id, 'MANUAL', 1.11, 2); // +$100 = +2 R

    const m = useTradeStore.getState().getMetrics();
    expect(m.averageR).toBeCloseTo(2, 6);
    expect(m.expectancy).toBeCloseTo(100, 6);
    expect(m.averageWin).toBeCloseTo(100, 6);
    expect(m.averageLoss).toBe(0);
  });
});

describe('useTradeStore — restored levels', () => {
  beforeEach(() => useTradeStore.getState().resetAccount());

  it('drops a non-numeric stop instead of keeping a stop that never fires', () => {
    useTradeStore.getState().restoreTradeState({
      activePosition: { id: 'p', type: 'LONG', entry: 1.1, size: 1000, time: 1, sl: 'abc', tp: Number.NaN, status: 'OPEN' } as never,
    });
    const restored = firstOpen();
    expect(restored?.sl).toBeNull();
    expect(restored?.tp).toBeNull();
  });

  it('closes fully when a partial close would leave dust', () => {
    useTradeStore.getState().openTrade({ symbol: 'EURUSD', type: 'LONG', entry: 1.1, sl: null, tp: null, time: 1, lots: 1 });
    useTradeStore.getState().closePartial(firstOpen()!.id, 99.999, 1.11, 2);
    expect(firstOpen()).toBeNull();
  });
});
