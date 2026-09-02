import { create } from 'zustand';
import { Position, PositionType, TradeMetrics } from '../types/trading';

interface TradeState {
  balance: number;
  initialBalance: number;
  riskPercent: number;
  positions: Position[];
  closedPositions: Position[];
  
  openPosition: (type: PositionType, entry: number, sl: number | null, tp: number | null, time: number) => void;
  closePosition: (id: string, exitPrice: number, closeTime: number, reason: 'TP' | 'SL' | 'MANUAL') => void;
  updatePositionsOnPrice: (currentPrice: number, currentTime: number) => void;
  resetAccount: () => void;
  getMetrics: () => TradeMetrics;
}

export const useTradeStore = create<TradeState>((set, get) => ({
  balance: 10000,
  initialBalance: 10000,
  riskPercent: 1.0,
  positions: [],
  closedPositions: [],

  openPosition: (type, entry, sl, tp, time) => {
    const { balance, riskPercent } = get();
    const riskAmount = (balance * riskPercent) / 100;
    const slDistance = sl ? Math.abs(entry - sl) : entry * 0.01;
    const size = slDistance > 0 ? riskAmount / slDistance : 1;

    const newPosition: Position = {
      id: 'pos_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      type,
      entry,
      sl,
      tp,
      size,
      time,
      status: 'OPEN',
    };

    set((state) => ({ positions: [...state.positions, newPosition] }));
  },

  closePosition: (id, exitPrice, closeTime, reason) => {
    const { positions, closedPositions, balance } = get();
    const pos = positions.find((p) => p.id === id);
    if (!pos) return;

    const pnl = pos.type === 'LONG' ? (exitPrice - pos.entry) * pos.size : (pos.entry - exitPrice) * pos.size;
    const pnlPercent = (pnl / balance) * 100;

    const closedPos: Position = {
      ...pos,
      status: 'CLOSED',
      exitPrice,
      closeTime,
      closeReason: reason,
      pnl,
      pnlPercent,
    };

    set({
      balance: balance + pnl,
      positions: positions.filter((p) => p.id !== id),
      closedPositions: [closedPos, ...closedPositions],
    });
  },

  updatePositionsOnPrice: (currentPrice, currentTime) => {
    const { positions, closePosition } = get();
    for (const p of positions) {
      if (p.type === 'LONG') {
        if (p.sl && currentPrice <= p.sl) closePosition(p.id, p.sl, currentTime, 'SL');
        else if (p.tp && currentPrice >= p.tp) closePosition(p.id, p.tp, currentTime, 'TP');
      } else if (p.type === 'SHORT') {
        if (p.sl && currentPrice >= p.sl) closePosition(p.id, p.sl, currentTime, 'SL');
        else if (p.tp && currentPrice <= p.tp) closePosition(p.id, p.tp, currentTime, 'TP');
      }
    }
  },

  resetAccount: () => set({ balance: 10000, initialBalance: 10000, positions: [], closedPositions: [] }),

  getMetrics: () => {
    const { balance, initialBalance, closedPositions } = get();
    const total = closedPositions.length;
    const wins = closedPositions.filter((p) => (p.pnl || 0) > 0);
    const losses = closedPositions.filter((p) => (p.pnl || 0) < 0);
    const totalWins = wins.reduce((acc, p) => acc + (p.pnl || 0), 0);
    const totalLosses = Math.abs(losses.reduce((acc, p) => acc + (p.pnl || 0), 0));

    return {
      balance,
      initialBalance,
      totalTrades: total,
      winningTrades: wins.length,
      losingTrades: losses.length,
      winRate: total > 0 ? (wins.length / total) * 100 : 0,
      profitFactor: totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? 99 : 1,
      maxDrawdown: 0,
      totalPnL: balance - initialBalance,
    };
  },
}));
