/**
 * Chart ↔ canvas coordinates for the drawing layer.
 *
 * The drawing canvas sits over the chart and must place every shape, badge and
 * handle exactly where the library draws the candles — across timeframes, past
 * the last bar and with the Ctrl magnet that snaps to OHLC values. Extracted
 * from `DrawingCanvas`, where it shared a 2 400-line closure with rendering
 * and mouse handling.
 */

import { IChartApi, ISeriesApi } from 'lightweight-charts';
import { Candle } from '../../../types/market';
import { useCallback, useEffect, useState } from 'react';
import { Point } from '../../../types/drawing';

export interface ProjectionInput {
  readonly chart: IChartApi | null;
  readonly mainSeries: ISeriesApi<'Candlestick' | 'Bar' | 'Line' | 'Area'> | null;
  readonly sortedTimes: number[];
  readonly displayCandles: Candle[];
  readonly activeTF: number;
  readonly baseTF: number;
}

export function useChartProjection({ chart, mainSeries, sortedTimes, displayCandles, activeTF, baseTF }: ProjectionInput) {
  const [isCtrlDown, setIsCtrlDown] = useState(false);

  // ── KEY LISTENERS (DELETE & CONTROL FOR OHLC SNAP) ────────
  useEffect(() => {
  // Only Ctrl tracking lives here. Delete/Backspace is handled once, in the
  // global keymap in `App`: both listeners used to fire for the same press, so
  // a deletion pushed two history entries and undo needed two presses.
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Control') setIsCtrlDown(true);
  };
  const handleKeyUp = (e: KeyboardEvent) => {
    if (e.key === 'Control') setIsCtrlDown(false);
  };
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  return () => {
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
  };
  }, []);

  // ── MEASURE BAR SPACING IN PIXELS ─────────────────────────
  const getBarSpacingPx = useCallback((): number => {
  if (!chart) return 8;
  const ts = chart.timeScale();
  const times = sortedTimes && sortedTimes.length ? sortedTimes : displayCandles.map((c) => c.time);
  if (!times || times.length < 2) return 8;

  const n = times.length;
  let x1: number | null = null, i1 = -1, x2: number | null = null, i2 = -1;
  for (let i = n - 1; i >= 0; i--) {
    const cx = ts.timeToCoordinate(times[i] as any);
    if (cx !== null && cx !== undefined) {
      if (x1 === null) { x1 = cx; i1 = i; }
      else             { x2 = cx; i2 = i; break; }
    }
  }
  if (x1 !== null && x2 !== null && i1 !== i2) {
    const sp = Math.abs(x1 - x2) / Math.abs(i1 - i2);
    if (sp > 0.05 && sp < 1000) return sp;
  }
  return 8;
  }, [chart, sortedTimes, displayCandles]);

  // ── MULTI-TIMEFRAME COORDINATE PROJECTION ─────────────────
  const toXY = useCallback((time: number, price: number): { x: number | null; y: number | null } => {
  if (!chart || !mainSeries) return { x: null, y: null };
  const ts = chart.timeScale();
  const y = mainSeries.priceToCoordinate(price);

  const directX = ts.timeToCoordinate(time as any);
  if (directX !== null && directX !== undefined) {
    return { x: directX, y: y ?? null };
  }

  const times = sortedTimes && sortedTimes.length ? sortedTimes : displayCandles.map((c) => c.time);
  if (!times || times.length === 0) {
    return { x: null, y: y ?? null };
  }

  const n = times.length;
  const barSpacing = getBarSpacingPx();
  const currentTF = activeTF || baseTF || 60;

  if (time < times[0]) {
    const firstX = ts.timeToCoordinate(times[0] as any);
    if (firstX !== null && firstX !== undefined && barSpacing > 0.01) {
      const barsBefore = (times[0] - time) / currentTF;
      return { x: firstX - barsBefore * barSpacing, y: y ?? null };
    }
  }

  if (time > times[n - 1]) {
    const lastX = ts.timeToCoordinate(times[n - 1] as any);
    if (lastX !== null && lastX !== undefined && barSpacing > 0.01) {
      const barsAfter = (time - times[n - 1]) / currentTF;
      return { x: lastX + barsAfter * barSpacing, y: y ?? null };
    }
  }

  let l = 0, r = n - 1;
  while (l <= r) {
    const mid = (l + r) >> 1;
    if (times[mid] === time) {
      const mx = ts.timeToCoordinate(times[mid] as any);
      return { x: mx, y: y ?? null };
    }
    if (times[mid] < time) l = mid + 1;
    else r = mid - 1;
  }

  const i0 = Math.max(0, Math.min(n - 1, r));
  const i1 = Math.max(0, Math.min(n - 1, l));
  const t0 = times[i0];
  const t1 = times[i1];
  const x0 = ts.timeToCoordinate(t0 as any);
  const x1 = ts.timeToCoordinate(t1 as any);

  if (x0 !== null && x1 !== null && x0 !== undefined && x1 !== undefined && t1 !== t0) {
    const ratio = (time - t0) / (t1 - t0);
    return { x: x0 + (x1 - x0) * ratio, y: y ?? null };
  }

  return { x: x0 ?? x1 ?? null, y: y ?? null };
  }, [chart, mainSeries, sortedTimes, displayCandles, activeTF, baseTF, getBarSpacingPx]);

  // ── INVERSE COORDINATE CONVERSION ─────────────────────────
  const fromXY = useCallback((x: number, y: number): Point => {
  if (!chart || !mainSeries) return { time: 0, price: 0 };
  const ts = chart.timeScale();
  let price = mainSeries.coordinateToPrice(y) || 0;

  const times = sortedTimes && sortedTimes.length ? sortedTimes : displayCandles.map((c) => c.time);
  if (!times || times.length === 0) {
    return { time: 0, price };
  }

  const n = times.length;
  const barSpacing = getBarSpacingPx();
  const currentTF = activeTF || baseTF || 60;

  let time = ts.coordinateToTime(x) as number | null;

  if (time === null || time === undefined) {
    const lastTime = times[n - 1];
    const lastX = ts.timeToCoordinate(lastTime as any);

    if (lastX !== null && lastX !== undefined && barSpacing > 0.01) {
      const barsOff = (x - lastX) / barSpacing;
      time = Math.round(lastTime + barsOff * currentTF);
    } else {
      const firstTime = times[0];
      const firstX = ts.timeToCoordinate(firstTime as any);
      if (firstX !== null && firstX !== undefined && barSpacing > 0.01) {
        const barsBefore = (firstX - x) / barSpacing;
        time = Math.round(firstTime - barsBefore * currentTF);
      }
    }
  }

  // Ctrl key: magnet snap to nearest OHLC
  if (isCtrlDown && displayCandles.length > 0) {
    let nearest: (typeof displayCandles)[0] | null = null;
    let minXDist = Infinity;
    for (const c of displayCandles) {
      const cx = chart.timeScale().timeToCoordinate(c.time as any);
      if (cx !== null) {
        const dist = Math.abs(cx - x);
        if (dist < minXDist) {
          minXDist = dist;
          nearest = c;
        }
      }
    }
    if (nearest && minXDist < 30) {
      time = nearest.time;
      const ohlc = [nearest.open, nearest.high, nearest.low, nearest.close];
      let bestPrice = price;
      let minYDist = Infinity;
      for (const p of ohlc) {
        const py = mainSeries.priceToCoordinate(p);
        if (py !== null) {
          const dist = Math.abs(py - y);
          if (dist < minYDist) {
            minYDist = dist;
            bestPrice = p;
          }
        }
      }
      price = bestPrice;
    }
  }

  return { time: time || 0, price };
  }, [chart, mainSeries, sortedTimes, displayCandles, activeTF, baseTF, getBarSpacingPx, isCtrlDown]);

  return { getBarSpacingPx, toXY, fromXY };
}
