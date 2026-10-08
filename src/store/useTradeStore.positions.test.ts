import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useTradeStore } from './useTradeStore';
import { getAccountCurrency } from '../domain/instruments';

const store = () => useTradeStore.getState();

const buy = (entry: number, sl: number | null, tp: number | null, time = 1) =>
  store().openTrade({ symbol: 'EURUSD', type: 'LONG', entry, sl, tp, time, lots: 0.1 });
const sell = (entry: number, sl: number | null, tp: number | null, time = 1) =>
  store().openTrade({ symbol: 'EURUSD', type: 'SHORT', entry, sl, tp, time, lots: 0.1 });

describe('useTradeStore — several open positions', () => {
  beforeEach(() => {
    store().setAccountCurrency('USD');
    store().setCosts({ enabled: false });
  });

  it('tests every position against the same candle, each on its own levels', () => {
    buy(1.1, 1.095, 1.12);
    buy(1.1, 1.099, null);
    sell(1.1, 1.12, 1.09);
    // Dips to 1.0985: only the tight stop is hit.
    store().updatePrice({ open: 1.1, high: 1.1005, low: 1.0985, close: 1.099, time: 2 });

    expect(store().openPositions).toHaveLength(2);
    expect(store().closedPositions).toHaveLength(1);
    expect(store().closedPositions[0]).toMatchObject({ closeReason: 'SL', exitPrice: 1.099 });
    // The survivors saw that candle and will not be tested on it again.
    expect(store().openPositions.every((p) => p.lastCheckedTime === 2)).toBe(true);
  });

  it('books each close on the balance', () => {
    buy(1.1, null, null);
    sell(1.1, null, null);
    store().closeAllAtMarket(1.101, 2);

    // +10 pips on the long, −10 on the short, 0.1 lot each: +$10 − $10.
    expect(store().openPositions).toHaveLength(0);
    expect(store().closedPositions.map((p) => Math.round(p.pnl ?? NaN))).toEqual([-10, 10]);
    expect(store().balance).toBeCloseTo(10_000, 6);
  });

  it('acts on the position it is given and on no other', () => {
    buy(1.1, 1.095, null);
    buy(1.2, 1.19, null);
    const [first, second] = store().openPositions;

    store().setBreakeven(second.id);
    expect(store().openPositions.map((p) => p.sl)).toEqual([1.095, 1.2]);

    store().updatePositionSlTp(first.id, 1.09, 1.13);
    expect(store().openPositions[0]).toMatchObject({ sl: 1.09, tp: 1.13 });
    expect(store().openPositions[1]).toMatchObject({ sl: 1.2, tp: null });

    store().closePartial(first.id, 50, 1.11, 3);
    expect(store().openPositions.map((p) => p.size)).toEqual([5_000, 10_000]);

    store().closeAtMarket(second.id, 1.21, 4);
    expect(store().openPositions.map((p) => p.id)).toEqual([first.id]);
  });

  it('moves every stop to its entry when no position is named', () => {
    buy(1.1, 1.095, null);
    sell(1.2, 1.21, null);
    store().setBreakeven();
    expect(store().openPositions.map((p) => p.sl)).toEqual([1.1, 1.2]);
  });

  it('fills every pending order a candle reaches, even with a position open', () => {
    buy(1.1, null, null);
    for (const targetPrice of [1.095, 1.09]) {
      store().placePendingOrder({
        symbol: 'EURUSD', type: 'LONG', orderType: 'LIMIT', targetPrice, entry: targetPrice,
        sl: null, tp: null, time: 1, lots: 0.1,
      });
    }
    store().updatePrice({ open: 1.1, high: 1.1, low: 1.089, close: 1.092, time: 2 });

    expect(store().pendingOrders).toHaveLength(0);
    expect(store().openPositions.map((p) => p.entry)).toEqual([1.1, 1.095, 1.09]);
  });

  it('restores a session saved with a single position', () => {
    store().restoreTradeState({
      balance: 9_000,
      activePosition: { id: 'old', type: 'LONG', entry: 1.1, size: 10_000, time: 1, sl: null, tp: null, status: 'OPEN' },
    });
    expect(store().openPositions.map((p) => p.id)).toEqual(['old']);
  });
});

describe('useTradeStore — account currency', () => {
  afterEach(() => store().setAccountCurrency('USD'));

  it('opens a fresh account in the new currency, keeping the sizing preferences', () => {
    store().setRiskPercent(1);
    buy(1.1, null, null);
    store().closeAtMarket(store().openPositions[0].id, 1.11, 2);
    store().setAccountCurrency('EUR');

    expect(getAccountCurrency()).toBe('EUR');
    expect(store()).toMatchObject({ accountCurrency: 'EUR', balance: 10_000, closedPositions: [], riskPercent: 1 });
  });

  it('books EURUSD results in euros on a euro account', () => {
    store().setCosts({ enabled: false });
    store().setAccountCurrency('EUR');
    buy(1.1, null, null);
    store().closeAtMarket(store().openPositions[0].id, 1.1, 2);
    buy(1.1, null, null);
    // +1 000 pips on 0.1 lot = $1 000, worth 1 000 / 1.2 € at the exit price.
    store().closeAtMarket(store().openPositions[0].id, 1.2, 3);

    expect(store().closedPositions[0].pnl).toBeCloseTo(1_000 / 1.2, 6);
  });

  it('brings a restored session back in its own currency, USD when it predates the choice', () => {
    store().setAccountCurrency('EUR');
    store().restoreTradeState({ balance: 5_000 });
    expect(store().accountCurrency).toBe('USD');
    expect(getAccountCurrency()).toBe('USD');

    store().restoreTradeState({ balance: 5_000, accountCurrency: 'GBP' });
    expect(getAccountCurrency()).toBe('GBP');
  });
});

describe('useTradeStore — journal annotations', () => {
  beforeEach(() => store().resetAccount());

  it('merges fields, drops emptied ones and rejects unknown emotions', () => {
    buy(1.1, null, null);
    const { id } = store().openPositions[0];
    store().annotate(id, { setup: '  cassure  ', emotion: 'calme' });
    store().annotate(id, { note: 'entrée tardive' });
    expect(store().openPositions[0].annotation).toEqual({ setup: 'cassure', emotion: 'calme', note: 'entrée tardive' });

    store().annotate(id, { setup: '', emotion: 'furieux' as never, note: '' });
    expect(store().openPositions[0].annotation).toBeUndefined();
  });

  it('keeps the annotation when the position closes', () => {
    buy(1.1, null, null);
    const { id } = store().openPositions[0];
    store().annotate(id, { setup: 'retour sur zone' });
    store().closeAtMarket(id, 1.1, 2);
    expect(store().closedPositions[0].annotation).toEqual({ setup: 'retour sur zone' });
  });
});
