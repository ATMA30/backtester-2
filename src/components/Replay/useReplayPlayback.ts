import { useEffect, useRef } from 'react';
import { useReplayStore } from '../../store/useReplayStore';
import { useMarketStore } from '../../store/useMarketStore';
import { useTradeStore } from '../../store/useTradeStore';
import { useUIStore } from '../../store/useUIStore';
import { ReplayAggregator } from '../../domain/replay-aggregator';
import { setConversionClock } from '../../domain/fx-rates';

/**
 * Drive the replay: advance the cursor while playing, and keep the chart and
 * the trading engine in step with it.
 */
export function useReplayPlayback(): void {
  const { isActive, isPlaying, currentIndex, speedMs, setIsPlaying, setCurrentIndex } = useReplayStore();
  const { baseCandles, setDisplayCandles, activeTF, baseTF } = useMarketStore();
  const updatePrice = useTradeStore((s) => s.updatePrice);
  const showToast = useUIStore((s) => s.showToast);

  // ── REPLAY LOOP ───────────────────────────────────────────
  // The interval reads the index from the store instead of closing over it, so
  // it is created once per play session. Depending on `currentIndex` previously
  // tore the timer down and rebuilt it on every tick, which made the effective
  // playback speed drift away from the selected one.
  useEffect(() => {
    if (!isActive || !isPlaying) return;

    const interval = setInterval(() => {
      const { currentIndex: index } = useReplayStore.getState();
      const { baseCandles: candles } = useMarketStore.getState();

      if (index >= candles.length - 1) {
        setIsPlaying(false);
        showToast('Fin de l’historique atteinte.', 'info', 4000);
        return;
      }
      setCurrentIndex(index + 1);
    }, speedMs);

    return () => clearInterval(interval);
  }, [isActive, isPlaying, speedMs, setCurrentIndex, setIsPlaying, showToast]);

  // ── SLICE SYNC WITH TIMEFRAME AGGREGATION & PRICE UPDATE ───
  // Keep the visible slice, and the trading engine, in step with the cursor.
  //
  // This is the single place that feeds candles to `updatePrice`. The playback
  // loop used to call it too, so every replay candle was processed twice: stops
  // and targets were idempotent, but pending orders were evaluated a second time
  // against the same candle and could fill right after a close that the first
  // pass had correctly blocked.
  /** Last cursor position fed to the engine, and the series it indexed. */
  const lastFedRef = useRef<{ index: number; candles: readonly unknown[] } | null>(null);
  /** Incremental aggregated view: only new candles are folded in on each tick. */
  const aggregatorRef = useRef(new ReplayAggregator());

  useEffect(() => {
    if (!isActive || !baseCandles.length) {
      lastFedRef.current = null;
      aggregatorRef.current.reset();
      // Outside a replay, conversions use the latest known rate.
      setConversionClock(null);
      return;
    }

    const safeIdx = Math.min(Math.max(currentIndex, 0), baseCandles.length - 1);
    if (safeIdx !== currentIndex) {
      setCurrentIndex(safeIdx);
      return;
    }

    // The slice, never `baseCandles`: the previous fallback published the whole
    // series — every future candle included — the moment aggregation returned
    // nothing, which is the one thing a replay must never show.
    setDisplayCandles(aggregatorRef.current.advance(baseCandles, safeIdx, activeTF, baseTF));

    // Feed every candle crossed since the last update, not only the landing
    // one. A jump of N candles with a position open used to test the stop on
    // the destination alone: a stop blown through in between went unseen. Going
    // backwards feeds nothing new — the engine ignores candles it already saw.
    const last = lastFedRef.current;
    const from = last && last.candles === baseCandles && last.index < safeIdx ? last.index + 1 : safeIdx;
    for (let i = from; i <= safeIdx; i++) {
      // Crosses convert at the rate of the candle being evaluated.
      setConversionClock(baseCandles[i].time);
      updatePrice(baseCandles[i]);
    }
    setConversionClock(baseCandles[safeIdx].time);
    lastFedRef.current = { index: safeIdx, candles: baseCandles };
  }, [isActive, currentIndex, baseCandles, activeTF, baseTF, setDisplayCandles, updatePrice, setCurrentIndex]);

  /**
   * Mark the document while replay is on.
   *
   * `body.replay-active` was referenced by the stylesheet but set by nobody —
   * the rule that clears the chart of the trading bar had never once matched.
   * Same failure mode as an undeclared custom property: no error, no warning,
   * just a rule that silently does nothing.
   */
  useEffect(() => {
    if (!isActive) return;
    document.body.classList.add('replay-active');
    return () => document.body.classList.remove('replay-active');
  }, [isActive]);
}
