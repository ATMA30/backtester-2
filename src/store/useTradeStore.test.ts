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

  it('calculates authentic maximum drawdown from closed trades', () => {
    const tradeLoss1: Position = {
      id: 't-1',
      type: 'LONG',
      entry: 1.085,
      sl: 1.08,
      tp: null,
      size: 100000,
      time: 100,
      status: 'CLOSED',
      closeReason: 'SL',
      pnl: -500, // Balance 10000 -> 9500 (DD: 5%)
    };
    const tradeLoss2: Position = {
      id: 't-2',
      type: 'LONG',
      entry: 1.08,
      sl: 1.075,
      tp: null,
      size: 100000,
      time: 200,
      status: 'CLOSED',
      closeReason: 'SL',
      pnl: -500, // Balance 9500 -> 9000 (DD: 10%)
    };
    const tradeWin: Position = {
      id: 't-3',
      type: 'LONG',
      entry: 1.075,
      sl: null,
      tp: 1.09,
      size: 100000,
      time: 300,
      status: 'CLOSED',
      closeReason: 'TP',
      pnl: 1500, // Balance 9000 -> 10500 (New Peak)
    };

    useTradeStore.getState().restoreTradeState({
      balance: 10500,
      initialBalance: 10000,
      riskPercent: 1.0,
      quantity: 1.0,
      closedPositions: [tradeWin, tradeLoss2, tradeLoss1],
      activePosition: null,
      pendingOrders: [],
    });

    const metrics = useTradeStore.getState().getMetrics();
    expect(metrics.totalTrades).toBe(3);
    expect(metrics.winningTrades).toBe(1);
    expect(metrics.losingTrades).toBe(2);
    expect(metrics.maxDrawdown).toBe(10); // 10% peak-to-trough
    expect(metrics.profitFactor).toBe(1.5); // 1500 / 1000 = 1.5
  });

  it('correctly handles Forex lots vs Crypto units in openTrade', () => {
    // 1. Forex test (entry < 200)
    useTradeStore.getState().openTrade('LONG', 1.0850, 1.0830, 1.0890, 1000);
    let active = useTradeStore.getState().activePosition;
    expect(active).not.toBeNull();
    // 1% of 10000 = $100. SL distance = 0.0020. Size = 100 / 0.0020 = 50000 units (0.50 lot)
    expect(active?.size).toBe(50000);

    // Reset and test Crypto / High value asset (entry > 200)
    useTradeStore.getState().resetAccount();
    useTradeStore.getState().openTrade('LONG', 60000, 59000, 62000, 1000, 0.5); // 0.5 BTC
    active = useTradeStore.getState().activePosition;
    expect(active?.size).toBe(0.5); // Kept as 0.5 BTC, not multiplied by 100,000!
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
