import React, { useEffect, useRef, useState } from 'react';
import { createChart, IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts';
import { Scissors, History, TrendingUp, UploadCloud, Play } from 'lucide-react';
import { useMarketStore } from '../../store/useMarketStore';
import { useReplayStore } from '../../store/useReplayStore';
import { useUIStore } from '../../store/useUIStore';
import { DrawingCanvas } from './DrawingCanvas';
import { fetchHistoricalSeries, PROVENANCE_LABELS } from '../../services/historicalApi';
import { Candle, ActiveIndicator } from '../../types/market';
import { computeIndicator, DEFAULT_PERIODS } from '../../domain/indicators';
import { indexAtOrAfter } from '../../domain/candles';
import { formatPrice } from '../../domain/instruments';
import { useChartViewport } from './useChartViewport';

/**
 * Narrow an epoch-seconds number to lightweight-charts' branded `Time`.
 *
 * One documented conversion point instead of the `time: c.time as any` casts
 * that were scattered through the data and drawing layers.
 */
const asChartTime = (epochSeconds: number): UTCTimestamp => epochSeconds as UTCTimestamp;

function applyResponsiveScaleMargins(
  chart: IChartApi | null,
  showVolume: boolean,
  activeIndicators: readonly ActiveIndicator[]
) {
  if (!chart) return;
  const hasSubPanes = activeIndicators.some((i) => i.type === 'RSI' || i.type === 'MACD');

  let priceMargins: { top: number; bottom: number };
  let volumeMargins: { top: number; bottom: number };
  let subPaneMargins: { top: number; bottom: number };

  if (!showVolume && !hasSubPanes) {
    // 1. Full clean screen: No volume, no indicator (100% chart height for candles)
    priceMargins = { top: 0.04, bottom: 0.04 };
    volumeMargins = { top: 1.0, bottom: 0.0 };
    subPaneMargins = { top: 1.0, bottom: 0.0 };
  } else if (showVolume && !hasSubPanes) {
    // 2. Volume only: Price takes top 80% (bottom: 0.20), Volume takes 82%-99% (top: 0.82)
    // Guaranteed 2% buffer: Candlesticks can NEVER touch or encounter volume bars!
    priceMargins = { top: 0.04, bottom: 0.20 };
    volumeMargins = { top: 0.82, bottom: 0.01 };
    subPaneMargins = { top: 1.0, bottom: 0.0 };
  } else if (!showVolume && hasSubPanes) {
    // 3. Indicator only: Price takes top 75%, Sub-pane takes bottom 23%
    priceMargins = { top: 0.04, bottom: 0.25 };
    volumeMargins = { top: 1.0, bottom: 0.0 };
    subPaneMargins = { top: 0.77, bottom: 0.02 };
  } else {
    // 4. Both Volume and Indicator:
    // Candlesticks: strictly stop at 64% from top (bottom: 0.36)
    // Guaranteed 2% buffer between 64% and 66%
    // Volume: strictly confined to 66% - 77% (top: 0.66, bottom: 0.23)
    // Guaranteed 1.5% separator between 77% and 78.5%
    // Indicator: strictly confined to 78.5% - 98% (top: 0.785, bottom: 0.02)
    // MATHEMATICALLY IMPOSSIBLE FOR PRICE TO TOUCH OR MEET VOLUME!
    priceMargins = { top: 0.04, bottom: 0.36 };
    volumeMargins = { top: 0.66, bottom: 0.23 };
    subPaneMargins = { top: 0.785, bottom: 0.02 };
  }

  try {
    chart.priceScale('right').applyOptions({ scaleMargins: priceMargins });
    chart.priceScale('volume').applyOptions({ scaleMargins: volumeMargins });
    if (hasSubPanes) {
      activeIndicators.forEach((ind) => {
        if (ind.type === 'RSI') {
          chart.priceScale('rsi_pane').applyOptions({ scaleMargins: subPaneMargins, autoScale: true });
        } else if (ind.type === 'MACD') {
          chart.priceScale('macd_pane').applyOptions({ scaleMargins: subPaneMargins, autoScale: true });
        }
      });
    }
  } catch (err) {
    console.warn('scaleMargins error:', err);
  }
}

export const TradingChart: React.FC = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartWrapperRef = useRef<HTMLDivElement | null>(null);
  const [chart, setChart] = useState<IChartApi | null>(null);
  const [mainSeries, setMainSeries] = useState<ISeriesApi<'Candlestick' | 'Bar' | 'Line' | 'Area'> | null>(null);
  const [volumeSeries, setVolumeSeries] = useState<ISeriesApi<'Histogram'> | null>(null);
  const indicatorSeriesMapRef = useRef<Map<string, ISeriesApi<'Line'>>>(new Map());
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [isLoading, setIsLoading] = useState(false);
  const [hoverCandleInfo, setHoverCandleInfo] = useState<{ x: number; time: number; candle: Candle } | null>(null);

  const prevTFRef = useRef<number | null>(null);
  const prevSymbolRef = useRef<string | null>(null);
  const prevReplayActiveRef = useRef<boolean>(false);
  const prevReplayIndexRef = useRef<number | null>(null);
  const prevBarCountRef = useRef(0);
  const prevDisplayCandlesRef = useRef<Candle[] | null>(null);
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

  const {
    displayCandles,
    baseCandles,
    activeTF,
    chartType,
    showVolume,
    showGrid,
    activeIndicators,
    currentFitContentTrigger,
    currentSymbol,
    dataSourceLabel,
    isSimulatedData,
    hasVolumeData,
    setBaseCandles,
    setSymbol,
    setDataSource,
  } = useMarketStore();

  const viewport = useChartViewport(chart);

  /**
   * Le volume ne s'affiche que si la série en porte réellement.
   *
   * Sans cette condition, une source qui n'en publie pas (BCE, synthétiques
   * Deriv) laissait un histogramme entièrement nul occuper 17 % de la hauteur :
   * une bande écrasée au bas du graphique, qui se lisait comme un bug.
   */
  const volumeVisible = showVolume && hasVolumeData;

  const { isPicking, isActive: isReplayActive, currentIndex, setStartIndex, setCurrentIndex, setIsActive, setIsPicking } = useReplayStore();
  const { openModal, showToast, activeModal, setSnapshotDataUrl } = useUIStore();

  // ── INIT CHART ────────────────────────────────────────────
  useEffect(() => {
    if (!chartWrapperRef.current) return;

    const newChart = createChart(chartWrapperRef.current, {
      layout: {
        background: { color: '#0B0E14' },
        textColor: '#8492A6',
        fontSize: 11,
        fontFamily: "'JetBrains Mono', 'Inter', system-ui, sans-serif",
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.035)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.035)' },
      },
      crosshair: {
        mode: 1,
        vertLine: { color: 'rgba(59, 130, 246, 0.4)', width: 1, style: 3 },
        horzLine: { color: 'rgba(59, 130, 246, 0.4)', width: 1, style: 3 },
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12,
        barSpacing: 8,
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
        scaleMargins: { top: 0.06, bottom: 0.26 },
        autoScale: true,
      },
    });

    const vSeries = newChart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      lastValueVisible: false,
      priceLineVisible: false,
    });
    const { showVolume: initialShowVol, activeIndicators: initialInds } = useMarketStore.getState();
    applyResponsiveScaleMargins(newChart, initialShowVol, initialInds);

    setChart(newChart);
    setVolumeSeries(vSeries);

    const handleResize = () => {
      if (chartWrapperRef.current) {
        const w = chartWrapperRef.current.clientWidth;
        const h = chartWrapperRef.current.clientHeight;
        newChart.applyOptions({ width: w, height: h });
        setSize({ width: w, height: h });
      }
    };

    const ro = new ResizeObserver(handleResize);
    ro.observe(chartWrapperRef.current);
    handleResize();

    return () => {
      ro.disconnect();
      newChart.remove();
    };
  }, []);

  // ── UPDATE GRID & VOLUME OPTIONS DYNAMICALLY ──────────────
  useEffect(() => {
    if (!chart) return;
    chart.applyOptions({
      grid: {
        vertLines: { color: showGrid ? 'rgba(255, 255, 255, 0.035)' : 'transparent' },
        horzLines: { color: showGrid ? 'rgba(255, 255, 255, 0.035)' : 'transparent' },
      },
    });
    if (volumeSeries) {
      volumeSeries.applyOptions({ visible: volumeVisible });
    }
    applyResponsiveScaleMargins(chart, volumeVisible, activeIndicators);
  }, [chart, showGrid, volumeVisible, volumeSeries, activeIndicators]);

  // ── UPDATE MAIN SERIES TYPE ───────────────────────────────
  useEffect(() => {
    if (!chart) return;

    let newMain: ISeriesApi<'Candlestick' | 'Bar' | 'Line' | 'Area'>;
    if (chartType === 'Candlestick') {
      newMain = chart.addCandlestickSeries({
        upColor: '#00C46E',
        downColor: '#F43F5E',
        borderUpColor: '#00C46E',
        borderDownColor: '#F43F5E',
        wickUpColor: '#00C46E',
        wickDownColor: '#F43F5E',
      });
    } else if (chartType === 'Bar') {
      newMain = chart.addBarSeries({
        upColor: '#00C46E',
        downColor: '#F43F5E',
      });
    } else if (chartType === 'Line') {
      newMain = chart.addLineSeries({
        color: '#2962FF',
        lineWidth: 2,
      });
    } else {
      newMain = chart.addAreaSeries({
        topColor: 'rgba(41, 98, 255, 0.4)',
        bottomColor: 'rgba(41, 98, 255, 0.0)',
        lineColor: '#2962FF',
        lineWidth: 2,
      });
    }

    // Deferring the state write by one frame lets the chart finish wiring the
    // series. The handle must be cancelled on cleanup: switching chart type
    // twice quickly otherwise published a series the cleanup had just removed,
    // and the next `setData` ran against a disposed object.
    const frame = requestAnimationFrame(() => setMainSeries(newMain));

    return () => {
      cancelAnimationFrame(frame);
      setMainSeries((current) => (current === newMain ? null : current));
      try {
        chart.removeSeries(newMain);
      } catch {
        // The chart may already be disposed; nothing to clean up.
      }
    };
  }, [chart, chartType]);

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

    prevTFRef.current = activeTF;
    prevSymbolRef.current = currentSymbol;
    prevReplayActiveRef.current = isReplayActive;
    prevReplayIndexRef.current = currentIndex;
    prevBarCountRef.current = displayCandles.length;
    prevDisplayCandlesRef.current = displayCandles;

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
          viewport.apply(snapshot, displayCandles, { followTail: true });
        } else {
          viewport.apply(snapshot, displayCandles);
        }
      }
    }
  }, [mainSeries, volumeSeries, displayCandles, chartType, volumeVisible, chart, activeIndicators, activeTF, currentSymbol, isReplayActive, currentIndex, viewport]);

  // ── FIT CONTENT TRIGGER ───────────────────────────────────
  useEffect(() => {
    if (currentFitContentTrigger > 0 && chart) {
      viewport.fit();
    }
  }, [currentFitContentTrigger, chart, viewport]);

  // ── SNAPSHOT CAPTURE ──────────────────────────────────────
  useEffect(() => {
    if (activeModal === 'snapshot' && chart) {
      try {
        const chartCanvas = chart.takeScreenshot();
        const drawCanvas = document.getElementById('draw-canvas') as HTMLCanvasElement | null;

        const outCanvas = document.createElement('canvas');
        outCanvas.width = chartCanvas.width;
        outCanvas.height = chartCanvas.height;
        const ctx = outCanvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(chartCanvas, 0, 0);
          if (drawCanvas) {
            ctx.drawImage(drawCanvas, 0, 0, outCanvas.width, outCanvas.height);
          }
          const dpr = window.devicePixelRatio || 1;
          ctx.fillStyle = 'rgba(11, 14, 20, 0.85)';
          ctx.fillRect(16 * dpr, (outCanvas.height / dpr - 40) * dpr, 340 * dpr, 28 * dpr);
          ctx.fillStyle = '#00C46E';
          ctx.font = `bold ${12 * dpr}px Inter, sans-serif`;
          ctx.fillText(`TradeView Pro`, 24 * dpr, (outCanvas.height / dpr - 22) * dpr);
          ctx.fillStyle = '#FFFFFF';
          ctx.font = `${11 * dpr}px JetBrains Mono, monospace`;
          ctx.fillText(` • ${currentSymbol} • ${new Date().toLocaleDateString('fr-FR')}`, 115 * dpr, (outCanvas.height / dpr - 22) * dpr);

          setSnapshotDataUrl(outCanvas.toDataURL('image/png'));
        }
      } catch (e) {
        console.warn('Snapshot capture failed:', e);
      }
    }
  }, [activeModal, chart, currentSymbol, setSnapshotDataUrl]);

  // ── REPLAY PICK & CUT BAR HANDLER ─────────────────────────
  const handleChartMouseMove = (e: React.MouseEvent) => {
    if (!isPicking || !chart || !baseCandles.length) {
      if (hoverCandleInfo) setHoverCandleInfo(null);
      return;
    }
    const rect = chartWrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const time = chart.timeScale().coordinateToTime(mx) as number | null;
    if (time) {
      const found = indexAtOrAfter(baseCandles, time);
      const idx = found === -1 ? baseCandles.length - 1 : found;
      const candle = baseCandles[idx];
      const snappedX = chart.timeScale().timeToCoordinate(asChartTime(candle.time)) ?? mx;
      setHoverCandleInfo({ x: snappedX, time: candle.time, candle });
    }
  };

  const handleChartMouseLeave = () => {
    if (isPicking) {
      setHoverCandleInfo(null);
    }
  };

  const handleChartClick = (e: React.MouseEvent) => {
    if (!isPicking || !chart || !baseCandles.length) return;
    const rect = chartWrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const time = chart.timeScale().coordinateToTime(mx) as number | null;

    if (time) {
      const found = indexAtOrAfter(baseCandles, time);
      // Clamp: `length - 20` went negative on a series shorter than 20 candles,
      // and the negative index propagated into the replay cursor.
      const chosenIdx = found !== -1
        ? found
        : Math.max(0, baseCandles.length - 20);

      setStartIndex(chosenIdx, baseCandles.length);
      setCurrentIndex(chosenIdx, baseCandles.length);
      setIsPicking(false);
      setHoverCandleInfo(null);
      setIsActive(true);
      showToast(`Replay démarré au ${new Date(baseCandles[chosenIdx].time * 1000).toLocaleDateString('fr-FR')}`, 'success');
    }
  };

  const loadDemo = async () => {
    setIsLoading(true);
    try {
      const series = await fetchHistoricalSeries({ symbol: 'EURUSD', interval: '1d', range: 'max' });
      if (!series.candles.length) {
        showToast('Aucune donnée disponible pour la démo.', 'error', 4000);
        return;
      }
      setSymbol('EURUSD');
      setBaseCandles(series.candles);
      setDataSource(`Données réelles · ${PROVENANCE_LABELS[series.provenance]}`, series.isSimulated);

      const count = series.candles.length.toLocaleString('fr-FR');
      showToast(
        series.isSimulated
          ? `Données simulées : aucune source n’a répondu. Résultats non exploitables.`
          : `EUR/USD chargé · ${count} bougies · ${PROVENANCE_LABELS[series.provenance]}`,
        series.isSimulated ? 'warning' : 'success',
        series.isSimulated ? 7000 : 3000
      );
    } catch (error) {
      console.warn('[TradingChart] demo load failed:', error);
      showToast('Échec du chargement de la démo.', 'error', 4000);
    } finally {
      // `finally` matters: the previous version left the spinner spinning
      // forever whenever the fetch threw.
      setIsLoading(false);
    }
  };

  const firstCandle = displayCandles[0];
  const lastCandle = displayCandles[displayCandles.length - 1];

  const dateRangeStr =
    firstCandle && lastCandle
      ? `${new Date(firstCandle.time * 1000).toLocaleDateString('fr-FR')} → ${new Date(
          lastCandle.time * 1000
        ).toLocaleDateString('fr-FR')}`
      : '';

  // `Connecté` was shown as soon as candles were in memory, even offline — it
  // described a connection that did not exist. State the truth instead.
  const statusLabel = !displayCandles.length
    ? 'Aucune donnée'
    : isSimulatedData
      ? 'Données simulées'
      : (dataSourceLabel ?? 'Données chargées');

  const provenanceTitle = isSimulatedData
    ? 'Série générée localement : aucune source de marché n’a répondu. Résultats non exploitables.'
    : dataSourceLabel
      ? `Origine des bougies : ${dataSourceLabel}`
      : 'Origine des données inconnue';

  return (
    <div id="chart-area" ref={containerRef}>
      <div
        id="chart-container"
        onClick={handleChartClick}
        onMouseMove={handleChartMouseMove}
        onMouseLeave={handleChartMouseLeave}
        style={{ cursor: isPicking ? 'crosshair' : undefined, position: 'relative' }}
      >
        {/* Chart Canvas */}
        {/* Pas de style inline ici : `height: 100%` en ligne bat tout sélecteur,
            et neutralisait `body.replay-active #tv-chart`. Le graphe ne se
            rétrécissait donc jamais en replay et les dernières bougies
            passaient sous la barre de prise de position. La taille appartient
            à la feuille de style. */}
        <div id="tv-chart" ref={chartWrapperRef}>
          <DrawingCanvas
            chart={chart}
            mainSeries={mainSeries}
            width={size.width}
            height={size.height}
          />
        </div>

        {/* ── REPLAY VISUAL CUT LINE INDICATOR ── */}
        {isPicking && hoverCandleInfo && (
          <div
            className="replay-cut-container u-position-absolute u-top-0 u-bottom-0 u-left-0 u-right-0 u-pointer-events-none u-z-index-40 u-overflow-hidden"
          >
            {/* Future area shadow on right */}
            <div
              className="replay-future-shade"
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${hoverCandleInfo.x}px`,
                right: 0,
                background: 'rgba(10, 15, 30, 0.45)',
                backdropFilter: 'blur(0.5px)',
                borderLeft: '2px dashed #38BDF8',
              }}
            />

            {/* Glowing Vertical Cut Line */}
            <div
              className="replay-cut-bar"
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${hoverCandleInfo.x - 1}px`,
                width: '2px',
                background: '#38BDF8',
                boxShadow: '0 0 10px rgba(56, 189, 248, 0.8), 0 0 20px rgba(56, 189, 248, 0.4)',
              }}
            />

            {/* Floating Top Badge with Date & Time */}
            <div
              className="replay-cut-badge"
              style={{
                position: 'absolute',
                top: '16px',
                left: `${hoverCandleInfo.x}px`,
                transform: 'translateX(-50%)',
                background: 'rgba(15, 23, 42, 0.95)',
                border: '1px solid rgba(56, 189, 248, 0.6)',
                boxShadow: '0 4px 16px rgba(0,0,0,0.6), 0 0 12px rgba(56, 189, 248, 0.25)',
                borderRadius: '6px',
                padding: '5px 12px',
                color: '#F8FAFC',
                fontSize: '11px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '7px',
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
              }}
            >
              <span className="u-color-38bdf8 u-display-inline-flex u-align-items-center u-gap-5px">
                <Scissors size={12} strokeWidth={2.4} />
                Démarrer ici :
              </span>
              <span className="u-font-family-mono u-color-38bdf8">
                {new Date(hoverCandleInfo.candle.time * 1000).toLocaleString('fr-FR', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
              <span className="u-color-94a3b8 u-font-size-10px">
                {/* Precision from the catalogue, not from the price's magnitude. */}
                ({formatPrice(currentSymbol, hoverCandleInfo.candle.close)})
              </span>
            </div>
          </div>
        )}

        {/* Replay Start Hint (Floating Top Glass Banner) */}
        {isPicking && !hoverCandleInfo && (
          <div id="replay-hint">
            <div className="rh-icon-wrap u-display-flex u-align-items-center u-justify-content-center">
              <History size={17} strokeWidth={2.2} />
            </div>
            <div className="rh-content">
              <div className="rh-text">Où commencer ?</div>
              <div className="rh-sub">Cliquez sur la bougie où démarrer.</div>
            </div>
            <div className="rh-badge">Échap pour annuler</div>
          </div>
        )}

        {/* Loading Spinner */}
        {isLoading && (
          <div id="loading" className="u-display-flex">
            <div className="spinner" />
          </div>
        )}

        {/* Welcome Overlay if empty */}
        {displayCandles.length === 0 && !isLoading && (
          <div id="welcome-overlay">
            <div className="welcome-content">
              <div className="welcome-icon u-display-flex u-align-items-center u-justify-content-center">
                <TrendingUp size={28} strokeWidth={2.5} className="u-color-38bdf8" />
              </div>
              <div className="welcome-title">Rejouez le marché, <span>bougie par bougie</span></div>
              <div className="welcome-sub">
                Choisissez un instrument ou importez vos données pour commencer.
              </div>
              <div
                id="drop-zone"
                role="button"
                tabIndex={0}
                onClick={() => openModal('import')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openModal('import');
                  }
                }}
              >
                <div className="drop-icon u-display-flex u-align-items-center u-justify-content-center">
                  <UploadCloud size={30} strokeWidth={1.8} className="u-color-38bdf8" />
                </div>
                <div className="drop-text">Déposez un CSV ou un JSON, ou parcourez</div>
                <div className="drop-hint">Colonnes attendues : date, open, high, low, close, volume</div>
                <div className="drop-formats">
                  <span className="fmt-badge">CSV</span>
                  <span className="fmt-badge">JSON</span>
                </div>
              </div>
              <button id="load-sample" onClick={loadDemo}>
                Essayer avec EUR/USD
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Statusbar — provenance first: "are these candles real?" is a standing
          question during a backtest, not a three-second toast. */}
      <div id="statusbar">
        <div className="status-item" title={provenanceTitle}>
          <div
            className={`status-dot ${isSimulatedData ? 'simulated' : 'online'}`}
            id="status-dot"
          />
          <span id="status-text">{statusLabel}</span>
        </div>
        {displayCandles.length > 0 && (
          <>
            <div className="status-item" id="status-rows">
              <span><strong id="rows-count">{displayCandles.length.toLocaleString('fr-FR')}</strong> bougies</span>
            </div>
            <div className="status-item" id="status-range">
              <span id="range-text">{dateRangeStr}</span>
            </div>
          </>
        )}
        {isReplayActive && (
          <div className="status-item u-display-flex u-align-items-center u-gap-6px" id="status-replay">
            <span className="status-replay-icon u-display-inline-flex u-align-items-center">
              <Play size={11} strokeWidth={2.4} fill="currentColor" />
            </span>
            <span id="replay-status-text">Replay en cours</span>
          </div>
        )}
      </div>
    </div>
  );
};
