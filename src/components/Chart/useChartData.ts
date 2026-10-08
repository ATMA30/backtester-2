import { MutableRefObject, useEffect, useRef } from 'react';
import { IChartApi, ISeriesApi } from 'lightweight-charts';
import { useMarketStore } from '../../store/useMarketStore';
import { useReplayStore } from '../../store/useReplayStore';
import { Candle } from '../../types/market';
import { computeIndicator, DEFAULT_PERIODS } from '../../domain/indicators';
import { droppedLeadingBars, isTailUpdate } from '../../domain/series-diff';
import { applyResponsiveScaleMargins, asChartTime } from './chartSetup';
import { ChartViewportControls } from './useChartViewport';

/** Candles an indicator is recomputed on during playback (see the incremental path). */
const INDICATOR_TAIL = 3_000;

interface ChartDataInput {
  readonly chart: IChartApi | null;
  readonly mainSeries: ISeriesApi<'Candlestick' | 'Bar' | 'Line' | 'Area'> | null;
  readonly volumeSeries: ISeriesApi<'Histogram'> | null;
  readonly indicatorSeriesMapRef: MutableRefObject<Map<string, ISeriesApi<'Line'>>>;
  readonly viewport: ChartViewportControls;
  /** Volume shown: asked for, and present in the data. */
  readonly volumeVisible: boolean;
}

/**
 * Push the displayed candles, the volume and the indicators into the chart,
 * and decide what the view does with them: refit, keep the time window, follow
 * the replay, or stay where the user put it.
 */
export function useChartData({ chart, mainSeries, volumeSeries, indicatorSeriesMapRef, viewport, volumeVisible }: ChartDataInput): void {
  const { displayCandles, activeTF, chartType, activeIndicators, currentSymbol } = useMarketStore();
  const { isActive: isReplayActive, currentIndex } = useReplayStore();

  const prevTFRef = useRef<number | null>(null);
  const prevSymbolRef = useRef<string | null>(null);
  const prevReplayActiveRef = useRef<boolean>(false);
  const prevReplayIndexRef = useRef<number | null>(null);
  const prevBarCountRef = useRef(0);
  const prevDisplayCandlesRef = useRef<Candle[] | null>(null);
  // Settings the incremental path must not have seen change since the last paint.
  // `null` until the first paint, which always rebuilds the series in full.
  const prevChartTypeRef = useRef<unknown>(null);
  const prevVolumeVisibleRef = useRef<unknown>(null);
  const prevIndicatorsRef = useRef<unknown>(null);
  /**
   * Latched viewport intent.
   *
   * Entering replay flips `isActive` in one store update and rewrites
   * `displayCandles` in another (ReplayBar's slice effect). This effect
   * therefore runs once with the new mode but the *old* data. Reading the mode
   * edge directly meant that run consumed the "recentre" intent, and the run
   * that actually carried the replay slice fell through to the preserve branch
   * — leaving 2 800 bars crammed at the minimum bar spacing, i.e. a blank chart.
   */
  const pendingIntentRef = useRef<'refit' | 'keep-time' | null>(null);

  // ── SET DATA & INTELLIGENT VIEWPORT MANAGEMENT ────────────
  useEffect(() => {
    if (!mainSeries || !displayCandles.length) return;

    const isFirstData = prevTFRef.current === null;
    const isTFChange = !isFirstData && prevTFRef.current !== activeTF;
    const isSymbolChange = prevSymbolRef.current !== null && prevSymbolRef.current !== currentSymbol;
    const isReplayJustStarted = !prevReplayActiveRef.current && isReplayActive;
    const isReplayJustStopped = prevReplayActiveRef.current && !isReplayActive;
    // A cursor move of more than a few bars is a seek (anchor, random start,
    // date jump), not playback — the viewport should re-centre for those.
    const isReplaySeek =
      isReplayActive &&
      prevReplayIndexRef.current !== null &&
      Math.abs(currentIndex - prevReplayIndexRef.current) > 3;

    // Snapshot the user's view *before* `setData` replaces the series. Reading
    // it afterwards returns the library's recomputed range, not the user's.
    const snapshot = viewport.capture(prevBarCountRef.current);

    // Latch the intent now; apply it once the data catches up.
    if (isSymbolChange || isFirstData || isReplayJustStopped || isReplayJustStarted || isReplaySeek) {
      pendingIntentRef.current = 'refit';
    } else if (isTFChange) {
      pendingIntentRef.current = 'keep-time';
    }

    const dataChanged = prevDisplayCandlesRef.current !== displayCandles;
    const previousCandles = prevDisplayCandlesRef.current;
    const settingsUnchanged =
      prevChartTypeRef.current === chartType &&
      prevVolumeVisibleRef.current === volumeVisible &&
      prevIndicatorsRef.current === activeIndicators;
    prevChartTypeRef.current = chartType;
    prevVolumeVisibleRef.current = volumeVisible;
    prevIndicatorsRef.current = activeIndicators;
    // Playback that only touched the tail of the series: update the last
    // points instead of rebuilding every one of them (see `isTailUpdate`).
    const incremental =
      isReplayActive &&
      dataChanged &&
      settingsUnchanged &&
      pendingIntentRef.current === null &&
      previousCandles !== null &&
      isTailUpdate(previousCandles, displayCandles);

    prevTFRef.current = activeTF;
    prevSymbolRef.current = currentSymbol;
    prevReplayActiveRef.current = isReplayActive;
    prevReplayIndexRef.current = currentIndex;
    prevBarCountRef.current = displayCandles.length;
    prevDisplayCandlesRef.current = displayCandles;

    // Nothing to paint. The effect also runs when only `currentIndex` moved —
    // each replay tick changes it *and* the candles, so it ran twice per tick,
    // and this second, empty pass rebuilt the whole series with `setData`.
    if (!dataChanged && settingsUnchanged) return;

    if (incremental && previousCandles) {
      const first = Math.max(0, previousCandles.length - 1);
      for (let i = first; i < displayCandles.length; i++) {
        const c = displayCandles[i];
        const time = asChartTime(c.time);
        if (chartType === 'Line' || chartType === 'Area') mainSeries.update({ time, value: c.close });
        else mainSeries.update({ time, open: c.open, high: c.high, low: c.low, close: c.close });
        if (volumeSeries && volumeVisible) {
          volumeSeries.update({
            time,
            value: c.volume,
            color: c.close >= c.open ? 'rgba(16, 185, 129, 0.40)' : 'rgba(244, 63, 94, 0.40)',
          });
        }
      }
      // Indicators on a bounded tail: exact for windowed ones (SMA), and for the
      // recursive ones (EMA, RSI, MACD) the influence of what lies before the
      // tail is below 1e-12 at periods up to 200.
      const tail = displayCandles.slice(-INDICATOR_TAIL);
      const fromTime = displayCandles[first].time;
      activeIndicators.forEach((ind) => {
        const series = indicatorSeriesMapRef.current.get(ind.id);
        if (!series) return;
        const points = computeIndicator(ind.type, tail, ind.period || DEFAULT_PERIODS[ind.type]);
        for (const point of points) {
          if (point.time >= fromTime) series.update({ time: asChartTime(point.time), value: point.value });
        }
      });
      if (chart) viewport.apply(snapshot, displayCandles, { followTail: true });
      return;
    }

    // Apply data
    if (chartType === 'Line' || chartType === 'Area') {
      mainSeries.setData(
        displayCandles.map((c) => ({ time: asChartTime(c.time), value: c.close }))
      );
    } else {
      mainSeries.setData(
        displayCandles.map((c) => ({
          time: asChartTime(c.time),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }))
      );
    }

    if (volumeSeries) {
      volumeSeries.applyOptions({
        visible: volumeVisible,
        lastValueVisible: false,
        priceLineVisible: false,
      });

      // Toujours écrire les données, quitte à les vider.
      //
      // `visible: false` masque le tracé mais la série garde ses points, et
      // leurs horodatages appartiennent toujours à l'échelle de temps du
      // graphique. En passant d'un instrument avec volume à un instrument sans,
      // l'ancienne série étirait l'axe sur deux plages disjointes : des années
      // à gauche, des jours à droite, et des barres fantômes par-dessus.
      volumeSeries.setData(
        volumeVisible
          ? displayCandles.map((c) => ({
              time: asChartTime(c.time),
              value: c.volume,
              color: c.close >= c.open ? 'rgba(16, 185, 129, 0.40)' : 'rgba(244, 63, 94, 0.40)',
            }))
          : []
      );
    }

    // Render Indicators
    if (chart) {
      // 1. Remove deleted indicator series
      indicatorSeriesMapRef.current.forEach((s, id) => {
        if (!activeIndicators.some((i) => i.id === id)) {
          try {
            chart.removeSeries(s);
          } catch {}
          indicatorSeriesMapRef.current.delete(id);
        }
      });

      // 2. Add or update indicators
      activeIndicators.forEach((ind) => {
        try {
          let s = indicatorSeriesMapRef.current.get(ind.id);
          const isRSI = ind.type === 'RSI';
          const isMACD = ind.type === 'MACD';
          const scaleId = isRSI ? 'rsi_pane' : isMACD ? 'macd_pane' : 'right';

          if (!s) {
            s = chart.addLineSeries({
              color: ind.color || (isRSI ? '#A78BFA' : isMACD ? '#3B82F6' : '#10B981'),
              lineWidth: 2,
              priceScaleId: scaleId,
            });
            indicatorSeriesMapRef.current.set(ind.id, s);
          }

          if (!displayCandles || displayCandles.length === 0) return;

          const period = ind.period || DEFAULT_PERIODS[ind.type];
          const indData = computeIndicator(ind.type, displayCandles, period);

          s.setData(indData.map((point) => ({ time: asChartTime(point.time), value: point.value })));
        } catch (err) {
          console.warn(`Error updating indicator ${ind.type}:`, err);
        }
      });

      // 3. Adjust scale margins — *after* the series exist.
      //
      // A price scale only comes into being when a series references it. Calling
      // `chart.priceScale('rsi_pane')` before that either threw (swallowed by the
      // catch) or configured a scale the new series then replaced with defaults,
      // so the RSI autoscaled across the whole pane and drew over the candles on
      // the price axis instead of sitting in its own band.
      applyResponsiveScaleMargins(chart, volumeVisible, activeIndicators);

      // ── Viewport ──
      // Only act when the series actually changed. Re-running for a chart-type
      // or indicator toggle must not move the user's view.
      if (dataChanged) {
        const intent = pendingIntentRef.current;
        pendingIntentRef.current = null;

        if (intent === 'refit') {
          // New instrument, first paint, or a jump to a new point in history:
          // rebuild a readable window around the end of the series.
          viewport.apply(snapshot, displayCandles, { refit: true });
        } else if (intent === 'keep-time') {
          // Same market, different granularity: hold the wall-clock window so
          // the user stays on the price action they were reading.
          viewport.apply(snapshot, displayCandles, { keepTimeWindow: true });
        } else if (isReplayActive) {
          // Playback: advance with the last candle, but only while the user is
          // watching the edge. Panning back into history now stays put.
          // The replay window may have slid forward: keep a panned-away view on
          // the same bars.
          viewport.apply(snapshot, displayCandles, {
            followTail: true,
            droppedBars: droppedLeadingBars(previousCandles, displayCandles),
          });
        } else {
          viewport.apply(snapshot, displayCandles);
        }
      }
    }
  }, [mainSeries, volumeSeries, displayCandles, chartType, volumeVisible, chart, activeIndicators, activeTF, currentSymbol, isReplayActive, currentIndex, viewport, indicatorSeriesMapRef]);
}
