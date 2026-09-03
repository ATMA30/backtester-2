import React, { useEffect, useRef, useState } from 'react';
import { createChart, IChartApi, ISeriesApi } from 'lightweight-charts';
import { Scissors, History, TrendingUp, UploadCloud, Play } from 'lucide-react';
import { useMarketStore } from '../../store/useMarketStore';
import { useReplayStore } from '../../store/useReplayStore';
import { useUIStore } from '../../store/useUIStore';
import { DrawingCanvas } from './DrawingCanvas';
import { fetchHistoricalData } from '../../services/historicalApi';
import { Candle } from '../../types/market';

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

  const lastVisibleRangeRef = useRef<{ from: number; to: number } | null>(null);
  const prevTFRef = useRef<number | null>(null);
  const prevSymbolRef = useRef<string | null>(null);
  const prevReplayActiveRef = useRef<boolean>(false);
  const lastReplayJumpIdxRef = useRef<number | null>(null);

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
    setBaseCandles,
    setSymbol,
  } = useMarketStore();

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
    newChart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.84, bottom: 0 },
    });

    setChart(newChart);
    setVolumeSeries(vSeries);

    const handleTimeRangeChange = (range: any) => {
      if (range && typeof range.from === 'number' && typeof range.to === 'number') {
        lastVisibleRangeRef.current = { from: range.from, to: range.to };
      }
    };
    newChart.timeScale().subscribeVisibleTimeRangeChange(handleTimeRangeChange);

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
      volumeSeries.applyOptions({ visible: showVolume });
    }
  }, [chart, showGrid, showVolume, volumeSeries]);

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

    requestAnimationFrame(() => {
      setMainSeries(newMain);
    });

    return () => {
      try {
        chart.removeSeries(newMain);
      } catch {}
    };
  }, [chart, chartType]);

  // ── SET DATA & INTELLIGENT VIEWPORT MANAGEMENT ────────────
  useEffect(() => {
    if (!mainSeries || !displayCandles.length) return;

    const isTFChange = prevTFRef.current !== null && prevTFRef.current !== activeTF;
    const isSymbolChange = prevSymbolRef.current !== null && prevSymbolRef.current !== currentSymbol;
    const isReplayJustStarted = !prevReplayActiveRef.current && isReplayActive;
    const isReplayJump =
      isReplayActive &&
      lastReplayJumpIdxRef.current !== null &&
      Math.abs(currentIndex - lastReplayJumpIdxRef.current) > 3;

    prevTFRef.current = activeTF;
    prevSymbolRef.current = currentSymbol;
    prevReplayActiveRef.current = isReplayActive;
    lastReplayJumpIdxRef.current = currentIndex;

    const savedRange = lastVisibleRangeRef.current;

    // Apply data
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
      volumeSeries.applyOptions({
        visible: showVolume,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      if (showVolume) {
        volumeSeries.setData(
          displayCandles.map((c) => ({
            time: c.time as any,
            value: c.volume,
            color: c.close >= c.open ? 'rgba(16, 185, 129, 0.40)' : 'rgba(244, 63, 94, 0.40)',
          }))
        );
      }
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

      const hasSubPanes = activeIndicators.some((i) => i.type === 'RSI' || i.type === 'MACD');
      try {
        chart.priceScale('right').applyOptions({
          scaleMargins: { top: 0.05, bottom: hasSubPanes ? 0.42 : 0.26 },
        });
        chart.priceScale('volume').applyOptions({
          scaleMargins: { top: hasSubPanes ? 0.62 : 0.84, bottom: hasSubPanes ? 0.28 : 0 },
        });
      } catch {}

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

            if (scaleId !== 'right') {
              try {
                chart.priceScale(scaleId).applyOptions({
                  scaleMargins: { top: 0.83, bottom: 0.02 },
                  autoScale: true,
                });
              } catch (scaleErr) {
                console.warn('Scale init error:', scaleErr);
              }
            }
          }

          if (!displayCandles || displayCandles.length === 0) return;

          const p = ind.period || (isRSI ? 14 : isMACD ? 12 : 20);
          const indData: any[] = [];

          if (isRSI) {
            if (displayCandles.length > p) {
              let gains = 0, losses = 0;
              for (let i = 1; i <= p; i++) {
                const diff = displayCandles[i].close - displayCandles[i - 1].close;
                if (diff >= 0) gains += diff;
                else losses -= diff;
              }
              let avgGain = gains / p;
              let avgLoss = losses / p;
              let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
              indData.push({ time: displayCandles[p].time, value: 100 - (100 / (1 + rs)) });

              for (let i = p + 1; i < displayCandles.length; i++) {
                const diff = displayCandles[i].close - displayCandles[i - 1].close;
                const gain = diff > 0 ? diff : 0;
                const loss = diff < 0 ? -diff : 0;
                avgGain = (avgGain * (p - 1) + gain) / p;
                avgLoss = (avgLoss * (p - 1) + loss) / p;
                rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
                indData.push({ time: displayCandles[i].time, value: 100 - (100 / (1 + rs)) });
              }
            }
          } else if (isMACD) {
            if (displayCandles.length >= 26) {
              const k12 = 2 / 13, k26 = 2 / 27;
              let ema12 = displayCandles[0].close, ema26 = displayCandles[0].close;
              for (let i = 1; i < displayCandles.length; i++) {
                ema12 = displayCandles[i].close * k12 + ema12 * (1 - k12);
                ema26 = displayCandles[i].close * k26 + ema26 * (1 - k26);
                if (i >= 26) {
                  indData.push({ time: displayCandles[i].time, value: ema12 - ema26 });
                }
              }
            }
          } else if (ind.type === 'EMA') {
            if (displayCandles.length >= p) {
              const k = 2 / (p + 1);
              let ema = displayCandles[0].close;
              for (let i = 0; i < displayCandles.length; i++) {
                ema = displayCandles[i].close * k + ema * (1 - k);
                if (i >= p - 1) {
                  indData.push({ time: displayCandles[i].time, value: ema });
                }
              }
            }
          } else {
            // SMA
            if (displayCandles.length >= p) {
              for (let i = p - 1; i < displayCandles.length; i++) {
                let sum = 0;
                for (let k = i - p + 1; k <= i; k++) sum += displayCandles[k].close;
                indData.push({ time: displayCandles[i].time, value: sum / p });
              }
            }
          }

          s.setData(indData);
        } catch (err) {
          console.warn(`Error updating indicator ${ind.type}:`, err);
        }
      });

      // Viewport Control
      if (isReplayJustStarted || isReplayJump) {
        // Focus directly on the latest replay candles with space to the right
        const count = displayCandles.length;
        chart.timeScale().setVisibleLogicalRange({
          from: Math.max(0, count - 75),
          to: count + 12,
        });
      } else if (isTFChange && savedRange && savedRange.from && savedRange.to) {
        // Preserve viewport across TF switches
        try {
          chart.timeScale().setVisibleRange({
            from: savedRange.from as any,
            to: savedRange.to as any,
          });
        } catch {}
      } else if (isSymbolChange || !savedRange) {
        lastVisibleRangeRef.current = null;
        chart.timeScale().fitContent();
      }
    }
  }, [mainSeries, volumeSeries, displayCandles, chartType, showVolume, chart, activeIndicators, activeTF, currentSymbol, isReplayActive, currentIndex]);

  // ── FIT CONTENT TRIGGER ───────────────────────────────────
  useEffect(() => {
    if (currentFitContentTrigger > 0 && chart) {
      chart.timeScale().fitContent();
    }
  }, [currentFitContentTrigger, chart]);

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
      let idx = baseCandles.findIndex((c) => c.time >= time);
      if (idx === -1) idx = baseCandles.length - 1;
      const candle = baseCandles[idx];
      const snappedX = chart.timeScale().timeToCoordinate(candle.time as any) ?? mx;
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
      const idx = baseCandles.findIndex((c) => c.time >= time);
      const chosenIdx = idx !== -1 ? idx : baseCandles.length - 20;
      setStartIndex(chosenIdx);
      setCurrentIndex(chosenIdx);
      setIsPicking(false);
      setHoverCandleInfo(null);
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
      <div
        id="chart-container"
        onClick={handleChartClick}
        onMouseMove={handleChartMouseMove}
        onMouseLeave={handleChartMouseLeave}
        style={{ cursor: isPicking ? 'crosshair' : undefined, position: 'relative' }}
      >
        {/* Chart Canvas */}
        <div id="tv-chart" ref={chartWrapperRef} style={{ width: '100%', height: '100%' }}>
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
            className="replay-cut-container"
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              right: 0,
              pointerEvents: 'none',
              zIndex: 40,
              overflow: 'hidden',
            }}
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
              <span style={{ color: '#38BDF8', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                <Scissors size={12} strokeWidth={2.4} />
                Couper ici :
              </span>
              <span style={{ fontFamily: 'var(--mono)', color: '#38BDF8' }}>
                {new Date(hoverCandleInfo.candle.time * 1000).toLocaleString('fr-FR', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
              <span style={{ color: '#94A3B8', fontSize: '10px' }}>
                ({hoverCandleInfo.candle.close.toFixed(hoverCandleInfo.candle.close < 10 ? 5 : 2)})
              </span>
            </div>
          </div>
        )}

        {/* Replay Start Hint (Floating Top Glass Banner) */}
        {isPicking && !hoverCandleInfo && (
          <div id="replay-hint">
            <div className="rh-icon-wrap" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <History size={17} strokeWidth={2.2} />
            </div>
            <div className="rh-content">
              <div className="rh-text">Mode Replay : Choisissez le point de départ</div>
              <div className="rh-sub">Survolez le graphique et cliquez sur une bougie pour couper</div>
            </div>
            <div className="rh-badge">Échap pour quitter</div>
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
              <div className="welcome-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <TrendingUp size={28} strokeWidth={2.5} style={{ color: '#38BDF8' }} />
              </div>
              <div className="welcome-title">Bienvenue sur <span>TradeView Pro</span></div>
              <div className="welcome-sub">
                Importez vos données de marché ou connectez les flux en direct pour visualiser les chandeliers, rejouer des sessions et simuler des trades.
              </div>
              <div id="drop-zone" onClick={() => openModal('import')}>
                <div className="drop-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <UploadCloud size={30} strokeWidth={1.8} style={{ color: '#38BDF8' }} />
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
          <div className="status-item" id="status-replay" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span className="status-replay-icon" style={{ display: 'inline-flex', alignItems: 'center' }}>
              <Play size={11} strokeWidth={2.4} fill="currentColor" />
            </span>
            <span id="replay-status-text">Mode Replay</span>
          </div>
        )}
      </div>
    </div>
  );
};
