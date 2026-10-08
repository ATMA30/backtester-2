import { useEffect, useState } from 'react';
import { useReplayStore } from '../../store/useReplayStore';
import { useMarketStore } from '../../store/useMarketStore';
import { useTradeStore } from '../../store/useTradeStore';
import { useUIStore } from '../../store/useUIStore';
import { PositionType } from '../../types/trading';
import { formatPrice, getInstrument } from '../../domain/instruments';
import { REJECTION_MESSAGES, effectiveRiskPercent, riskBasedLots } from '../../domain/position-sizing';
import { resolveCosts, roundTripCostPerUnit } from '../../domain/trading-costs';
import { parseEntryInput, parseProtectionInput, priceOf } from '../../domain/order-input';
import { blockTradingInThePast } from './replayGuards';

/**
 * The order ticket: what the trader typed, what it means once sized, and the
 * submission of an order for either side.
 */
export function useOrderTicket() {
  const { currentIndex } = useReplayStore();
  const { baseCandles, currentSymbol } = useMarketStore();
  const { balance, riskPercent, quantity, setQuantity, openTrade, placePendingOrder, costs } = useTradeStore();
  const showToast = useUIStore((s) => s.showToast);

  const [entryInput, setEntryInput] = useState('');
  const [slInput, setSlInput] = useState('');
  const [tpInput, setTpInput] = useState('');

  const instrument = getInstrument(currentSymbol, baseCandles[currentIndex]?.close);
  const pip = instrument.pip;

  // ── AUTO-SYNC RISK% & QTY BASED ON SL DISTANCE ───────────
  const currentCandle = baseCandles[currentIndex];
  const currentPrice = currentCandle ? currentCandle.close : 0;

  // Keep the QTY field in sync with risk% and the stop distance.
  //
  // The order handlers now pass this quantity explicitly, so what the field shows
  // is exactly what gets traded. Previously the field was computed here with one
  // formula (a `pipValuePerLot` table whose gold branch was dead code, because
  // XAUUSD matched the `length === 6` forex test first) while `openTrade` silently
  // recomputed its own size from the stop and ignored the field entirely.
  useEffect(() => {
    if (!currentPrice) return;

    const entry = priceOf(parseEntryInput(entryInput)) ?? currentPrice;
    const sl = priceOf(parseProtectionInput(slInput, 'sl', true, entry, pip));
    if (sl === null) return;

    const costPerUnit = roundTripCostPerUnit(currentSymbol, entry, resolveCosts(currentSymbol, entry, costs));
    const lots = riskBasedLots(currentSymbol, balance, riskPercent, entry, sl, costPerUnit);
    if (lots !== null && lots !== quantity) setQuantity(lots);
  }, [riskPercent, slInput, entryInput, currentPrice, balance, pip, currentSymbol, quantity, setQuantity, costs]);

  // Calculate RR Ratio preview if SL and TP are set
  let rrRatioStr = '—';
  /** Récompense / risque, en valeur — pour colorer le badge, pas juste l'écrire. */
  let rrRatio: number | null = null;
  const targetEntryVal = priceOf(parseEntryInput(entryInput)) ?? currentPrice;
  const parsedSl = priceOf(parseProtectionInput(slInput, 'sl', true, targetEntryVal, pip));
  const parsedTp = priceOf(parseProtectionInput(tpInput, 'tp', true, targetEntryVal, pip));
  if (parsedSl !== null && parsedTp !== null && targetEntryVal) {
    const risk = Math.abs(targetEntryVal - parsedSl);
    const reward = Math.abs(parsedTp - targetEntryVal);
    if (risk > 0 && reward > 0) {
      rrRatio = reward / risk;
      rrRatioStr = '1 : ' + rrRatio.toFixed(2);
    }
  }

  // Ce que l'ordre risque vraiment, une fois le volume arrondi au pas de lot.
  // Le dimensionnement arrondit au lot minimum : sur un petit compte ou un stop
  // serré, le risque réel dépassait celui demandé sans que rien ne le dise.
  const riskEntry = priceOf(parseEntryInput(entryInput)) ?? currentPrice;
  const riskStop = priceOf(parseProtectionInput(slInput, 'sl', true, riskEntry, pip));
  const realRisk =
    riskStop !== null && riskEntry > 0
      ? effectiveRiskPercent(
          currentSymbol,
          balance,
          riskEntry,
          riskStop,
          quantity,
          roundTripCostPerUnit(currentSymbol, riskEntry, resolveCosts(currentSymbol, riskEntry, costs))
        )
      : null;
  const riskOverrun = realRisk !== null && realRisk > riskPercent * 1.15;

  /**
   * Submit an order for one side.
   *
   * BUY and SELL were two near-identical 20-line blocks that had already drifted
   * (the RR preview used the long-side parser for both). They now share this path,
   * which also surfaces rejections: the store validates the order and returns a
   * reason, instead of the previous silent no-op behind an error beep.
   */
  const submitOrder = (side: PositionType) => {
    if (!currentPrice || !currentCandle) return;
    if (blockTradingInThePast()) return;
    const isLong = side === 'LONG';

    const entryField = parseEntryInput(entryInput);
    if (entryField.kind === 'error') {
      showToast(entryField.message, 'error', 4000);
      return;
    }

    const targetEntry = priceOf(entryField);
    // A price within half a pip of the market is a market order, not a pending one.
    const isPending = targetEntry !== null && Math.abs(targetEntry - currentPrice) > pip * 0.5;
    const entry = isPending && targetEntry !== null ? targetEntry : currentPrice;

    const slField = parseProtectionInput(slInput, 'sl', isLong, entry, pip);
    if (slField.kind === 'error') {
      showToast(slField.message, 'error', 4000);
      return;
    }
    const tpField = parseProtectionInput(tpInput, 'tp', isLong, entry, pip);
    if (tpField.kind === 'error') {
      showToast(tpField.message, 'error', 4000);
      return;
    }

    const common = {
      symbol: currentSymbol,
      type: side,
      sl: priceOf(slField),
      tp: priceOf(tpField),
      time: currentCandle.time,
      // Explicit: the QTY field is what gets traded.
      lots: quantity,
    };

    const label = isLong ? 'Achat' : 'Vente';

    if (isPending && targetEntry !== null) {
      const orderType = (isLong ? targetEntry < currentPrice : targetEntry > currentPrice)
        ? 'LIMIT'
        : 'STOP';
      const outcome = placePendingOrder({ ...common, entry: targetEntry, targetPrice: targetEntry, orderType });
      if (!outcome.ok) {
        showToast(REJECTION_MESSAGES[outcome.reason], 'error', 5000);
        return;
      }
      showToast(`Ordre ${label.toLowerCase()} ${orderType === 'LIMIT' ? 'limite' : 'stop'} placé à ${formatPrice(currentSymbol, targetEntry)}`, 'info', 3500);
      return;
    }

    const outcome = openTrade({ ...common, entry: currentPrice });
    if (!outcome.ok) {
      showToast(REJECTION_MESSAGES[outcome.reason], 'error', 5000);
      return;
    }
    showToast(`Position ${label.toLowerCase()} ouverte à ${formatPrice(currentSymbol, currentPrice)}`, 'success', 2500);
  };

  return {
    entryInput, setEntryInput, slInput, setSlInput, tpInput, setTpInput,
    pip, rrRatio, rrRatioStr, riskEntry, riskStop, realRisk, riskOverrun,
    submitOrder,
  };
}

export type OrderTicket = ReturnType<typeof useOrderTicket>;
