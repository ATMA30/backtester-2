import { beforeEach, describe, expect, it } from 'vitest';
import { useTradeStore } from './useTradeStore';

const store = () => useTradeStore.getState();

describe('useTradeStore — spread, commission, slippage', () => {
  beforeEach(() => {
    store().resetAccount();
    // EURUSD : 1 pip de spread, 3,5 $ par lot et par sens, pas de slippage.
    store().setCosts({ enabled: true, spreadPips: 1, commissionPerLot: 3.5, slippagePips: 0 });
  });

  it('buys at the ask and charges both commissions', () => {
    store().openTrade({ symbol: 'EURUSD', type: 'LONG', entry: 1.1, sl: null, tp: null, time: 1, lots: 1 });
    expect(store().activePosition?.entry).toBeCloseTo(1.1001, 10);

    // Closing at the same bid loses the spread ($10) and two commissions ($7).
    store().closeAtMarket(1.1, 2);
    const trade = store().closedPositions[0];
    expect(trade.pnl).toBeCloseTo(-17, 6);
    expect(trade.fees).toBeCloseTo(17, 6);
    expect(store().getMetrics().totalFees).toBeCloseTo(17, 6);
  });

  it('sells at the bid and buys back at the ask', () => {
    store().openTrade({ symbol: 'EURUSD', type: 'SHORT', entry: 1.1, sl: null, tp: null, time: 1, lots: 1 });
    expect(store().activePosition?.entry).toBe(1.1);
    store().closeAtMarket(1.1, 2);
    expect(store().closedPositions[0].exitPrice).toBeCloseTo(1.1001, 10);
  });

  it('triggers a short stop on the ask, not on the drawn candle', () => {
    store().openTrade({ symbol: 'EURUSD', type: 'SHORT', entry: 1.1, sl: 1.1010, tp: null, time: 1, lots: 1 });
    // The bid high reaches 1.1009.5: the ask (bid + 1 pip) crosses the stop.
    store().updatePrice({ open: 1.1, high: 1.10095, low: 1.0995, close: 1.1, time: 2 });
    expect(store().activePosition).toBeNull();
    expect(store().closedPositions[0].closeReason).toBe('SL');
  });

  it('slips stop losses but not targets', () => {
    store().setCosts({ slippagePips: 2 });
    store().openTrade({ symbol: 'EURUSD', type: 'LONG', entry: 1.1, sl: 1.099, tp: null, time: 1, lots: 1 });
    store().updatePrice({ open: 1.0995, high: 1.0996, low: 1.098, close: 1.0985, time: 2 });
    expect(store().closedPositions[0].exitPrice).toBeCloseTo(1.0988, 10);
  });

  it('charges nothing when costs are switched off', () => {
    store().setCosts({ enabled: false });
    store().openTrade({ symbol: 'EURUSD', type: 'LONG', entry: 1.1, sl: null, tp: null, time: 1, lots: 1 });
    store().closeAtMarket(1.1, 2);
    expect(store().closedPositions[0].pnl).toBe(0);
  });

  it('survives a reset of the account', () => {
    store().resetAccount();
    expect(store().costs.enabled).toBe(true);
    expect(store().costs.spreadPips).toBe(1);
  });
});
