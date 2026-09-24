import { beforeEach, describe, expect, it } from 'vitest';
import { useMarketStore } from './useMarketStore';
import { TimeframeSeconds } from '../domain/timeframes';
import { Candle } from '../types/market';

/** A daily series long enough to qualify for the deep-history cache. */
function dailySeries(count: number, startEpoch = 1_600_000_000): Candle[] {
  return Array.from({ length: count }, (_, i) => ({
    time: startEpoch + i * TimeframeSeconds.D1,
    open: 1.1,
    high: 1.11,
    low: 1.09,
    close: 1.105,
    volume: 0,
  }));
}

describe('useMarketStore — daily history cache', () => {
  beforeEach(() => {
    useMarketStore.setState({ dailyMasterMap: {}, currentSymbol: 'EURUSD' });
  });

  it('caches a deep daily series per symbol', () => {
    useMarketStore.getState().setSymbol('GBPUSD');
    useMarketStore.getState().setBaseCandles(dailySeries(600), TimeframeSeconds.D1);
    expect(Object.keys(useMarketStore.getState().dailyMasterMap)).toContain('GBPUSD');
  });

  it('does not cache a series too short to be real history', () => {
    useMarketStore.getState().setSymbol('AUDUSD');
    useMarketStore.getState().setBaseCandles(dailySeries(100), TimeframeSeconds.D1);
    expect(useMarketStore.getState().dailyMasterMap).not.toHaveProperty('AUDUSD');
  });

  it('bounds the cache instead of retaining every symbol visited', () => {
    // The map grew without limit, so browsing the catalogue kept every
    // instrument's full daily series resident for the rest of the session.
    const symbols = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD', 'EURGBP'];
    for (const symbol of symbols) {
      useMarketStore.getState().setSymbol(symbol);
      useMarketStore.getState().setBaseCandles(dailySeries(600), TimeframeSeconds.D1);
    }

    const cached = Object.keys(useMarketStore.getState().dailyMasterMap);
    expect(cached.length).toBeLessThanOrEqual(6);
    // The symbol just loaded is always the one kept.
    expect(cached).toContain('EURGBP');
    // The oldest is the one dropped.
    expect(cached).not.toContain('EURUSD');
  });

  it('re-caching a symbol does not grow the map', () => {
    useMarketStore.getState().setSymbol('GBPUSD');
    useMarketStore.getState().setBaseCandles(dailySeries(600), TimeframeSeconds.D1);
    useMarketStore.getState().setBaseCandles(dailySeries(700), TimeframeSeconds.D1);
    expect(Object.keys(useMarketStore.getState().dailyMasterMap)).toEqual(['GBPUSD']);
  });
});
