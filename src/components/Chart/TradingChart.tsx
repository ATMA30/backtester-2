import React, { useEffect, useRef, useState } from 'react';
import { createChart, IChartApi, ISeriesApi } from 'lightweight-charts';
import { useMarketStore } from '../../store/useMarketStore';
import { useReplayStore } from '../../store/useReplayStore';
import { useUIStore } from '../../store/useUIStore';
import { DrawingCanvas } from './DrawingCanvas';
import { fetchHistoricalData } from '../../services/historicalApi';

export const TradingChart: React.FC = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartWrapperRef = useRef<HTMLDivElement | null>(null);
  const [chart, setChart] = useState<IChartApi | null>(null);
  const [mainSeries, setMainSeries] = useState<ISeriesApi<'Candlestick' | 'Bar' | 'Line' | 'Area'> | null>(null);
  const [volumeSeries, setVolumeSeries] = useState<ISeriesApi<'Histogram'> | null>(null);
  const [indicatorSeriesMap, setIndicatorSeriesMap] = useState<Map<string, ISeriesApi<'Line'>>>(new Map());
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [isLoading, setIsLoading] = useState(false);

  const {
    displayCandles,
    baseCandles,
    chartType,
    showVolume,
    showGrid,
    activeIndicators,
    currentFitContentTrigger,
    setBaseCandles,
    setSymbol,
  } = useMarketStore();

  const { isPicking, isActive: isReplayActive, setStartIndex, setCurrentIndex, setIsActive, setIsPicking } = useReplayStore();
  const { openModal, showToast } = useUIStore();

  // ── INIT CHART ────────────────────────────────────────────
  useEffect(() => {
    if (!chartWrapperRef.current) return;

    const newChart = createChart(chartWrapperRef.current, {
      layout: {
        background: { color: '#060810' },
        textColor: '#6B7A99',
        fontSize: 11,
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      },
      grid: {
        vertLines: { color: showGrid ? 'rgba(255, 255, 255, 0.035)' : 'transparent' },
        horzLines: { color: showGrid ? 'rgba(255, 255, 255, 0.035)' : 'transparent' },
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
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
        scaleMargins: { top: 0.06, bottom: 0.14 },
      },
    });

    const vSeries = newChart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      visible: showVolume,
    });
    newChart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.88, bottom: 0 },
    });

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

  // ── UPDATE MAIN SERIES TYPE ───────────────────────────────
  useEffect(() => {
    if (!chart) return;
    if (mainSeries) chart.removeSeries(mainSeries);

    let newMain: ISeriesApi<'Candlestick' | 'Bar' | 'Line' | 'Area'>;
    if (chartType === 'Candlestick') {
      newMain = chart.addCandlestickSeries({
        upColor: '#00D26A',
        downColor: '#FF3B5C',
        borderUpColor: '#00D26A',
        borderDownColor: '#FF3B5C',
        wickUpColor: '#00D26A',
        wickDownColor: '#FF3B5C',
      });
    } else if (chartType === 'Bar') {
      newMain = chart.addBarSeries({
        upColor: '#00D26A',
        downColor: '#FF3B5C',
      });
    } else if (chartType === 'Line') {
      newMain = chart.addLineSeries({
        color: '#3B82F6',
        lineWidth: 2,
      });
    } else {
      newMain = chart.addAreaSeries({
        topColor: 'rgba(59, 130, 246, 0.35)',
        bottomColor: 'rgba(59, 130, 246, 0.0)',
        lineColor: '#3B82F6',
        lineWidth: 2,
      });
    }

    setMainSeries(newMain);
  }, [chart, chartType]);

  // ── SET DATA ──────────────────────────────────────────────
  useEffect(() => {
    if (!mainSeries || !displayCandles.length) return;

    if (chartType === 'Line' || chartType === 'Area') {
      mainSeries.setData(
        displayCandles.map((c) => ({ time: c.time as any, value: c.close }))
      );
    } else {
      mainSeries.setData(
        displayCandles.map((c) => ({
          time: c.time as any,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }))
      );
    }

    if (volumeSeries) {
      volumeSeries.applyOptions({ visible: showVolume });
      if (showVolume) {
        volumeSeries.setData(
          displayCandles.map((c) => ({
            time: c.time as any,
            value: c.volume,
            color: c.close >= c.open ? 'rgba(0,210,106,0.30)' : 'rgba(255,59,92,0.30)',
          }))
        );
      }
    }

    // Render Indicators
    if (chart) {
      // Remove stale indicators
      indicatorSeriesMap.forEach((s, id) => {
        if (!activeIndicators.some((i) => i.id === id)) {
          chart.removeSeries(s);
          indicatorSeriesMap.delete(id);
        }
      });

      // Add / Update indicators
      activeIndicators.forEach((ind) => {
        let s = indicatorSeriesMap.get(ind.id);
        if (!s) {
          s = chart.addLineSeries({ color: ind.color, lineWidth: 2 });
          indicatorSeriesMap.set(ind.id, s);
        }
        // Calculate SMA / EMA
        const p = ind.period || 20;
        const indData: any[] = [];
        for (let i = p - 1; i < displayCandles.length; i++) {
          let sum = 0;
          for (let k = i - p + 1; k <= i; k++) sum += displayCandles[k].close;
          indData.push({ time: displayCandles[i].time, value: sum / p });
        }
        s.setData(indData);
      });
      setIndicatorSeriesMap(new Map(indicatorSeriesMap));
    }
  }, [mainSeries, volumeSeries, displayCandles, chartType, showVolume, chart, activeIndicators]);

  // ── FIT CONTENT TRIGGER ───────────────────────────────────
  useEffect(() => {
    if (currentFitContentTrigger > 0 && chart) {
      chart.timeScale().fitContent();
    }
  }, [currentFitContentTrigger, chart]);

  // ── REPLAY PICK HANDLER ───────────────────────────────────
  const handleChartClick = (e: React.MouseEvent) => {
    if (!isPicking || !chart || !baseCandles.length) return;
    const rect = chartWrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const time = chart.timeScale().coordinateToTime(mx) as number | null;

    if (time) {
      const idx = baseCandles.findIndex((c) => c.time >= time);
      const chosenIdx = idx !== -1 ? idx : baseCandles.length - 20;
      setStartIndex(chosenIdx);
      setCurrentIndex(chosenIdx);
      setIsPicking(false);
      setIsActive(true);
      showToast('Mode Replay démarré !', 'success');
    }
  };

  const loadDemo = async () => {
    setIsLoading(true);
    const candles = await fetchHistoricalData('EURUSD', '1d', 'max');
    setIsLoading(false);
    if (candles && candles.length) {
      setSymbol('EURUSD');
      setBaseCandles(candles);
      showToast(`🟢 Démo EUR/USD — ${candles.length.toLocaleString()} bougies chargées`, 'success');
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

  return (
    <div id="chart-area" ref={containerRef}>
      <div id="chart-container" onClick={handleChartClick}>
        {/* Chart Canvas */}
        <div id="tv-chart" ref={chartWrapperRef} style={{ width: '100%', height: '100%' }}>
          <DrawingCanvas
            chart={chart}
            mainSeries={mainSeries}
            width={size.width}
            height={size.height}
          />
        </div>

        {/* Replay Start Hint */}
        {isPicking && (
          <div id="replay-hint" style={{ display: 'flex' }}>
            <div className="rh-icon">⏱</div>
            <div className="rh-text">Choisissez le point de départ</div>
            <div className="rh-sub">Cliquez sur une bougie pour lancer le replay</div>
          </div>
        )}

        {/* Loading Spinner */}
        {isLoading && (
          <div id="loading" style={{ display: 'flex' }}>
            <div className="spinner" />
          </div>
        )}

        {/* Welcome Overlay if empty */}
        {displayCandles.length === 0 && !isLoading && (
          <div id="welcome-overlay">
            <div className="welcome-content">
              <div className="welcome-icon">
                <svg className="welcome-logo-svg" viewBox="0 0 40 40" fill="none" stroke="white" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="5 30 13 19 21 24 33 9" />
                  <polyline points="28 9 33 9 33 14" />
                </svg>
              </div>
              <div className="welcome-title">Bienvenue sur <span>TradeView Pro</span></div>
              <div className="welcome-sub">
                Importez vos données de marché ou connectez les flux en direct pour visualiser les chandeliers, rejouer des sessions et simuler des trades.
              </div>
              <div id="drop-zone" onClick={() => openModal('import')}>
                <div className="drop-icon">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                </div>
                <div className="drop-text">Glissez un fichier ou cliquez pour parcourir</div>
                <div className="drop-hint">Colonnes recommandées : date, open, high, low, close, volume</div>
                <div className="drop-formats">
                  <span className="fmt-badge">CSV</span>
                  <span className="fmt-badge">JSON</span>
                </div>
              </div>
              <button id="load-sample" onClick={loadDemo}>
                Charger les données de démonstration (27 Ans BCE)
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Statusbar */}
      <div id="statusbar">
        <div className="status-item">
          <div className="status-dot online" id="status-dot" />
          <span id="status-text">{displayCandles.length > 0 ? 'Connecté' : 'Prêt'}</span>
        </div>
        {displayCandles.length > 0 && (
          <>
            <div className="status-item" id="status-rows">
              <span>Bougies : <strong id="rows-count">{displayCandles.length.toLocaleString()}</strong></span>
            </div>
            <div className="status-item" id="status-range">
              <span id="range-text">{dateRangeStr}</span>
            </div>
          </>
        )}
        {isReplayActive && (
          <div className="status-item" id="status-replay">
            <span className="status-replay-icon">⏯</span>
            <span id="replay-status-text">Mode Replay</span>
          </div>
        )}
      </div>
    </div>
  );
};
