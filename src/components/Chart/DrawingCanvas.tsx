import React, { useEffect, useRef, useCallback } from 'react';
import { useDrawingStore } from '../../store/useDrawingStore';
import { useMarketStore } from '../../store/useMarketStore';
import { useTradeStore } from '../../store/useTradeStore';
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

  const { baseCandles, sortedTimes, baseTF, activeTF, currentSymbol } = useMarketStore();
  const { openTrade } = useTradeStore();

  const drawPtsRef = useRef<Point[]>([]);
  const isMouseDownRef = useRef(false);
  const mouseDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const dragHandleRef = useRef<Handle | null>(null);

  // ── SNAP TO EXACT BAR INDEX ───────────────────────────────
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
      ctx.strokeStyle = d.style.color || '#3B82F6';
      ctx.lineWidth = (d.style.width || 2) * dpr;
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
      } else if (d.type === 'ray' && d.pts.length >= 2) {
        const p0 = toXY(d.pts[0].time, d.pts[0].price);
        const p1 = toXY(d.pts[1].time, d.pts[1].price);
        if (p0.x !== null && p0.y !== null && p1.x !== null && p1.y !== null) {
          const dx = p1.x - p0.x;
          const dy = p1.y - p0.y;
          const extX = p0.x + dx * 20;
          const extY = p0.y + dy * 20;
          ctx.beginPath();
          ctx.moveTo(p0.x * dpr, p0.y * dpr);
          ctx.lineTo(extX * dpr, extY * dpr);
          ctx.stroke();
        }
      } else if (d.type === 'hline' && d.pts.length >= 1) {
        const p = toXY(d.pts[0].time, d.pts[0].price);
        if (p.y !== null) {
          ctx.beginPath();
          ctx.moveTo(0, p.y * dpr);
          ctx.lineTo(width * dpr, p.y * dpr);
          ctx.stroke();

          // Price label
          ctx.fillStyle = d.style.color || '#3B82F6';
          ctx.font = `bold ${10 * dpr}px Inter, sans-serif`;
          ctx.fillText(d.pts[0].price.toFixed(5), (width - 65) * dpr, (p.y - 4) * dpr);
        }
      } else if (d.type === 'vline' && d.pts.length >= 1) {
        const p = toXY(d.pts[0].time, d.pts[0].price);
        if (p.x !== null) {
          ctx.beginPath();
          ctx.moveTo(p.x * dpr, 0);
          ctx.lineTo(p.x * dpr, height * dpr);
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
          ctx.fillStyle = d.style.fill || 'rgba(59, 130, 246, 0.14)';
          ctx.fillRect(rx, ry, rw, rh);
          ctx.strokeRect(rx, ry, rw, rh);
        }
      } else if (d.type === 'fib' && d.pts.length >= 2) {
        const p0 = toXY(d.pts[0].time, d.pts[0].price);
        const p1 = toXY(d.pts[1].time, d.pts[1].price);
        if (p0.x !== null && p0.y !== null && p1.x !== null && p1.y !== null) {
          const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0];
          const colors = ['#787B86', '#F23645', '#FF9800', '#4CAF50', '#089981', '#00BCD4', '#787B86'];
          const xStart = Math.min(p0.x, p1.x) * dpr;
          const xEnd = (Math.max(p0.x, p1.x) + 120) * dpr;

          levels.forEach((lvl, idx) => {
            const priceVal = d.pts[0].price + (d.pts[1].price - d.pts[0].price) * lvl;
            const yCoord = mainSeries?.priceToCoordinate(priceVal);
            if (yCoord !== null && yCoord !== undefined) {
              ctx.strokeStyle = colors[idx % colors.length];
              ctx.beginPath();
              ctx.moveTo(xStart, yCoord * dpr);
              ctx.lineTo(xEnd, yCoord * dpr);
              ctx.stroke();
              ctx.fillStyle = colors[idx % colors.length];
              ctx.font = `${9 * dpr}px Inter, sans-serif`;
              ctx.fillText(`${(lvl * 100).toFixed(1)}% (${priceVal.toFixed(4)})`, xStart + 4 * dpr, (yCoord - 3) * dpr);
            }
          });
        }
      } else if (d.type === 'channel' && d.pts.length >= 3) {
        const p0 = toXY(d.pts[0].time, d.pts[0].price);
        const p1 = toXY(d.pts[1].time, d.pts[1].price);
        const p2 = toXY(d.pts[2].time, d.pts[2].price);
        if (p0.x !== null && p0.y !== null && p1.x !== null && p1.y !== null && p2.x !== null && p2.y !== null) {
          const dx = p1.x - p0.x;
          const dy = p1.y - p0.y;
          ctx.fillStyle = 'rgba(59, 130, 246, 0.12)';
          ctx.beginPath();
          ctx.moveTo(p0.x * dpr, p0.y * dpr);
          ctx.lineTo(p1.x * dpr, p1.y * dpr);
          ctx.lineTo((p2.x + dx) * dpr, (p2.y + dy) * dpr);
          ctx.lineTo(p2.x * dpr, p2.y * dpr);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      } else if ((d.type === 'pos_long' || d.type === 'pos_short') && d.pts.length >= 3) {
        const pEntry = toXY(d.pts[0].time, d.pts[0].price);
        const pTP = toXY(d.pts[1].time, d.pts[1].price);
        const pSL = toXY(d.pts[2].time, d.pts[2].price);

        if (pEntry.x !== null && pEntry.y !== null && pTP.x !== null && pTP.y !== null && pSL.y !== null) {
          const rx = Math.min(pEntry.x, pTP.x) * dpr;
          const rw = Math.abs(pTP.x - pEntry.x) * dpr;

          // Target Zone (Green)
          ctx.fillStyle = 'rgba(0, 210, 106, 0.22)';
          ctx.strokeStyle = '#00D26A';
          const tpY = Math.min(pEntry.y, pTP.y) * dpr;
          const tpH = Math.abs(pTP.y - pEntry.y) * dpr;
          ctx.fillRect(rx, tpY, rw, tpH);
          ctx.strokeRect(rx, tpY, rw, tpH);

          // Stop Zone (Red)
          ctx.fillStyle = 'rgba(255, 59, 92, 0.22)';
          ctx.strokeStyle = '#FF3B5C';
          const slY = Math.min(pEntry.y, pSL.y) * dpr;
          const slH = Math.abs(pSL.y - pEntry.y) * dpr;
          ctx.fillRect(rx, slY, rw, slH);
          ctx.strokeRect(rx, slY, rw, slH);

          // Middle Entry line
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 1.5 * dpr;
          ctx.beginPath();
          ctx.moveTo(rx, pEntry.y * dpr);
          ctx.lineTo(rx + rw, pEntry.y * dpr);
          ctx.stroke();

          // Ratio R:R
          const targetDist = Math.abs(d.pts[1].price - d.pts[0].price);
          const stopDist = Math.abs(d.pts[0].price - d.pts[2].price);
          const rr = stopDist > 0 ? (targetDist / stopDist).toFixed(2) : '1.00';
          ctx.fillStyle = '#FFFFFF';
          ctx.font = `bold ${10 * dpr}px Inter, sans-serif`;
          ctx.fillText(`R:R ${rr}`, rx + 6 * dpr, (pEntry.y - 4) * dpr);
        }
      } else if (d.type === 'text' && d.pts.length >= 1) {
        const p = toXY(d.pts[0].time, d.pts[0].price);
        if (p.x !== null && p.y !== null) {
          ctx.fillStyle = '#FFFFFF';
          ctx.font = `bold ${12 * dpr}px Inter, sans-serif`;
          ctx.fillText(d.style.text || 'Annotation', p.x * dpr, p.y * dpr);
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
            ctx.arc(p.x * dpr, p.y * dpr, 4 * dpr, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
        });
      }

      ctx.restore();
    });

    // ── LIVE PREVIEW ─────────────────────────────────────────
    if (drawPtsRef.current.length > 0 && activeTool !== 'cursor') {
      ctx.save();
      ctx.strokeStyle = currentStyle.color || '#3B82F6';
      ctx.lineWidth = (currentStyle.width || 2) * dpr;
      ctx.setLineDash([4 * dpr, 4 * dpr]);

      const p0 = toXY(drawPtsRef.current[0].time, drawPtsRef.current[0].price);
      if (drawPtsRef.current.length >= 2) {
        const p1 = toXY(drawPtsRef.current[1].time, drawPtsRef.current[1].price);
        if (p0.x !== null && p0.y !== null && p1.x !== null && p1.y !== null) {
          if (activeTool === 'rect') {
            const rx = Math.min(p0.x, p1.x) * dpr;
            const ry = Math.min(p0.y, p1.y) * dpr;
            const rw = Math.abs(p1.x - p0.x) * dpr;
            const rh = Math.abs(p1.y - p0.y) * dpr;
            ctx.fillStyle = 'rgba(59, 130, 246, 0.12)';
            ctx.fillRect(rx, ry, rw, rh);
            ctx.strokeRect(rx, ry, rw, rh);
          } else {
            ctx.beginPath();
            ctx.moveTo(p0.x * dpr, p0.y * dpr);
            ctx.lineTo(p1.x * dpr, p1.y * dpr);
            ctx.stroke();
          }
        }
      }
      ctx.restore();
    }
  }, [drawings, selectedDrawingId, activeTool, currentStyle, toXY, width, height, mainSeries]);

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

  // ── MOUSE EVENTS (DUAL DRAG & 2-CLICK PLACEMENT) ───────────
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const pt = fromXY(mx, my);

    mouseDownPosRef.current = { x: mx, y: my };
    isMouseDownRef.current = true;

    if (activeTool === 'cursor') {
      // Find clicked drawing
      let clickedId: string | null = null;
      for (const d of drawings) {
        for (const p of d.pts) {
          const xy = toXY(p.time, p.price);
          if (xy.x !== null && xy.y !== null && Math.hypot(mx - xy.x, my - xy.y) < 18) {
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

    const pip = currentSymbol.includes('JPY') ? 0.01 : 0.0001;

    // Direct 1-Click Placement tools
    if (activeTool === 'pos_long' || activeTool === 'pos_short') {
      const isLong = activeTool === 'pos_long';
      const newD: Drawing = {
        id: 'draw_' + Date.now(),
        type: activeTool,
        pts: [
          pt,
          { time: pt.time + 3600 * 24 * 3, price: isLong ? pt.price + pip * 40 : pt.price - pip * 40 },
          { time: pt.time, price: isLong ? pt.price - pip * 20 : pt.price + pip * 20 },
        ],
        style: currentStyle,
      };
      addDrawing(newD);
      drawPtsRef.current = [];
      return;
    }

    if (activeTool === 'hline') {
      const newD: Drawing = {
        id: 'draw_' + Date.now(),
        type: 'hline',
        pts: [pt],
        style: currentStyle,
      };
      addDrawing(newD);
      drawPtsRef.current = [];
      return;
    }

    if (activeTool === 'vline') {
      const newD: Drawing = {
        id: 'draw_' + Date.now(),
        type: 'vline',
        pts: [pt],
        style: currentStyle,
      };
      addDrawing(newD);
      drawPtsRef.current = [];
      return;
    }

    if (activeTool === 'text') {
      const textVal = prompt('Texte de l\'annotation :', 'Zone clé');
      if (textVal) {
        const newD: Drawing = {
          id: 'draw_' + Date.now(),
          type: 'text',
          pts: [pt],
          style: { ...currentStyle, text: textVal },
        };
        addDrawing(newD);
      }
      drawPtsRef.current = [];
      return;
    }

    // 2-Point and 3-Point Placement tools
    if (drawPtsRef.current.length === 0) {
      drawPtsRef.current = [pt, pt];
      redraw();
    } else {
      // 2nd click in 2-click mode
      const p0 = drawPtsRef.current[0];
      const newD: Drawing = {
        id: 'draw_' + Date.now(),
        type: activeTool,
        pts: [p0, pt],
        style: currentStyle,
      };
      addDrawing(newD);
      drawPtsRef.current = [];
      redraw();
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const pt = fromXY(mx, my);

    if (drawPtsRef.current.length >= 2 && activeTool !== 'cursor') {
      drawPtsRef.current[1] = pt;
      redraw();
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isMouseDownRef.current) return;
    isMouseDownRef.current = false;

    if (!mouseDownPosRef.current) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const dragDist = Math.hypot(mx - mouseDownPosRef.current.x, my - mouseDownPosRef.current.y);

    // If dragged more than 8 pixels, finalize immediately!
    if (dragDist > 8 && drawPtsRef.current.length >= 2 && activeTool !== 'cursor') {
      const p0 = drawPtsRef.current[0];
      const p1 = drawPtsRef.current[1];
      const newD: Drawing = {
        id: 'draw_' + Date.now(),
        type: activeTool,
        pts: [p0, p1],
        style: currentStyle,
      };
      addDrawing(newD);
      drawPtsRef.current = [];
      redraw();
    }
  };

  return (
    <canvas
      ref={canvasRef}
      id="draw-canvas"
      width={width * (window.devicePixelRatio || 1)}
      height={height * (window.devicePixelRatio || 1)}
      className={activeTool === 'cursor' && !selectedDrawingId ? 'cursor-mode' : 'active'}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: `${width}px`,
        height: `${height}px`,
        pointerEvents: activeTool === 'cursor' && !selectedDrawingId ? 'none' : 'auto',
        zIndex: 10,
        cursor: activeTool === 'cursor' ? 'default' : 'crosshair',
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    />
  );
};
