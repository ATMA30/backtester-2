import React, { useEffect, useRef, useState } from 'react';
import { createChart, IChartApi, ISeriesApi } from 'lightweight-charts';
import { History, FastForward } from 'lucide-react';
import { useMarketStore } from '../../store/useMarketStore';
import { useReplayStore } from '../../store/useReplayStore';
import { DrawingCanvas } from './DrawingCanvas';
import { useTradeCaptures } from './useTradeCaptures';
import { useChartViewport } from './useChartViewport';
import { applyResponsiveScaleMargins } from './chartSetup';
import { useChartData } from './useChartData';
import { useChartSnapshot } from './useChartSnapshot';
import { useReplayPicking } from './useReplayPicking';
import { ReplayCutLine } from './ReplayCutLine';
import { WelcomeOverlay } from './WelcomeOverlay';
import { StatusBar } from './StatusBar';

/** The chart, its drawing layer, the replay picking and the status bar. */
export const TradingChart: React.FC = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartWrapperRef = useRef<HTMLDivElement | null>(null);
  const [chart, setChart] = useState<IChartApi | null>(null);
  const [mainSeries, setMainSeries] = useState<ISeriesApi<'Candlestick' | 'Bar' | 'Line' | 'Area'> | null>(null);
  const [volumeSeries, setVolumeSeries] = useState<ISeriesApi<'Histogram'> | null>(null);
  const indicatorSeriesMapRef = useRef<Map<string, ISeriesApi<'Line'>>>(new Map());
  const [size, setSize] = useState({ width: 800, height: 600 });

  const { showVolume, showGrid, activeIndicators, currentFitContentTrigger, chartType, hasVolumeData } = useMarketStore();

  // `controller` has a stable identity (the data effect depends on it);
  // `isFollowing` changes on every gesture and only drives the button below.
  const { controller: viewport, isFollowing, resumeFollow } = useChartViewport(chart);
  useTradeCaptures(chart, mainSeries);

  /**
   * Le volume ne s'affiche que si la série en porte réellement.
   *
   * Sans cette condition, une source qui n'en publie pas (BCE, synthétiques
   * Deriv) laissait un histogramme entièrement nul occuper 17 % de la hauteur :
   * une bande écrasée au bas du graphique, qui se lisait comme un bug.
   */
  const volumeVisible = showVolume && hasVolumeData;

  const { isPicking, isActive: isReplayActive } = useReplayStore();

  // ── INIT CHART ────────────────────────────────────────────
  useEffect(() => {
    if (!chartWrapperRef.current) return;

    const newChart = createChart(chartWrapperRef.current, {
      layout: {
        background: { color: '#000000' },
        textColor: '#9CA3AF',
        fontSize: 11,
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.03)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.03)' },
      },
      crosshair: {
        mode: 1,
        vertLine: { color: 'rgba(37, 99, 235, 0.5)', width: 1, style: 3 },
        horzLine: { color: 'rgba(37, 99, 235, 0.5)', width: 1, style: 3 },
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
    // Dev-only probe: end-to-end tests and viewport diagnostics read the
    // visible range through it. Stripped from production builds.
    if (import.meta.env.DEV) (window as unknown as { __tvChart?: IChartApi }).__tvChart = newChart;
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
        upColor: '#16A34A',
        downColor: '#DC2626',
        borderUpColor: '#16A34A',
        borderDownColor: '#DC2626',
        wickUpColor: '#16A34A',
        wickDownColor: '#DC2626',
      });
    } else if (chartType === 'Bar') {
      newMain = chart.addBarSeries({
        upColor: '#16A34A',
        downColor: '#DC2626',
      });
    } else if (chartType === 'Line') {
      newMain = chart.addLineSeries({
        color: '#2563EB',
        lineWidth: 2,
      });
    } else {
      newMain = chart.addAreaSeries({
        topColor: 'rgba(37, 99, 235, 0.35)',
        bottomColor: 'rgba(37, 99, 235, 0.0)',
        lineColor: '#2563EB',
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

  useChartData({ chart, mainSeries, volumeSeries, indicatorSeriesMapRef, viewport, volumeVisible });

  // ── FIT CONTENT TRIGGER ───────────────────────────────────
  useEffect(() => {
    if (currentFitContentTrigger > 0 && chart) {
      viewport.fit();
    }
  }, [currentFitContentTrigger, chart, viewport]);

  useChartSnapshot(chart);
  const { hoverCandleInfo, handleChartMouseMove, handleChartMouseLeave, handleChartClick } = useReplayPicking(chart, chartWrapperRef);

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
        {isPicking && hoverCandleInfo && <ReplayCutLine hoverCandleInfo={hoverCandleInfo} />}

        {/* Hors du présent pendant un replay : un clic pour reprendre le suivi.
            Sans lui, la seule façon de revenir était de refaire défiler à la
            main jusqu'au bord droit. */}
        {isReplayActive && !isFollowing && (
          <button type="button" className="chart-follow-btn" onClick={resumeFollow} title="Revenir à la dernière bougie et la suivre">
            <FastForward size={13} strokeWidth={2.2} aria-hidden />
            <span>Revenir au présent</span>
          </button>
        )}

        {/* Replay Start Hint (Floating Top Glass Banner) */}
        {isPicking && !hoverCandleInfo && (
          <div id="replay-hint">
            <div className="rh-icon-wrap chart-hint-icon">
              <History size={17} strokeWidth={2.2} />
            </div>
            <div className="rh-content">
              <div className="rh-text">Où commencer ?</div>
              <div className="rh-sub">Cliquez sur la bougie où démarrer.</div>
            </div>
            <div className="rh-badge">Échap pour annuler</div>
          </div>
        )}

        <WelcomeOverlay />
      </div>

      {/* Statusbar — provenance first: "are these candles real?" is a standing
          question during a backtest, not a three-second toast. */}
      <StatusBar />
    </div>
  );
};
