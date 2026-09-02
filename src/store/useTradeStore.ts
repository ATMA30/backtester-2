import { create } from 'zustand';
import { Position, PositionType, PendingOrder, TradeMetrics } from '../types/trading';
import { sound } from '../services/audio';

interface CandleData {
  open?: number;
  high?: number;
  low?: number;
  close: number;
  time?: number;
}

interface TradeState {
  balance: number;
  initialBalance: number;
  riskPercent: number;
  quantity: number;
  activePosition: Position | null;
  pendingOrders: PendingOrder[];
  closedPositions: Position[];

  setRiskPercent: (risk: number) => void;
  setQuantity: (qty: number) => void;
  openTrade: (type: PositionType, entry: number, sl: number | null, tp: number | null, time: number, customSize?: number) => void;
  placePendingOrder: (type: PositionType, orderType: 'LIMIT' | 'STOP', targetPrice: number, sl: number | null, tp: number | null, time: number, customSize?: number) => void;
  cancelPendingOrder: (id: string) => void;
  closePosition: (reason?: 'TP' | 'SL' | 'MANUAL', exitPrice?: number, closeTime?: number) => void;
  closePartial: (percent: number, currentPrice: number) => void;
  setBreakeven: (currentPrice?: number) => void;
  updatePrice: (candleOrPrice: CandleData | number, currentTime?: number) => void;
  resetAccount: () => void;
  getMetrics: () => TradeMetrics;
}

export const useTradeStore = create<TradeState>((set, get) => ({
  balance: 10000,
  initialBalance: 10000,
  riskPercent: 2.0,
  quantity: 1.0,
  activePosition: null,
  pendingOrders: [],
  closedPositions: [],

  setRiskPercent: (riskPercent) => set({ riskPercent }),
  setQuantity: (quantity) => set({ quantity }),

  openTrade: (type, entry, sl, tp, time, customSize) => {
    const { balance, riskPercent, quantity } = get();
    let size = customSize || quantity;

    if (!customSize && sl !== null) {
      const riskAmount = (balance * riskPercent) / 100;
      const slDistance = Math.abs(entry - sl);
      if (slDistance > 0) {
        size = Math.max(0.01, parseFloat((riskAmount / slDistance).toFixed(2)));
      }
    }

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

  placePendingOrder: (type, orderType, targetPrice, sl, tp, time, customSize) => {
    const { balance, riskPercent, quantity, pendingOrders } = get();
    let size = customSize || quantity;

    if (!customSize && sl !== null) {
      const riskAmount = (balance * riskPercent) / 100;
      const slDistance = Math.abs(targetPrice - sl);
      if (slDistance > 0) {
        size = Math.max(0.01, parseFloat((riskAmount / slDistance).toFixed(2)));
      }
    }

    const newOrder: PendingOrder = {
      id: 'order_' + Date.now(),
      type,
      orderType,
      targetPrice,
      sl,
      tp,
      size,
      time,
    };

    set({ pendingOrders: [...pendingOrders, newOrder] });
    sound.playClick();
  },

  cancelPendingOrder: (id) => {
    const { pendingOrders } = get();
    set({ pendingOrders: pendingOrders.filter((o) => o.id !== id) });
    sound.playClick();
  },

  closePosition: (reason = 'MANUAL', exitPrice, closeTime) => {
    const { activePosition, closedPositions, balance } = get();
    if (!activePosition) return;

    const exit = exitPrice !== undefined ? exitPrice : activePosition.entry;
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

  setBreakeven: (currentPrice) => {
    const { activePosition } = get();
    if (!activePosition) return;
    set({ activePosition: { ...activePosition, sl: activePosition.entry } });
    sound.playClick();
  },

  updatePrice: (candleOrPrice, currentTime) => {
    const isCandle = typeof candleOrPrice === 'object' && candleOrPrice !== null;
    const currentPrice = isCandle ? candleOrPrice.close : (candleOrPrice as number);
    const high = isCandle ? (candleOrPrice.high ?? currentPrice) : currentPrice;
    const low = isCandle ? (candleOrPrice.low ?? currentPrice) : currentPrice;
    const open = isCandle ? (candleOrPrice.open ?? currentPrice) : currentPrice;
    const time = isCandle ? (candleOrPrice.time ?? (currentTime || Date.now() / 1000)) : (currentTime || Date.now() / 1000);

    const { activePosition, pendingOrders, closePosition } = get();

    // 1. Process Pending Orders (Limits / Stops)
    if (pendingOrders && pendingOrders.length > 0) {
      const remaining: PendingOrder[] = [];
      let activated: Position | null = null;

      for (const order of pendingOrders) {
        let isTriggered = false;
        let execPrice = order.targetPrice;

        if (order.type === 'LONG') {
          if (order.orderType === 'LIMIT' && low <= order.targetPrice) {
            isTriggered = true;
            execPrice = Math.min(open, order.targetPrice);
          } else if (order.orderType === 'STOP' && high >= order.targetPrice) {
            isTriggered = true;
            execPrice = Math.max(open, order.targetPrice);
          }
        } else if (order.type === 'SHORT') {
          if (order.orderType === 'LIMIT' && high >= order.targetPrice) {
            isTriggered = true;
            execPrice = Math.max(open, order.targetPrice);
          } else if (order.orderType === 'STOP' && low <= order.targetPrice) {
            isTriggered = true;
            execPrice = Math.min(open, order.targetPrice);
          }
        }

        if (isTriggered && !activated && !activePosition) {
          activated = {
            id: order.id,
            type: order.type,
            entry: execPrice,
            sl: order.sl,
            tp: order.tp,
            size: order.size,
            time,
            status: 'OPEN',
          };
          sound.playClick();
        } else {
          remaining.push(order);
        }
      }

      if (activated) {
        set({
          pendingOrders: remaining,
          activePosition: activated,
        });
      } else if (remaining.length !== pendingOrders.length) {
        set({ pendingOrders: remaining });
      }
    }

    // 2. Check Active Position SL / TP (only if explicitly set)
    const pos = get().activePosition;
    if (!pos) return;

    if (pos.type === 'LONG') {
      if (pos.sl !== null && low <= pos.sl) {
        closePosition('SL', pos.sl, time);
      } else if (pos.tp !== null && high >= pos.tp) {
        closePosition('TP', pos.tp, time);
      }
    } else if (pos.type === 'SHORT') {
      if (pos.sl !== null && high >= pos.sl) {
        closePosition('SL', pos.sl, time);
      } else if (pos.tp !== null && low <= pos.tp) {
        closePosition('TP', pos.tp, time);
      }
    }
  },

  resetAccount: () =>
    set({
      balance: 10000,
      initialBalance: 10000,
      activePosition: null,
      pendingOrders: [],
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

