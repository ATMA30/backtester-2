import { beforeEach, describe, expect, it } from 'vitest';
import { useTradeStore } from './useTradeStore';
import { useDrawingStore } from './useDrawingStore';
import { Position } from '../types/trading';

describe('Session restoration in stores', () => {
  beforeEach(() => {
    useTradeStore.getState().resetAccount();
  });

  it('restores complete trading state from a saved session', () => {
    const mockPosition: Position = {
      id: 'pos-1',
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

  it('restores drawings correctly for the active symbol', () => {
    useDrawingStore.getState().restoreDrawings([
      {
        id: 'rect-1',
        type: 'rect',
        pts: [
          { time: 100, price: 1.05 },
          { time: 200, price: 1.1 },
        ],
        style: { color: '#3B82F6', width: 1 },
      },
    ], 'EURUSD');

    expect(useDrawingStore.getState().drawings).toHaveLength(1);
    expect(useDrawingStore.getState().drawings[0].id).toBe('rect-1');
  });
});
