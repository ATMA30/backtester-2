import { create } from 'zustand';
import { Position, PositionType, TradeMetrics } from '../types/trading';
import { sound } from '../services/audio';

interface TradeState {
  balance: number;
  initialBalance: number;
  riskPercent: number;
  quantity: number;
  activePosition: Position | null;
  closedPositions: Position[];

  setRiskPercent: (risk: number) => void;
  setQuantity: (qty: number) => void;
  openTrade: (type: PositionType, entry: number, sl: number | null, tp: number | null, time: number) => void;
  closePosition: (reason?: 'TP' | 'SL' | 'MANUAL', exitPrice?: number, closeTime?: number) => void;
  closePartial: (percent: number, currentPrice: number) => void;
  setBreakeven: (currentPrice: number) => void;
  updatePrice: (currentPrice: number, currentTime: number) => void;
  resetAccount: () => void;
  getMetrics: () => TradeMetrics;
}

export const useTradeStore = create<TradeState>((set, get) => ({
  balance: 10000,
  initialBalance: 10000,
  riskPercent: 2.0,
  quantity: 1.0,
  activePosition: null,
  closedPositions: [],

  setRiskPercent: (riskPercent) => set({ riskPercent }),
  setQuantity: (quantity) => set({ quantity }),

  openTrade: (type, entry, sl, tp, time) => {
    const { balance, riskPercent, quantity } = get();
    const riskAmount = (balance * riskPercent) / 100;
    const slDistance = sl ? Math.abs(entry - sl) : entry * 0.01;
    const size = slDistance > 0 ? riskAmount / slDistance : quantity;

    const newPos: Position = {
      id: 'trade_' + Date.now(),
      type,
      entry,
      sl,
      tp,
      size,
      time,
      status: 'OPEN',
    };

    set({ activePosition: newPos });
    sound.playClick();
  },

  closePosition: (reason = 'MANUAL', exitPrice, closeTime) => {
    const { activePosition, closedPositions, balance } = get();
    if (!activePosition) return;

    const exit = exitPrice || activePosition.entry;
    const cTime = closeTime || Date.now() / 1000;
    const pnl =
      activePosition.type === 'LONG'
        ? (exit - activePosition.entry) * activePosition.size
        : (activePosition.entry - exit) * activePosition.size;
    const pnlPercent = (pnl / balance) * 100;

    const closed: Position = {
      ...activePosition,
      status: 'CLOSED',
      exitPrice: exit,
      closeTime: cTime,
      closeReason: reason,
      pnl,
      pnlPercent,
    };

    if (pnl > 0) sound.playOrderWin();
    else sound.playOrderLoss();

    set({
      balance: balance + pnl,
      activePosition: null,
      closedPositions: [closed, ...closedPositions],
    });
  },

  closePartial: (percent, currentPrice) => {
    const { activePosition, closedPositions, balance } = get();
    if (!activePosition || percent <= 0 || percent >= 100) return;

    const closeRatio = percent / 100;
    const closedSize = activePosition.size * closeRatio;
    const remainingSize = activePosition.size - closedSize;

    const pnl =
      activePosition.type === 'LONG'
        ? (currentPrice - activePosition.entry) * closedSize
        : (activePosition.entry - currentPrice) * closedSize;

    const closedPart: Position = {
      ...activePosition,
      size: closedSize,
      status: 'CLOSED',
      exitPrice: currentPrice,
      closeTime: Date.now() / 1000,
      closeReason: 'MANUAL',
      pnl,
      pnlPercent: (pnl / balance) * 100,
    };

    if (pnl > 0) sound.playOrderWin();

    set({
      balance: balance + pnl,
      activePosition: { ...activePosition, size: remainingSize },
      closedPositions: [closedPart, ...closedPositions],
    });
  },

  setBreakeven: () => {
    const { activePosition } = get();
    if (!activePosition) return;
    set({ activePosition: { ...activePosition, sl: activePosition.entry } });
    sound.playClick();
  },

  updatePrice: (currentPrice, currentTime) => {
    const { activePosition, closePosition } = get();
    if (!activePosition) return;

    if (activePosition.type === 'LONG') {
      if (activePosition.sl && currentPrice <= activePosition.sl) {
        closePosition('SL', activePosition.sl, currentTime);
      } else if (activePosition.tp && currentPrice >= activePosition.tp) {
        closePosition('TP', activePosition.tp, currentTime);
      }
    } else if (activePosition.type === 'SHORT') {
      if (activePosition.sl && currentPrice >= activePosition.sl) {
        closePosition('SL', activePosition.sl, currentTime);
      } else if (activePosition.tp && currentPrice <= activePosition.tp) {
        closePosition('TP', activePosition.tp, currentTime);
      }
    }
  },

  resetAccount: () =>
    set({
      balance: 10000,
      initialBalance: 10000,
      activePosition: null,
      closedPositions: [],
    }),

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
