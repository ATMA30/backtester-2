import React, { useEffect, useRef, useCallback } from 'react';
import { useDrawingStore } from '../../store/useDrawingStore';
import { useMarketStore } from '../../store/useMarketStore';
import { Drawing, Point, Handle, DrawingTool } from '../../types/drawing';
import { IChartApi, ISeriesApi } from 'lightweight-charts';

interface DrawingCanvasProps {
  chart: IChartApi | null;
  mainSeries: ISeriesApi<'Candlestick' | 'Bar' | 'Line' | 'Area'> | null;
  width: number;
  height: number;
}

export const DrawingCanvas: React.FC<DrawingCanvasProps> = ({
  chart,
  mainSeries,
  width,
  height,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const {
    drawings,
    activeTool,
    selectedDrawingId,
    currentStyle,
    addDrawing,
    updateDrawing,
    removeDrawing,
    selectDrawing,
    setActiveTool,
  } = useDrawingStore();

  const { baseCandles, sortedTimes, baseTF, activeTF } = useMarketStore();

  const currentPtsRef = useRef<Point[]>([]);
  const isDraggingRef = useRef(false);
  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const activeHandleRef = useRef<Handle | null>(null);

  // ── BAR INDEX PROJECTION ──────────────────────────────────
  const snapIndexInBase = useCallback((time: number): number => {
    if (!baseCandles || !baseCandles.length) return -1;
    let lo = 0, hi = baseCandles.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (baseCandles[mid].time < time) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0 && Math.abs(baseCandles[lo - 1].time - time) < Math.abs(baseCandles[lo].time - time)) {
      return lo - 1;
    }
    return lo;
  }, [baseCandles]);

  const getBarSpacingPx = useCallback((): number => {
    if (!chart) return 8;
    const ts = chart.timeScale();
    const times = sortedTimes && sortedTimes.length ? sortedTimes : baseCandles.map((c) => c.time);
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
      if (sp > 0.1 && sp < 500) return sp;
    }
    return 8;
  }, [chart, sortedTimes, baseCandles]);

  const toXY = useCallback((time: number, price: number): { x: number | null; y: number | null } => {
    if (!chart || !mainSeries) return { x: null, y: null };
    const ts = chart.timeScale();
    let x: number | null = ts.timeToCoordinate(time as any);

    if ((x === null || x === undefined) && sortedTimes.length >= 1) {
      const n = sortedTimes.length;
      const lastTime = sortedTimes[n - 1];
      const lastX = ts.timeToCoordinate(lastTime as any);
      const barSpacing = getBarSpacingPx();

      if (baseCandles && baseCandles.length > 0) {
        const targetIdx = snapIndexInBase(time);
        const currentLastIdx = snapIndexInBase(lastTime);
        if (targetIdx !== -1 && currentLastIdx !== -1 && lastX !== null && lastX !== undefined) {
          const barDelta = targetIdx - currentLastIdx;
          x = lastX + barDelta * barSpacing;
        }
      }

      if (x === null || x === undefined) {
        const tf = activeTF || baseTF || 60;
        if (lastX !== null && lastX !== undefined) {
          const barDelta = (time - lastTime) / tf;
          x = lastX + barDelta * barSpacing;
        }
      }
    }

    const y = mainSeries.priceToCoordinate(price);
    return { x: x ?? null, y: y ?? null };
  }, [chart, mainSeries, sortedTimes, baseCandles, activeTF, baseTF, getBarSpacingPx, snapIndexInBase]);

  const fromXY = useCallback((x: number, y: number): { time: number; price: number } => {
    if (!chart || !mainSeries) return { time: 0, price: 0 };
    const ts = chart.timeScale();
    let time = ts.coordinateToTime(x) as number | null;

    if (!time && sortedTimes.length >= 1) {
      const n = sortedTimes.length;
      const lastTime = sortedTimes[n - 1];
      const lastX = ts.timeToCoordinate(lastTime as any);
      const barSpacing = getBarSpacingPx();

      if (lastX !== null && lastX !== undefined && barSpacing > 0.01) {
        const barsOff = Math.round((x - lastX) / barSpacing);
        if (baseCandles && baseCandles.length > 0) {
          const lastIdxInBase = snapIndexInBase(lastTime);
          const targetIdx = Math.max(0, Math.min(baseCandles.length - 1, lastIdxInBase + barsOff));
          time = baseCandles[targetIdx].time;
        } else {
          const tf = activeTF || baseTF || 60;
          time = lastTime + barsOff * tf;
        }
      }
      if (!time) time = lastTime;
    }

    const price = mainSeries.coordinateToPrice(y) || 0;
    return { time: time || 0, price };
  }, [chart, mainSeries, sortedTimes, baseCandles, activeTF, baseTF, getBarSpacingPx, snapIndexInBase]);

  // ── DRAWING CANVAS REDRAW ─────────────────────────────────
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    drawings.forEach((d) => {
      const isSelected = d.id === selectedDrawingId;
      ctx.save();
      ctx.strokeStyle = d.style.color;
      ctx.lineWidth = d.style.width * dpr;
      ctx.fillStyle = d.style.fill || 'transparent';

      if (d.type === 'trendline' && d.pts.length >= 2) {
        const p0 = toXY(d.pts[0].time, d.pts[0].price);
        const p1 = toXY(d.pts[1].time, d.pts[1].price);
        if (p0.x !== null && p0.y !== null && p1.x !== null && p1.y !== null) {
          ctx.beginPath();
          ctx.moveTo(p0.x * dpr, p0.y * dpr);
          ctx.lineTo(p1.x * dpr, p1.y * dpr);
          ctx.stroke();
        }
      } else if (d.type === 'hline' && d.pts.length >= 1) {
        const p = toXY(d.pts[0].time, d.pts[0].price);
        if (p.y !== null) {
          ctx.beginPath();
          ctx.moveTo(0, p.y * dpr);
          ctx.lineTo(width * dpr, p.y * dpr);
          ctx.stroke();
        }
      } else if (d.type === 'rect' && d.pts.length >= 2) {
        const p0 = toXY(d.pts[0].time, d.pts[0].price);
        const p1 = toXY(d.pts[1].time, d.pts[1].price);
        if (p0.x !== null && p0.y !== null && p1.x !== null && p1.y !== null) {
          const rx = Math.min(p0.x, p1.x) * dpr;
          const ry = Math.min(p0.y, p1.y) * dpr;
          const rw = Math.abs(p1.x - p0.x) * dpr;
          const rh = Math.abs(p1.y - p0.y) * dpr;
          ctx.fillRect(rx, ry, rw, rh);
          ctx.strokeRect(rx, ry, rw, rh);
        }
      } else if ((d.type === 'pos_long' || d.type === 'pos_short') && d.pts.length >= 3) {
        const pEntry = toXY(d.pts[0].time, d.pts[0].price);
        const pTP = toXY(d.pts[1].time, d.pts[1].price);
        const pSL = toXY(d.pts[2].time, d.pts[2].price);
        if (pEntry.x !== null && pEntry.y !== null && pTP.x !== null && pTP.y !== null && pSL.y !== null) {
          const rx = Math.min(pEntry.x, pTP.x) * dpr;
          const rw = Math.abs(pTP.x - pEntry.x) * dpr;

          // Target Zone (Green)
          ctx.fillStyle = 'rgba(0, 210, 106, 0.20)';
          ctx.strokeStyle = '#00D26A';
          const tpY = Math.min(pEntry.y, pTP.y) * dpr;
          const tpH = Math.abs(pTP.y - pEntry.y) * dpr;
          ctx.fillRect(rx, tpY, rw, tpH);
          ctx.strokeRect(rx, tpY, rw, tpH);

          // Stop Zone (Red)
          ctx.fillStyle = 'rgba(255, 59, 92, 0.20)';
          ctx.strokeStyle = '#FF3B5C';
          const slY = Math.min(pEntry.y, pSL.y) * dpr;
          const slH = Math.abs(pSL.y - pEntry.y) * dpr;
          ctx.fillRect(rx, slY, rw, slH);
          ctx.strokeRect(rx, slY, rw, slH);
        }
      }

      // Render Handles if selected
      if (isSelected) {
        ctx.fillStyle = '#FFFFFF';
        ctx.strokeStyle = '#3B82F6';
        ctx.lineWidth = 2 * dpr;
        d.pts.forEach((pt) => {
          const p = toXY(pt.time, pt.price);
          if (p.x !== null && p.y !== null) {
            ctx.beginPath();
            ctx.arc(p.x * dpr, p.y * dpr, 5 * dpr, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
        });
      }

      ctx.restore();
    });

    // Preview
    if (currentPtsRef.current.length > 0 && activeTool !== 'cursor') {
      ctx.save();
      ctx.strokeStyle = currentStyle.color;
      ctx.lineWidth = currentStyle.width * dpr;
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      const p0 = toXY(currentPtsRef.current[0].time, currentPtsRef.current[0].price);
      if (currentPtsRef.current.length >= 2) {
        const p1 = toXY(currentPtsRef.current[1].time, currentPtsRef.current[1].price);
        if (p0.x !== null && p0.y !== null && p1.x !== null && p1.y !== null) {
          ctx.beginPath();
          ctx.moveTo(p0.x * dpr, p0.y * dpr);
          ctx.lineTo(p1.x * dpr, p1.y * dpr);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }, [drawings, selectedDrawingId, activeTool, currentStyle, toXY, width]);

  useEffect(() => {
    redraw();
  }, [redraw, width, height, sortedTimes]);

  useEffect(() => {
    if (!chart) return;
    const handler = () => {
      requestAnimationFrame(redraw);
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(handler);
    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handler);
    };
  }, [chart, redraw]);

  // ── MOUSE HANDLERS ────────────────────────────────────────
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const pt = fromXY(mx, my);

    dragStartPosRef.current = { x: mx, y: my };
    isDraggingRef.current = true;

    if (activeTool === 'cursor') {
      // Find clicked drawing
      let clickedId: string | null = null;
      for (const d of drawings) {
        for (const p of d.pts) {
          const xy = toXY(p.time, p.price);
          if (xy.x !== null && xy.y !== null && Math.hypot(mx - xy.x, my - xy.y) < 15) {
            clickedId = d.id;
            break;
          }
        }
        if (clickedId) break;
      }
      selectDrawing(clickedId);
      redraw();
      return;
    }

    if (activeTool === 'trendline' || activeTool === 'rect') {
      currentPtsRef.current = [pt, pt];
      redraw();
    } else if (activeTool === 'pos_long' || activeTool === 'pos_short') {
      const pip = 0.0001;
      const targetDelta = activeTool === 'pos_long' ? pip * 40 : -pip * 40;
      const slDelta = activeTool === 'pos_long' ? -pip * 20 : pip * 20;
      const newD: Drawing = {
        id: 'draw_' + Date.now(),
        type: activeTool,
        pts: [
          pt,
          { time: pt.time + 3600 * 24, price: pt.price + targetDelta },
          { time: pt.time, price: pt.price + slDelta },
        ],
        style: currentStyle,
      };
      addDrawing(newD);
    } else if (activeTool === 'hline') {
      const newD: Drawing = {
        id: 'draw_' + Date.now(),
        type: 'hline',
        pts: [pt],
        style: currentStyle,
      };
      addDrawing(newD);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const pt = fromXY(mx, my);

    if (isDraggingRef.current && currentPtsRef.current.length >= 2) {
      currentPtsRef.current[1] = pt;
      redraw();
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;

    if (currentPtsRef.current.length >= 2 && activeTool !== 'cursor') {
      const p0 = currentPtsRef.current[0];
      const p1 = currentPtsRef.current[1];
      const dist = Math.hypot(p1.time - p0.time, p1.price - p0.price);

      if (dist > 0) {
        const newD: Drawing = {
          id: 'draw_' + Date.now(),
          type: activeTool,
          pts: [p0, p1],
          style: currentStyle,
        };
        addDrawing(newD);
      }
      currentPtsRef.current = [];
      redraw();
    }
  };

  return (
    <canvas
      ref={canvasRef}
      width={width * (window.devicePixelRatio || 1)}
      height={height * (window.devicePixelRatio || 1)}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: `${width}px`,
        height: `${height}px`,
        pointerEvents: activeTool === 'cursor' && !selectedDrawingId ? 'none' : 'auto',
        zIndex: 10,
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    />
  );
};
