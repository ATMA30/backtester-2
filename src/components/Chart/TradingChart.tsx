import React, { useEffect, useRef, useState } from 'react';
import { createChart, IChartApi, ISeriesApi } from 'lightweight-charts';
import { useMarketStore } from '../../store/useMarketStore';
import { DrawingCanvas } from './DrawingCanvas';

export const TradingChart: React.FC = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [chart, setChart] = useState<IChartApi | null>(null);
  const [mainSeries, setMainSeries] = useState<ISeriesApi<'Candlestick' | 'Bar' | 'Line' | 'Area'> | null>(null);
  const [volumeSeries, setVolumeSeries] = useState<ISeriesApi<'Histogram'> | null>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });

  const {
    displayCandles,
    chartType,
    showVolume,
    showGrid,
  } = useMarketStore();

  // ── INIT CHART ────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const newChart = createChart(containerRef.current, {
      layout: {
        background: { color: '#07090E' },
        textColor: '#848E9C',
        fontSize: 11,
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      },
      grid: {
        vertLines: { color: showGrid ? 'rgba(255, 255, 255, 0.04)' : 'transparent' },
        horzLines: { color: showGrid ? 'rgba(255, 255, 255, 0.04)' : 'transparent' },
      },
      crosshair: {
        mode: 1,
        vertLine: { color: 'rgba(59, 130, 246, 0.5)', width: 1, style: 3 },
        horzLine: { color: 'rgba(59, 130, 246, 0.5)', width: 1, style: 3 },
      },
      timeScale: {
        borderColor: '#1E222D',
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: {
        borderColor: '#1E222D',
        scaleMargins: { top: 0.08, bottom: 0.16 },
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
      if (containerRef.current) {
        const w = containerRef.current.clientWidth;
        const h = containerRef.current.clientHeight;
        newChart.applyOptions({ width: w, height: h });
        setSize({ width: w, height: h });
      }
    };

    const ro = new ResizeObserver(handleResize);
    ro.observe(containerRef.current);
    handleResize();

    return () => {
      ro.disconnect();
      newChart.remove();
    };
  }, []);

  // ── UPDATE MAIN SERIES TYPE ───────────────────────────────
  useEffect(() => {
    if (!chart) return;

    if (mainSeries) {
      chart.removeSeries(mainSeries);
    }

    let newMain: ISeriesApi<'Candlestick' | 'Bar' | 'Line' | 'Area'>;
    if (chartType === 'Candlestick') {
      newMain = chart.addCandlestickSeries({
        upColor: 'rgba(0,210,106,0.85)',
        downColor: 'rgba(255,59,92,0.85)',
        borderUpColor: '#00D26A',
        borderDownColor: '#FF3B5C',
        wickUpColor: '#00A855',
        wickDownColor: '#CC2E48',
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
        topColor: 'rgba(59, 130, 246, 0.4)',
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

    if (volumeSeries && showVolume) {
      volumeSeries.setData(
        displayCandles.map((c) => ({
          time: c.time as any,
          value: c.volume,
          color: c.close >= c.open ? 'rgba(0,210,106,0.30)' : 'rgba(255,59,92,0.30)',
        }))
      );
    }

    chart?.timeScale().fitContent();
  }, [mainSeries, volumeSeries, displayCandles, chartType, showVolume, chart]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: '#07090E',
      }}
    >
      <DrawingCanvas
        chart={chart}
        mainSeries={mainSeries}
        width={size.width}
        height={size.height}
      />
    </div>
  );
};
