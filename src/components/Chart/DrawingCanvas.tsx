import React, { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { Copy, Trash2 } from 'lucide-react';
import { blockTradingInThePast, currentTradingCandle } from '../Replay/replayGuards';
import { useDrawingStore } from '../../store/useDrawingStore';
import { useMarketStore } from '../../store/useMarketStore';
import { useTradeStore } from '../../store/useTradeStore';
import { Drawing, DrawingTool, Point } from '../../types/drawing';
import { IChartApi, ISeriesApi } from 'lightweight-charts';
import { getInstrument, unitsToLots } from '../../domain/instruments';
import { newId } from '../../utils/id';
import { TimeframeSeconds, supportsSessions } from '../../domain/timeframes';
import {
  channelRails,
  isPointInPolygon,
  isPointInRect,
  makeChannelPoints,
  pointToRayDistance,
  pointToSegmentDistance,
  moveChannelEndpoint,
} from '../../domain/geometry';

/**
 * Points d'un tracé à deux extrémités.
 *
 * Il existe deux voies de création — glisser-déposer et deux clics — et seule la
 * première traitait le cas du canal. La seconde produisait un canal à deux
 * points, donc d'écart nul : les deux rails se superposaient et la forme
 * s'affichait comme une simple ligne.
 */
/**
 * Largeur minimale, en pixels, sous laquelle l'étiquette d'une séance nuit.
 *
 * 26 px masquait les badges dès qu'on regardait une dizaine de jours en 5 min —
 * un zoom de travail parfaitement normal, où un bloc de Londres fait ~25 px.
 * Le seuil ne sert qu'à éviter l'empilement illisible des vues très dézoomées.
 */
const MIN_SESSION_LABEL_WIDTH = 12;

function buildDrawingPoints(tool: DrawingTool, p0: Point, p1: Point): Point[] {
  return tool === 'channel' ? makeChannelPoints(p0, p1) : [p0, p1];
}

interface DrawingCanvasProps {
  chart: IChartApi | null;
  mainSeries: ISeriesApi<'Candlestick' | 'Bar' | 'Line' | 'Area'> | null;
  width: number;
  height: number;
}

interface SessionDef {
  key: string;
  name: string;
  startHour: number;
  endHour: number;
  color: string;
  textColor: string;
  isKillzone?: boolean;
}

const ALL_SESSIONS: SessionDef[] = [
  { key: 'sydney', name: 'SYDNEY', startHour: 22, endHour: 7, color: 'rgba(167, 139, 250, 0.06)', textColor: '#A78BFA' },
  { key: 'tokyo', name: 'TOKYO', startHour: 0, endHour: 9, color: 'rgba(251, 146, 60, 0.06)', textColor: '#FB923C' },
  { key: 'london', name: 'LONDRES', startHour: 8, endHour: 17, color: 'rgba(96, 165, 250, 0.06)', textColor: '#60A5FA' },
  { key: 'newyork', name: 'NEW YORK', startHour: 13, endHour: 22, color: 'rgba(52, 211, 153, 0.06)', textColor: '#34D399' },
  { key: 'asianRange', name: 'ASIAN RANGE', startHour: 0, endHour: 6, color: 'rgba(244, 114, 182, 0.08)', textColor: '#F472B6', isKillzone: true },
  { key: 'londonOpenKZ', name: 'LONDON KZ', startHour: 7, endHour: 10, color: 'rgba(56, 189, 248, 0.08)', textColor: '#38BDF8', isKillzone: true },
  { key: 'nyOpenKZ', name: 'NY OPEN KZ', startHour: 12, endHour: 15, color: 'rgba(74, 222, 128, 0.08)', textColor: '#4ADE80', isKillzone: true },
  { key: 'londonCloseKZ', name: 'LONDON CLOSE', startHour: 15, endHour: 17, color: 'rgba(251, 191, 36, 0.08)', textColor: '#FBBF24', isKillzone: true },
];

function isCandleInSession(c: { time: number }, sess: SessionDef, useLocalTz: boolean): boolean {
  const d = new Date(c.time * 1000);
  const hour = useLocalTz ? d.getHours() : d.getUTCHours();
  if (sess.startHour < sess.endHour) {
    return hour >= sess.startHour && hour < sess.endHour;
  } else {
    return hour >= sess.startHour || hour < sess.endHour;
  }
}

function isSameTradingDay(t1: number, t2: number, sess: SessionDef, useLocalTz: boolean): boolean {
  const dt = Math.abs(t2 - t1);
  if (dt > 10800) return false;
  const d1 = new Date(t1 * 1000);
  const d2 = new Date(t2 * 1000);
  if (sess.startHour < sess.endHour) {
    const day1 = useLocalTz ? d1.getDate() : d1.getUTCDate();
    const day2 = useLocalTz ? d2.getDate() : d2.getUTCDate();
    return day1 === day2;
  }
  return true;
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
    commitDrawingEdit,
  } = useDrawingStore();

  const {
    displayCandles,
    sortedTimes,
    baseTF,
    activeTF,
    currentSymbol,
    separatorTF,
    forexSessions,
    activeIndicators,
  } = useMarketStore();

  const {
    activePosition,
    pendingOrders,
    closeAtMarket,
    updateActivePositionSlTp,
    updatePendingOrder,
    cancelPendingOrder,
  } = useTradeStore();

  /**
   * Pip size and price precision for the active instrument.
   *
   * Resolved once here instead of the eleven inline
   * `currentSymbol.includes('JPY') ? 0.01 : 0.0001` / `price > 500 ? 2 : 5`
   * derivations this file used to carry — those disagreed with the sizing rules
   * in the trade store and mis-rendered gold, indices and crypto.
   */
  const instrument = useMemo(
    () => getInstrument(currentSymbol, displayCandles[displayCandles.length - 1]?.close),
    [currentSymbol, displayCandles]
  );

  const drawPtsRef = useRef<Point[]>([]);
  const isMouseDownRef = useRef(false);
  const mouseDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const dragHandleRef = useRef<{ drawingId: string; ptIdx: number } | null>(null);
  const dragBodyRef = useRef<{ drawingId: string; startPts: Point[]; startMouse: { x: number; y: number } } | null>(null);
  const dragTradeRef = useRef<{
    type: 'ACTIVE_SL' | 'ACTIVE_TP' | 'PENDING_TARGET' | 'PENDING_SL' | 'PENDING_TP' | 'PULL_ACTIVE' | 'PULL_PENDING';
    orderId?: string;
  } | null>(null);
  const [isCtrlDown, setIsCtrlDown] = useState(false);
  /**
   * Annotation being typed, anchored where the user clicked. A native
   * `prompt()` used to block the page with an unstyled box far from the chart.
   */
  const [textDraft, setTextDraft] = useState<{ x: number; y: number; pt: Point } | null>(null);

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

  // ── HIT TESTING FOR POSITION & PENDING ORDER LINES / BUTTONS ──
  const hitTestTrade = useCallback((mx: number, my: number) => {
    if (!mainSeries) return null;

    // 1. Active Position
    if (activePosition) {
      const entryY = mainSeries.priceToCoordinate(activePosition.entry);
      const slY = activePosition.sl ? mainSeries.priceToCoordinate(activePosition.sl) : null;
      const tpY = activePosition.tp ? mainSeries.priceToCoordinate(activePosition.tp) : null;

      // Close Button on Entry Badge (right 36px of chart)
      if (entryY !== null && entryY !== undefined) {
        if (mx >= width - 36 && mx <= width - 8 && Math.abs(my - entryY) < 14) {
          return { action: 'CLOSE_ACTIVE' as const };
        }

        // Quick "+TP" chip button
        if (!activePosition.tp && mx >= width - 68 && mx <= width - 40 && Math.abs(my - entryY) < 14) {
          return { action: 'ADD_ACTIVE_TP' as const };
        }

        // Quick "+SL" chip button
        const slChipRight = !activePosition.tp ? width - 72 : width - 40;
        if (!activePosition.sl && mx >= slChipRight - 28 && mx <= slChipRight && Math.abs(my - entryY) < 14) {
          return { action: 'ADD_ACTIVE_SL' as const };
        }
      }

      // Clear SL Button on SL Badge
      if (slY !== null && slY !== undefined && activePosition.sl) {
        if (mx >= width - 36 && mx <= width - 8 && Math.abs(my - slY) < 14) {
          return { action: 'CLEAR_ACTIVE_SL' as const };
        }
      }

      // Clear TP Button on TP Badge
      if (tpY !== null && tpY !== undefined && activePosition.tp) {
        if (mx >= width - 36 && mx <= width - 8 && Math.abs(my - tpY) < 14) {
          return { action: 'CLEAR_ACTIVE_TP' as const };
        }
      }

      // Drag SL Line
      if (slY !== null && slY !== undefined && activePosition.sl) {
        if (Math.abs(my - slY) < 12) {
          return { action: 'DRAG' as const, type: 'ACTIVE_SL' as const };
        }
      }

      // Drag TP Line
      if (tpY !== null && tpY !== undefined && activePosition.tp) {
        if (Math.abs(my - tpY) < 12) {
          return { action: 'DRAG' as const, type: 'ACTIVE_TP' as const };
        }
      }

      // Drag Entry Line directly to pull SL or TP out of the entry line!
      if (entryY !== null && entryY !== undefined) {
        if (Math.abs(my - entryY) < 12) {
          return { action: 'DRAG' as const, type: 'PULL_ACTIVE' as const };
        }
      }
    }

    // 2. Pending Orders
    if (pendingOrders && pendingOrders.length > 0) {
      for (const o of pendingOrders) {
        const orderY = mainSeries.priceToCoordinate(o.targetPrice);
        const slY = o.sl ? mainSeries.priceToCoordinate(o.sl) : null;
        const tpY = o.tp ? mainSeries.priceToCoordinate(o.tp) : null;

        // Cancel Button on Pending Order Badge
        if (orderY !== null && orderY !== undefined) {
          if (mx >= width - 36 && mx <= width - 8 && Math.abs(my - orderY) < 14) {
            return { action: 'CANCEL_PENDING' as const, orderId: o.id };
          }

          // Quick "+TP" chip
          if (!o.tp && mx >= width - 68 && mx <= width - 40 && Math.abs(my - orderY) < 14) {
            return { action: 'ADD_PENDING_TP' as const, orderId: o.id };
          }

          // Quick "+SL" chip
          const slChipRight = !o.tp ? width - 72 : width - 40;
          if (!o.sl && mx >= slChipRight - 28 && mx <= slChipRight && Math.abs(my - orderY) < 14) {
            return { action: 'ADD_PENDING_SL' as const, orderId: o.id };
          }
        }

        // Cancel SL button on Pending SL Badge
        if (slY !== null && slY !== undefined && o.sl) {
          if (mx >= width - 36 && mx <= width - 8 && Math.abs(my - slY) < 14) {
            return { action: 'CLEAR_PENDING_SL' as const, orderId: o.id };
          }
        }

        // Cancel TP button on Pending TP Badge
        if (tpY !== null && tpY !== undefined && o.tp) {
          if (mx >= width - 36 && mx <= width - 8 && Math.abs(my - tpY) < 14) {
            return { action: 'CLEAR_PENDING_TP' as const, orderId: o.id };
          }
        }

        // Drag SL line
        if (slY !== null && slY !== undefined && o.sl) {
          if (Math.abs(my - slY) < 12) {
            return { action: 'DRAG' as const, type: 'PENDING_SL' as const, orderId: o.id };
          }
        }

        // Drag TP line
        if (tpY !== null && tpY !== undefined && o.tp) {
          if (Math.abs(my - tpY) < 12) {
            return { action: 'DRAG' as const, type: 'PENDING_TP' as const, orderId: o.id };
          }
        }

        // Drag Target Price line or pull SL/TP from target line
        if (orderY !== null && orderY !== undefined) {
          if (Math.abs(my - orderY) < 12) {
            return { action: 'DRAG' as const, type: 'PULL_PENDING' as const, orderId: o.id };
          }
        }
      }
    }

    return null;
  }, [activePosition, pendingOrders, mainSeries, width]);

  // ── HIT TESTING FUNCTION ──────────────────────────────────
  const hitTest = useCallback((mx: number, my: number): { drawingId: string; handleIdx: number | null } | null => {
    // Exclude right price scale (last 65px) and bottom time scale (last 28px) so user can drag scales to zoom
    if (mx > width - 65 || my > height - 28) {
      return null;
    }

    // 1. Check selected drawing handles first (highest priority)
    if (selectedDrawingId) {
      const selD = drawings.find((d) => d.id === selectedDrawingId);
      if (selD) {
        if ((selD.type === 'pos_long' || selD.type === 'pos_short') && selD.pts.length >= 3) {
          const pEntry = toXY(selD.pts[0].time, selD.pts[0].price);
          const pTP = toXY(selD.pts[1].time, selD.pts[1].price);
          const pSL = toXY(selD.pts[2].time, selD.pts[2].price);

          if (pEntry.x !== null && pEntry.y !== null && pTP.x !== null && pTP.y !== null && pSL.x !== null && pSL.y !== null) {
            const minX = Math.min(pEntry.x, pTP.x);
            const maxX = Math.max(pEntry.x, pTP.x);
            const grabMargin = 16;

            // 1. TP Top Handle & Top Edge (Handle 1)
            if (Math.abs(my - pTP.y) < grabMargin && mx >= minX - grabMargin && mx <= maxX + grabMargin) {
              return { drawingId: selD.id, handleIdx: 1 };
            }

            // 2. SL Bottom Handle & Bottom Edge (Handle 2)
            if (Math.abs(my - pSL.y) < grabMargin && mx >= minX - grabMargin && mx <= maxX + grabMargin) {
              return { drawingId: selD.id, handleIdx: 2 };
            }

            // 3. Right Edge Width Handle (Handle 5)
            if (Math.abs(mx - maxX) < grabMargin && my >= Math.min(pTP.y, pSL.y) - grabMargin && my <= Math.max(pTP.y, pSL.y) + grabMargin) {
              return { drawingId: selD.id, handleIdx: 5 };
            }

            // 4. Entry Line / Left Handle (Handle 0)
            if (Math.abs(my - pEntry.y) < 12 && mx >= minX - grabMargin && mx <= maxX + grabMargin) {
              return { drawingId: selD.id, handleIdx: 0 };
            }
          }
        } else {
          for (let i = 0; i < selD.pts.length; i++) {
            const xy = toXY(selD.pts[i].time, selD.pts[i].price);
            if (xy.x !== null && xy.y !== null && Math.hypot(mx - xy.x, my - xy.y) < 16) {
              return { drawingId: selD.id, handleIdx: i };
            }
          }
        }
      }
    }

    // 2. Check all drawings in reverse (topmost first)
    for (let i = drawings.length - 1; i >= 0; i--) {
      const d = drawings[i];
      if (d.hidden || d.pts.length === 0) continue;

      // Handle vertices (except for pos_long/pos_short handled below)
      if (d.type !== 'pos_long' && d.type !== 'pos_short') {
        for (let k = 0; k < d.pts.length; k++) {
          const xy = toXY(d.pts[k].time, d.pts[k].price);
          if (xy.x !== null && xy.y !== null && Math.hypot(mx - xy.x, my - xy.y) < 14) {
            return { drawingId: d.id, handleIdx: k };
          }
        }
      }

      // Trendline
      if (d.type === 'trendline' && d.pts.length >= 2) {
        const p0 = toXY(d.pts[0].time, d.pts[0].price);
        const p1 = toXY(d.pts[1].time, d.pts[1].price);
        if (p0.x !== null && p0.y !== null && p1.x !== null && p1.y !== null) {
          if (pointToSegmentDistance(mx, my, p0.x, p0.y, p1.x, p1.y) < 14) {
            return { drawingId: d.id, handleIdx: null };
          }
        }
      }

      // Channel: either rail, or anywhere inside the band.
      if (d.type === 'channel' && d.pts.length >= 2) {
        const rails = channelRails(d.pts);
        if (rails) {
          const a0 = toXY(rails.baseline[0].time, rails.baseline[0].price);
          const a1 = toXY(rails.baseline[1].time, rails.baseline[1].price);
          const b0 = toXY(rails.parallel[0].time, rails.parallel[0].price);
          const b1 = toXY(rails.parallel[1].time, rails.parallel[1].price);

          if (
            a0.x !== null && a0.y !== null && a1.x !== null && a1.y !== null &&
            b0.x !== null && b0.y !== null && b1.x !== null && b1.y !== null
          ) {
            const onRail =
              pointToSegmentDistance(mx, my, a0.x, a0.y, a1.x, a1.y) < 14 ||
              pointToSegmentDistance(mx, my, b0.x, b0.y, b1.x, b1.y) < 14;
            const inside = isPointInPolygon(mx, my, [
              { x: a0.x, y: a0.y },
              { x: a1.x, y: a1.y },
              { x: b1.x, y: b1.y },
              { x: b0.x, y: b0.y },
            ]);
            if (onRail || inside) return { drawingId: d.id, handleIdx: null };
          }
        }
      }

      // Ray
      if (d.type === 'ray' && d.pts.length >= 2) {
        const p0 = toXY(d.pts[0].time, d.pts[0].price);
        const p1 = toXY(d.pts[1].time, d.pts[1].price);
        if (p0.x !== null && p0.y !== null && p1.x !== null && p1.y !== null) {
          if (pointToRayDistance(mx, my, p0.x, p0.y, p1.x, p1.y) < 14) {
            return { drawingId: d.id, handleIdx: null };
          }
        }
      }

      // Horizontal Line
      if (d.type === 'hline' && d.pts.length >= 1) {
        const p = toXY(d.pts[0].time, d.pts[0].price);
        if (p.y !== null && Math.abs(my - p.y) < 14) {
          return { drawingId: d.id, handleIdx: null };
        }
      }

      // Vertical Line
      if (d.type === 'vline' && d.pts.length >= 1) {
        const p = toXY(d.pts[0].time, d.pts[0].price);
        if (p.x !== null && Math.abs(mx - p.x) < 14) {
          return { drawingId: d.id, handleIdx: null };
        }
      }

      // Rectangle
      if (d.type === 'rect' && d.pts.length >= 2) {
        const p0 = toXY(d.pts[0].time, d.pts[0].price);
        const p1 = toXY(d.pts[1].time, d.pts[1].price);
        if (p0.x !== null && p0.y !== null && p1.x !== null && p1.y !== null) {
          if (isPointInRect(mx, my, p0.x, p0.y, p1.x, p1.y, 10)) {
            return { drawingId: d.id, handleIdx: null };
          }
        }
      }

      // Position Long / Short (Generous grab areas for TP, SL, Edges and Body)
      if ((d.type === 'pos_long' || d.type === 'pos_short') && d.pts.length >= 3) {
        const pEntry = toXY(d.pts[0].time, d.pts[0].price);
        const pTP = toXY(d.pts[1].time, d.pts[1].price);
        const pSL = toXY(d.pts[2].time, d.pts[2].price);
        if (pEntry.x !== null && pEntry.y !== null && pTP.x !== null && pTP.y !== null && pSL.x !== null && pSL.y !== null) {
          const minX = Math.min(pEntry.x, pTP.x);
          const maxX = Math.max(pEntry.x, pTP.x);
          const minY = Math.min(pEntry.y, pTP.y, pSL.y);
          const maxY = Math.max(pEntry.y, pTP.y, pSL.y);
          const grabMargin = 16;

          // 1. Check TP top handle & edge (Handle 1)
          if (Math.abs(my - pTP.y) < grabMargin && mx >= minX - grabMargin && mx <= maxX + grabMargin) {
            return { drawingId: d.id, handleIdx: 1 };
          }

          // 2. Check SL bottom handle & edge (Handle 2)
          if (Math.abs(my - pSL.y) < grabMargin && mx >= minX - grabMargin && mx <= maxX + grabMargin) {
            return { drawingId: d.id, handleIdx: 2 };
          }

          // 3. Check Right edge width (Handle 5)
          if (Math.abs(mx - maxX) < grabMargin && my >= minY - grabMargin && my <= maxY + grabMargin) {
            return { drawingId: d.id, handleIdx: 5 };
          }

          // 4. Check Entry line (Handle 0)
          if (Math.abs(my - pEntry.y) < 12 && mx >= minX - grabMargin && mx <= maxX + grabMargin) {
            return { drawingId: d.id, handleIdx: 0 };
          }

          // 5. Check Body (inside green/red box) -> Move entire position
          if (mx >= minX - 4 && mx <= maxX + 4 && my >= minY - 4 && my <= maxY + 4) {
            return { drawingId: d.id, handleIdx: null };
          }
        }
      }

      // Fibonacci
      if (d.type === 'fib' && d.pts.length >= 2) {
        const p0 = toXY(d.pts[0].time, d.pts[0].price);
        const p1 = toXY(d.pts[1].time, d.pts[1].price);
        if (p0.x !== null && p0.y !== null && p1.x !== null && p1.y !== null) {
          const minX = Math.min(p0.x, p1.x) - 10;
          const maxX = Math.max(p0.x, p1.x) + 10;
          if (mx >= minX && mx <= maxX) {
            const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0];
            const dy = p1.y - p0.y;
            for (const lvl of levels) {
              const ly = p0.y + dy * lvl;
              if (Math.abs(my - ly) < 12) return { drawingId: d.id, handleIdx: null };
            }
          }
        }
      }

      // Text
      if (d.type === 'text' && d.pts.length >= 1) {
        const p = toXY(d.pts[0].time, d.pts[0].price);
        if (p.x !== null && p.y !== null && Math.hypot(mx - p.x, my - p.y) < 25) {
          return { drawingId: d.id, handleIdx: null };
        }
      }
    }

    return null;
  }, [drawings, selectedDrawingId, toXY, width, height]);

  // ── DRAWING CANVAS REDRAW ─────────────────────────────────
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !chart || !mainSeries) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // ── 0. CALCULATE VISIBLE CANDLE RANGE ───────────────────
    let startIdx = 1;
    let endIdx = displayCandles.length - 1;
    if (chart && displayCandles.length > 0) {
      const visibleRange = chart.timeScale().getVisibleRange();
      if (visibleRange && typeof visibleRange.from === 'number' && typeof visibleRange.to === 'number') {
        const fromT = visibleRange.from;
        const toT = visibleRange.to;
        let l = 0, r = displayCandles.length - 1;
        while (l <= r) {
          const mid = (l + r) >> 1;
          if (displayCandles[mid].time < fromT) l = mid + 1;
          else r = mid - 1;
        }
        startIdx = Math.max(1, l - 5);

        l = 0; r = displayCandles.length - 1;
        while (l <= r) {
          const mid = (l + r) >> 1;
          if (displayCandles[mid].time <= toT) l = mid + 1;
          else r = mid - 1;
        }
        endIdx = Math.min(displayCandles.length - 1, l + 5);
      }
    }

    // ── 1. RENDER PERIOD SEPARATORS ─────────────────────────
    if (separatorTF && displayCandles.length > 1) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
      ctx.lineWidth = 1 * dpr;
      ctx.setLineDash([4 * dpr, 4 * dpr]);

      for (let i = startIdx; i <= endIdx; i++) {
        const prev = displayCandles[i - 1];
        const curr = displayCandles[i];
        const d0 = new Date(prev.time * 1000);
        const d1 = new Date(curr.time * 1000);

        let isBoundary = false;
        let label = '';

        if (separatorTF === '1D') {
          isBoundary = d1.getUTCDate() !== d0.getUTCDate() || curr.time - prev.time >= 86400;
          label = d1.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
        } else if (separatorTF === '1W') {
          isBoundary = d1.getUTCDay() < d0.getUTCDay() || curr.time - prev.time >= 604800;
          label = `Semaine ${d1.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`;
        } else if (separatorTF === '1M') {
          isBoundary = d1.getUTCMonth() !== d0.getUTCMonth() || curr.time - prev.time >= 2592000;
          label = d1.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
        } else if (separatorTF === '1Y') {
          isBoundary = d1.getUTCFullYear() !== d0.getUTCFullYear();
          label = `${d1.getUTCFullYear()}`;
        }

        if (isBoundary) {
          const p = toXY(curr.time, curr.close);
          if (p.x !== null && p.x >= 0 && p.x <= width) {
            ctx.beginPath();
            ctx.moveTo(p.x * dpr, 0);
            ctx.lineTo(p.x * dpr, height * dpr);
            ctx.stroke();

            ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
            ctx.font = `bold ${9 * dpr}px JetBrains Mono, monospace`;
            ctx.fillText(label, (p.x + 4) * dpr, (height - 8) * dpr);
          }
        }
      }
      ctx.restore();
    }

    // ── 2. RENDER FOREX / TRADING SESSIONS & KILLZONES ──────────
    const isAnySessionActive =
      forexSessions &&
      (forexSessions.london ||
        forexSessions.newyork ||
        forexSessions.tokyo ||
        forexSessions.sydney ||
        forexSessions.asianRange ||
        forexSessions.londonOpenKZ ||
        forexSessions.nyOpenKZ ||
        forexSessions.londonCloseKZ);

    // Les séances n'ont de sens qu'en intraday : une bougie journalière couvre
    // Tokyo, Londres et New York à la fois. Même seuil que le menu de la barre
    // supérieure, qui grise les options en conséquence.
    const sampleDt =
      displayCandles.length >= 2
        ? Math.abs(displayCandles[1].time - displayCandles[0].time)
        : (activeTF || baseTF || TimeframeSeconds.D1);
    const isIntraday = supportsSessions(sampleDt) && supportsSessions(activeTF || TimeframeSeconds.D1);

    if (isAnySessionActive && isIntraday) {
      ctx.save();
      const barSpacing = getBarSpacingPx();
      const useLocal = Boolean(forexSessions.useLocalTz);

      const activeSessDefs = ALL_SESSIONS.filter((s) => Boolean((forexSessions as any)[s.key]));

      /**
       * Étiquettes différées.
       *
       * Chaque séance peint son ombrage sur toute la hauteur avant que la
       * suivante ne dessine les siennes : avec plusieurs séances actives, les
       * badges des premières finissaient enfouis sous les couches d'ombrage des
       * suivantes. On les collecte ici et on les peint une fois toutes les
       * séances rendues.
       */
      const pendingBadges: {
        x: number;
        y: number;
        width: number;
        text: string;
        color: string;
      }[] = [];

      for (const sess of activeSessDefs) {
        let blockStartIdx: number | null = null;
        let blockHigh = -Infinity;
        let blockLow = Infinity;
        let blockStartX = 0;
        let blockEndX = 0;

        const sIdx = Math.max(0, startIdx - 2);
        const eIdx = Math.min(displayCandles.length - 1, endIdx + 2);


        for (let i = sIdx; i <= eIdx; i++) {
          const c = displayCandles[i];
          if (!c) continue;

          const inSess = isCandleInSession(c, sess, useLocal);

          if (inSess) {
            const p = toXY(c.time, c.close);
            if (p.x !== null) {
              if (blockStartIdx === null) {
                blockStartIdx = i;
                blockHigh = c.high;
                blockLow = c.low;
                blockStartX = p.x - barSpacing * 0.5;
                blockEndX = p.x + barSpacing * 0.5;
              } else {
                blockHigh = Math.max(blockHigh, c.high);
                blockLow = Math.min(blockLow, c.low);
                blockEndX = p.x + barSpacing * 0.5;
              }

              // Subtle background column slice
              if (p.x >= -barSpacing && p.x <= width + barSpacing) {
                ctx.fillStyle = sess.color;
                ctx.fillRect((p.x - barSpacing * 0.5) * dpr, 0, barSpacing * dpr, height * dpr);
              }
            }
          }

          // Check if session block ends: candle outside session, day gap > 3h, or end of loop
          const nextCandle = displayCandles[i + 1];
          const nextInSess = nextCandle ? isCandleInSession(nextCandle, sess, useLocal) : false;
          const isSameDay = nextCandle && c ? isSameTradingDay(c.time, nextCandle.time, sess, useLocal) : false;

          const shouldCloseBlock = blockStartIdx !== null && (!nextInSess || !isSameDay || i === eIdx);

          if (shouldCloseBlock) {
            // Draw Session Box bounded between High and Low
            if (forexSessions.showHighLow !== false && blockHigh > -Infinity && blockLow < Infinity && mainSeries) {
              const yHigh = mainSeries.priceToCoordinate(blockHigh);
              const yLow = mainSeries.priceToCoordinate(blockLow);

              if (yHigh !== null && yHigh !== undefined && yLow !== null && yLow !== undefined) {
                const boxTop = Math.min(yHigh, yLow);
                const boxBottom = Math.max(yHigh, yLow);
                const boxHeight = Math.max(2, boxBottom - boxTop);
                const boxWidth = Math.max(2, blockEndX - blockStartX);

                // Soft shaded box over price action of session
                ctx.fillStyle = sess.color.replace('0.06', '0.12').replace('0.08', '0.14');
                ctx.fillRect(blockStartX * dpr, boxTop * dpr, boxWidth * dpr, boxHeight * dpr);

                // High dashed line
                ctx.strokeStyle = sess.textColor;
                ctx.lineWidth = 1 * dpr;
                ctx.setLineDash([3 * dpr, 3 * dpr]);
                ctx.beginPath();
                ctx.moveTo(blockStartX * dpr, boxTop * dpr);
                ctx.lineTo(blockEndX * dpr, boxTop * dpr);
                ctx.stroke();

                // Low dashed line
                ctx.beginPath();
                ctx.moveTo(blockStartX * dpr, boxBottom * dpr);
                ctx.lineTo(blockEndX * dpr, boxBottom * dpr);
                ctx.stroke();

                ctx.setLineDash([]);

                // High / Low labels
                ctx.fillStyle = sess.textColor;
                ctx.font = `600 ${8 * dpr}px JetBrains Mono, monospace`;
                // Killzones et séances majeures se recouvrent (London KZ 7-10h
                // vit dans Londres 8-17h) : sans décalage, leurs deux jeux
                // d'étiquettes se superposaient et devenaient illisibles.
                const labelDy = sess.isKillzone ? 11 * dpr : 3 * dpr;
                ctx.fillText(`H: ${blockHigh.toFixed(instrument.decimals)}`, (blockEndX + 3) * dpr, boxTop * dpr + labelDy);
                ctx.fillText(`L: ${blockLow.toFixed(instrument.decimals)}`, (blockEndX + 3) * dpr, boxBottom * dpr + labelDy);
              }
            }

            // Draw Session Badge label at top
            // Le badge suit le bloc dès qu'il *croise* la vue. Le tester sur son
            // seul point de départ le faisait disparaître dès qu'on faisait
            // défiler au-delà du début de la séance — pourtant bien visible.
            const blockIntersectsView = blockEndX >= 0 && blockStartX <= width;
            // Dézoomé, un bloc de séance fait quelques pixels : afficher son
            // étiquette empilerait des dizaines de pastilles illisibles.
            const blockIsLegible = blockEndX - blockStartX >= MIN_SESSION_LABEL_WIDTH;

            if (forexSessions.showLabels !== false && blockIntersectsView && blockIsLegible) {
              const tagY = sess.isKillzone ? 22 * dpr : 5 * dpr;
              const textStr = `${sess.name} ${sess.startHour}h-${sess.endHour}h`;

              ctx.font = `bold ${8 * dpr}px JetBrains Mono, monospace`;
              const pillW = ctx.measureText(textStr).width + 12 * dpr;
              // Caler l'étiquette dans la partie visible du bloc, sans jamais
              // déborder de la zone de dessin.
              const pillWidthCss = pillW / dpr;
              const minX = Math.max(4, blockStartX);
              const maxX = Math.min(blockEndX - pillWidthCss, width - pillWidthCss - 4);
              const tagX = maxX > minX ? minX : Math.max(4, maxX);

              pendingBadges.push({
                x: tagX,
                y: tagY,
                width: pillWidthCss,
                text: textStr,
                color: sess.textColor,
              });
            }

            // Reset block
            blockStartIdx = null;
            blockHigh = -Infinity;
            blockLow = Infinity;
          }
        }

      }

      // Étiquettes en dernier, au-dessus de tous les ombrages. Une pastille qui
      // en recouvrirait une autre sur la même ligne est omise : empilées, elles
      // deviennent illisibles quand plusieurs séances se chevauchent.
      const occupiedRows = new Map<number, { from: number; to: number }[]>();
      const BADGE_GAP = 4;

      ctx.font = `bold ${8 * dpr}px JetBrains Mono, monospace`;
      for (const badge of pendingBadges) {
        const taken = occupiedRows.get(badge.y) ?? [];
        const overlaps = taken.some(
          (slot) => badge.x < slot.to + BADGE_GAP && badge.x + badge.width + BADGE_GAP > slot.from
        );
        if (overlaps) continue;

        taken.push({ from: badge.x, to: badge.x + badge.width });
        occupiedRows.set(badge.y, taken);

        const pillW = badge.width * dpr;
        const pillH = 14 * dpr;

        ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
        ctx.strokeStyle = badge.color;
        ctx.lineWidth = 1 * dpr;
        ctx.beginPath();
        ctx.roundRect(badge.x * dpr, badge.y, pillW, pillH, 3 * dpr);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = badge.color;
        ctx.fillText(badge.text, (badge.x + 6) * dpr, badge.y + 10 * dpr);
      }

      ctx.restore();
    }

    // ── 3. RENDER ACTIVE POSITION ON CHART ──────────────────
    if (activePosition && mainSeries) {
      ctx.save();
      const isLong = activePosition.type === 'LONG';
      const dec = instrument.decimals;
      const pip = instrument.pip;
      const entryY = mainSeries.priceToCoordinate(activePosition.entry);
      const slY = activePosition.sl ? mainSeries.priceToCoordinate(activePosition.sl) : null;
      const tpY = activePosition.tp ? mainSeries.priceToCoordinate(activePosition.tp) : null;

      if (entryY !== null && entryY !== undefined) {
        ctx.strokeStyle = isLong ? '#00C46E' : '#F43F5E';
        ctx.lineWidth = 1.5 * dpr;
        ctx.setLineDash([6 * dpr, 3 * dpr]);
        ctx.beginPath();
        ctx.moveTo(0, entryY * dpr);
        ctx.lineTo(width * dpr, entryY * dpr);
        ctx.stroke();

        // Main Entry Badge
        const hasNoSl = !activePosition.sl;
        const hasNoTp = !activePosition.tp;
        const bw = 175 + (hasNoSl ? 34 : 0) + (hasNoTp ? 34 : 0);
        const bx = width - bw - 10;
        const by = entryY - 11;
        ctx.fillStyle = isLong ? 'rgba(0, 196, 110, 0.95)' : 'rgba(244, 63, 94, 0.95)';
        ctx.fillRect(bx * dpr, by * dpr, bw * dpr, 22 * dpr);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 1 * dpr;
        ctx.strokeRect(bx * dpr, by * dpr, bw * dpr, 22 * dpr);

        ctx.fillStyle = '#0B0E14';
        ctx.font = `bold ${9.5 * dpr}px JetBrains Mono, monospace`;
        // `size` is in base-asset units (see `types/trading`), so printing it
        // with an "L" suffix announced 100 000 L for a one-lot EUR/USD position.
        const lots = unitsToLots(activePosition.symbol ?? currentSymbol, activePosition.size);
        ctx.fillText(`${isLong ? '▲ ACHAT' : '▼ VENTE'} ${lots.toFixed(2)} L @ ${activePosition.entry.toFixed(dec)}`, (bx + 6) * dpr, (entryY + 4) * dpr);

        let chipOffset = 36;
        // Close Button [✕] inside badge
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect((width - chipOffset) * dpr, (by + 2) * dpr, 18 * dpr, 18 * dpr);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = `bold ${11 * dpr}px sans-serif`;
        ctx.fillText('✕', (width - chipOffset + 5) * dpr, (entryY + 4) * dpr);

        // Optional "+TP" button chip if no TP
        if (hasNoTp) {
          chipOffset += 32;
          ctx.fillStyle = 'rgba(0, 196, 110, 0.45)';
          ctx.fillRect((width - chipOffset) * dpr, (by + 2) * dpr, 28 * dpr, 18 * dpr);
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 0.8 * dpr;
          ctx.strokeRect((width - chipOffset) * dpr, (by + 2) * dpr, 28 * dpr, 18 * dpr);
          ctx.fillStyle = '#FFFFFF';
          ctx.font = `bold ${8.5 * dpr}px JetBrains Mono, monospace`;
          ctx.fillText('+TP', (width - chipOffset + 4) * dpr, (entryY + 4) * dpr);
        }

        // Optional "+SL" button chip if no SL
        if (hasNoSl) {
          chipOffset += 32;
          ctx.fillStyle = 'rgba(244, 63, 94, 0.45)';
          ctx.fillRect((width - chipOffset) * dpr, (by + 2) * dpr, 28 * dpr, 18 * dpr);
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 0.8 * dpr;
          ctx.strokeRect((width - chipOffset) * dpr, (by + 2) * dpr, 28 * dpr, 18 * dpr);
          ctx.fillStyle = '#FFFFFF';
          ctx.font = `bold ${8.5 * dpr}px JetBrains Mono, monospace`;
          ctx.fillText('+SL', (width - chipOffset + 4) * dpr, (entryY + 4) * dpr);
        }
      }

      if (slY !== null && slY !== undefined && activePosition.sl) {
        ctx.strokeStyle = '#F43F5E';
        ctx.lineWidth = 1.5 * dpr;
        ctx.setLineDash([4 * dpr, 3 * dpr]);
        ctx.beginPath();
        ctx.moveTo(0, slY * dpr);
        ctx.lineTo(width * dpr, slY * dpr);
        ctx.stroke();

        const slPips = Math.abs(activePosition.entry - activePosition.sl) / pip;
        const bw = 150;
        const bx = width - bw - 10;
        const by = slY - 11;
        ctx.fillStyle = 'rgba(244, 63, 94, 0.92)';
        ctx.fillRect(bx * dpr, by * dpr, bw * dpr, 22 * dpr);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 1 * dpr;
        ctx.strokeRect(bx * dpr, by * dpr, bw * dpr, 22 * dpr);

        ctx.fillStyle = '#FFFFFF';
        ctx.font = `bold ${9.5 * dpr}px JetBrains Mono, monospace`;
        ctx.fillText(`🛑 SL: ${activePosition.sl.toFixed(dec)} (-${slPips.toFixed(1)}p)`, (bx + 6) * dpr, (slY + 4) * dpr);

        // Clear SL Button [✕]
        ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
        ctx.fillRect((width - 32) * dpr, (by + 2) * dpr, 18 * dpr, 18 * dpr);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = `bold ${11 * dpr}px sans-serif`;
        ctx.fillText('✕', (width - 27) * dpr, (slY + 4) * dpr);
      }

      if (tpY !== null && tpY !== undefined && activePosition.tp) {
        ctx.strokeStyle = '#00C46E';
        ctx.lineWidth = 1.5 * dpr;
        ctx.setLineDash([4 * dpr, 3 * dpr]);
        ctx.beginPath();
        ctx.moveTo(0, tpY * dpr);
        ctx.lineTo(width * dpr, tpY * dpr);
        ctx.stroke();

        const tpPips = Math.abs(activePosition.tp - activePosition.entry) / pip;
        const bw = 150;
        const bx = width - bw - 10;
        const by = tpY - 11;
        ctx.fillStyle = 'rgba(0, 196, 110, 0.92)';
        ctx.fillRect(bx * dpr, by * dpr, bw * dpr, 22 * dpr);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 1 * dpr;
        ctx.strokeRect(bx * dpr, by * dpr, bw * dpr, 22 * dpr);

        ctx.fillStyle = '#0B0E14';
        ctx.font = `bold ${9.5 * dpr}px JetBrains Mono, monospace`;
        ctx.fillText(`🎯 TP: ${activePosition.tp.toFixed(dec)} (+${tpPips.toFixed(1)}p)`, (bx + 6) * dpr, (tpY + 4) * dpr);

        // Clear TP Button [✕]
        ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
        ctx.fillRect((width - 32) * dpr, (by + 2) * dpr, 18 * dpr, 18 * dpr);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = `bold ${11 * dpr}px sans-serif`;
        ctx.fillText('✕', (width - 27) * dpr, (tpY + 4) * dpr);
      }
      ctx.restore();
    }

    // ── 3.2. RENDER PENDING ORDERS ON CHART ──────────────────
    if (pendingOrders && pendingOrders.length > 0 && mainSeries) {
      ctx.save();
      for (const order of pendingOrders) {
        const isLong = order.type === 'LONG';
        const dec = instrument.decimals;
        const pip = instrument.pip;
        const orderY = mainSeries.priceToCoordinate(order.targetPrice);
        const slY = order.sl ? mainSeries.priceToCoordinate(order.sl) : null;
        const tpY = order.tp ? mainSeries.priceToCoordinate(order.tp) : null;

        if (orderY !== null && orderY !== undefined) {
          ctx.strokeStyle = '#38BDF8';
          ctx.lineWidth = 1.5 * dpr;
          ctx.setLineDash([5 * dpr, 4 * dpr]);
          ctx.beginPath();
          ctx.moveTo(0, orderY * dpr);
          ctx.lineTo(width * dpr, orderY * dpr);
          ctx.stroke();

          const hasNoSl = !order.sl;
          const hasNoTp = !order.tp;
          const bw = 185 + (hasNoSl ? 34 : 0) + (hasNoTp ? 34 : 0);
          const bx = width - bw - 10;
          const by = orderY - 11;
          ctx.fillStyle = '#0284C7';
          ctx.fillRect(bx * dpr, by * dpr, bw * dpr, 22 * dpr);
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
          ctx.lineWidth = 1 * dpr;
          ctx.strokeRect(bx * dpr, by * dpr, bw * dpr, 22 * dpr);

          ctx.fillStyle = '#FFFFFF';
          ctx.font = `bold ${9.5 * dpr}px JetBrains Mono, monospace`;
          ctx.fillText(`${isLong ? 'Achat' : 'Vente'} ${order.orderType === 'LIMIT' ? 'limite' : 'stop'} · ${order.targetPrice.toFixed(dec)}`, (bx + 6) * dpr, (orderY + 4) * dpr);

          let chipOffset = 36;
          // Cancel Button [✕]
          ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
          ctx.fillRect((width - chipOffset) * dpr, (by + 2) * dpr, 18 * dpr, 18 * dpr);
          ctx.fillStyle = '#FFFFFF';
          ctx.font = `bold ${11 * dpr}px sans-serif`;
          ctx.fillText('✕', (width - chipOffset + 5) * dpr, (orderY + 4) * dpr);

          if (hasNoTp) {
            chipOffset += 32;
            ctx.fillStyle = 'rgba(0, 196, 110, 0.45)';
            ctx.fillRect((width - chipOffset) * dpr, (by + 2) * dpr, 28 * dpr, 18 * dpr);
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = 0.8 * dpr;
            ctx.strokeRect((width - chipOffset) * dpr, (by + 2) * dpr, 28 * dpr, 18 * dpr);
            ctx.fillStyle = '#FFFFFF';
            ctx.font = `bold ${8.5 * dpr}px JetBrains Mono, monospace`;
            ctx.fillText('+TP', (width - chipOffset + 4) * dpr, (orderY + 4) * dpr);
          }

          if (hasNoSl) {
            chipOffset += 32;
            ctx.fillStyle = 'rgba(244, 63, 94, 0.45)';
            ctx.fillRect((width - chipOffset) * dpr, (by + 2) * dpr, 28 * dpr, 18 * dpr);
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = 0.8 * dpr;
            ctx.strokeRect((width - chipOffset) * dpr, (by + 2) * dpr, 28 * dpr, 18 * dpr);
            ctx.fillStyle = '#FFFFFF';
            ctx.font = `bold ${8.5 * dpr}px JetBrains Mono, monospace`;
            ctx.fillText('+SL', (width - chipOffset + 4) * dpr, (orderY + 4) * dpr);
          }
        }

        if (slY !== null && slY !== undefined && order.sl) {
          ctx.strokeStyle = '#F43F5E';
          ctx.lineWidth = 1.2 * dpr;
          ctx.setLineDash([3 * dpr, 3 * dpr]);
          ctx.beginPath();
          ctx.moveTo(0, slY * dpr);
          ctx.lineTo(width * dpr, slY * dpr);
          ctx.stroke();

          const slPips = Math.abs(order.targetPrice - order.sl) / pip;
          const bw = 140;
          const bx = width - bw - 10;
          const by = slY - 11;
          ctx.fillStyle = 'rgba(244, 63, 94, 0.88)';
          ctx.fillRect(bx * dpr, by * dpr, bw * dpr, 20 * dpr);
          ctx.fillStyle = '#FFFFFF';
          ctx.font = `bold ${9 * dpr}px JetBrains Mono, monospace`;
          ctx.fillText(`🛑 SL: ${order.sl.toFixed(dec)} (-${slPips.toFixed(1)}p)`, (bx + 6) * dpr, (slY + 3) * dpr);

          // Cancel SL [✕]
          ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
          ctx.fillRect((width - 30) * dpr, (by + 2) * dpr, 16 * dpr, 16 * dpr);
          ctx.fillStyle = '#FFFFFF';
          ctx.font = `bold ${10 * dpr}px sans-serif`;
          ctx.fillText('✕', (width - 26) * dpr, (slY + 3) * dpr);
        }

        if (tpY !== null && tpY !== undefined && order.tp) {
          ctx.strokeStyle = '#00C46E';
          ctx.lineWidth = 1.2 * dpr;
          ctx.setLineDash([3 * dpr, 3 * dpr]);
          ctx.beginPath();
          ctx.moveTo(0, tpY * dpr);
          ctx.lineTo(width * dpr, tpY * dpr);
          ctx.stroke();

          const tpPips = Math.abs(order.tp - order.targetPrice) / pip;
          const bw = 140;
          const bx = width - bw - 10;
          const by = tpY - 11;
          ctx.fillStyle = 'rgba(0, 196, 110, 0.88)';
          ctx.fillRect(bx * dpr, by * dpr, bw * dpr, 20 * dpr);
          ctx.fillStyle = '#0B0E14';
          ctx.font = `bold ${9 * dpr}px JetBrains Mono, monospace`;
          ctx.fillText(`🎯 TP: ${order.tp.toFixed(dec)} (+${tpPips.toFixed(1)}p)`, (bx + 6) * dpr, (tpY + 3) * dpr);

          // Cancel TP [✕]
          ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
          ctx.fillRect((width - 30) * dpr, (by + 2) * dpr, 16 * dpr, 16 * dpr);
          ctx.fillStyle = '#FFFFFF';
          ctx.font = `bold ${10 * dpr}px sans-serif`;
          ctx.fillText('✕', (width - 26) * dpr, (tpY + 3) * dpr);
        }
      }
      ctx.restore();
    }

    // ── 3.5. RENDER VOLUME & OSCILLATOR SECTIONS ────────────
    const rsiInd = activeIndicators.find((i) => i.type === 'RSI');
    const macdInd = activeIndicators.find((i) => i.type === 'MACD');
    const hasOscillator = Boolean(rsiInd || macdInd);

    // Oscillator Section divider (if active)
    if (hasOscillator) {
      const oscTopY = height * 0.785;

      // Dark background for oscillator pane
      ctx.fillStyle = 'rgba(11, 14, 20, 0.55)';
      ctx.fillRect(0, oscTopY * dpr, width * dpr, (height - oscTopY) * dpr);

      // Dividing line
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath();
      ctx.moveTo(0, oscTopY * dpr);
      ctx.lineTo(width * dpr, oscTopY * dpr);
      ctx.stroke();

      // Title badge
      const label = rsiInd ? `RSI (${rsiInd.period || 14})` : `MACD (${macdInd?.period || 12}, 26)`;
      const badgeColor = rsiInd ? '#A78BFA' : '#3B82F6';

      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.fillRect(8 * dpr, (oscTopY + 3) * dpr, 68 * dpr, 14 * dpr);
      ctx.strokeStyle = badgeColor;
      ctx.lineWidth = 1 * dpr;
      ctx.strokeRect(8 * dpr, (oscTopY + 3) * dpr, 68 * dpr, 14 * dpr);

      ctx.fillStyle = badgeColor;
      ctx.font = `bold ${8.5 * dpr}px JetBrains Mono, monospace`;
      ctx.fillText(label, 12 * dpr, (oscTopY + 13) * dpr);
    }
    ctx.restore();

    // ── 4. RENDER DRAWINGS ───────────────────────────────────
    drawings.forEach((d) => {
      if (d.hidden) return;
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
      } else if (d.type === 'channel' && d.pts.length >= 2) {
        // Parallel channel: baseline, a rail offset by a constant *price*
        // distance, the band between them, and a dashed median.
        const rails = channelRails(d.pts);
        if (rails) {
          const a0 = toXY(rails.baseline[0].time, rails.baseline[0].price);
          const a1 = toXY(rails.baseline[1].time, rails.baseline[1].price);
          const b0 = toXY(rails.parallel[0].time, rails.parallel[0].price);
          const b1 = toXY(rails.parallel[1].time, rails.parallel[1].price);

          const hasAll =
            a0.x !== null && a0.y !== null && a1.x !== null && a1.y !== null &&
            b0.x !== null && b0.y !== null && b1.x !== null && b1.y !== null;

          if (hasAll) {
            const ax0 = a0.x! * dpr, ay0 = a0.y! * dpr;
            const ax1 = a1.x! * dpr, ay1 = a1.y! * dpr;
            const bx0 = b0.x! * dpr, by0 = b0.y! * dpr;
            const bx1 = b1.x! * dpr, by1 = b1.y! * dpr;

            ctx.beginPath();
            ctx.moveTo(ax0, ay0);
            ctx.lineTo(ax1, ay1);
            ctx.lineTo(bx1, by1);
            ctx.lineTo(bx0, by0);
            ctx.closePath();
            ctx.fillStyle = d.style.fill || 'rgba(59, 130, 246, 0.12)';
            ctx.fill();

            ctx.beginPath();
            ctx.moveTo(ax0, ay0);
            ctx.lineTo(ax1, ay1);
            ctx.moveTo(bx0, by0);
            ctx.lineTo(bx1, by1);
            ctx.stroke();

            ctx.save();
            ctx.setLineDash([5 * dpr, 5 * dpr]);
            ctx.globalAlpha = 0.55;
            ctx.lineWidth = Math.max(1, (d.style.width || 2) * 0.6) * dpr;
            ctx.beginPath();
            ctx.moveTo((ax0 + bx0) / 2, (ay0 + by0) / 2);
            ctx.lineTo((ax1 + bx1) / 2, (ay1 + by1) / 2);
            ctx.stroke();
            ctx.restore();
          }
        }
      } else if (d.type === 'ray' && d.pts.length >= 2) {
        const p0 = toXY(d.pts[0].time, d.pts[0].price);
        const p1 = toXY(d.pts[1].time, d.pts[1].price);
        if (p0.x !== null && p0.y !== null && p1.x !== null && p1.y !== null) {
          const dx = p1.x - p0.x;
          const dy = p1.y - p0.y;
          const extX = p0.x + dx * 50;
          const extY = p0.y + dy * 50;
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

          ctx.fillStyle = d.style.color || '#3B82F6';
          ctx.font = `bold ${10 * dpr}px JetBrains Mono, monospace`;
          // `toFixed(5)` printed an hline on gold as "2451.32000"; every other
          // label in this file already uses the instrument's own precision.
          ctx.fillText(d.pts[0].price.toFixed(instrument.decimals), (width - 70) * dpr, (p.y - 4) * dpr);
        }
      } else if (d.type === 'vline' && d.pts.length >= 1) {
        const p = toXY(d.pts[0].time, d.pts[0].price);
        if (p.x !== null) {
          ctx.beginPath();
          ctx.moveTo(p.x * dpr, 0);
          ctx.lineTo(p.x * dpr, height * dpr);
          ctx.stroke();

          const dObj = new Date(d.pts[0].time * 1000);
          const tLabel = dObj.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
          ctx.fillStyle = d.style.color || '#3B82F6';
          ctx.font = `bold ${9 * dpr}px JetBrains Mono, monospace`;
          ctx.fillText(tLabel, (p.x + 4) * dpr, 20 * dpr);
        }
      } else if (d.type === 'rect' && d.pts.length >= 2) {
        const p0 = toXY(d.pts[0].time, d.pts[0].price);
        const p1 = toXY(d.pts[1].time, d.pts[1].price);
        if (p0.x !== null && p0.y !== null && p1.x !== null && p1.y !== null) {
          const rx = Math.min(p0.x, p1.x) * dpr;
          const ry = Math.min(p0.y, p1.y) * dpr;
          const rw = Math.abs(p1.x - p0.x) * dpr;
          const rh = Math.abs(p1.y - p0.y) * dpr;

          ctx.fillStyle = d.style.fill || 'rgba(59, 130, 246, 0.12)';
          ctx.fillRect(rx, ry, rw, rh);
          ctx.strokeRect(rx, ry, rw, rh);
        }
      } else if (d.type === 'fib' && d.pts.length >= 2) {
        const p0 = toXY(d.pts[0].time, d.pts[0].price);
        const p1 = toXY(d.pts[1].time, d.pts[1].price);
        if (p0.x !== null && p0.y !== null && p1.x !== null && p1.y !== null) {
          const levels = [
            { lvl: 0, label: '0.0%', color: '#94A3B8', fill: 'rgba(148, 163, 184, 0.04)' },
            { lvl: 0.236, label: '23.6%', color: '#F43F5E', fill: 'rgba(244, 63, 94, 0.05)' },
            { lvl: 0.382, label: '38.2%', color: '#F59E0B', fill: 'rgba(245, 158, 11, 0.06)' },
            { lvl: 0.5, label: '50.0%', color: '#10B981', fill: 'rgba(16, 185, 129, 0.07)' },
            { lvl: 0.618, label: '61.8% (Golden)', color: '#EAB308', fill: 'rgba(234, 179, 8, 0.10)' },
            { lvl: 0.786, label: '78.6%', color: '#8B5CF6', fill: 'rgba(139, 92, 246, 0.05)' },
            { lvl: 1.0, label: '100.0%', color: '#3B82F6', fill: 'transparent' },
          ];

          const p0y = p0.y;
          const dy = p1.y - p0.y;
          const minX = Math.min(p0.x, p1.x) * dpr;
          const maxX = Math.max(p0.x, p1.x) * dpr;
          const dec = instrument.decimals;

          // 1. Subtle dashed trend impulse anchor line
          ctx.save();
          ctx.setLineDash([4 * dpr, 4 * dpr]);
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
          ctx.lineWidth = 1 * dpr;
          ctx.beginPath();
          ctx.moveTo(p0.x * dpr, p0.y * dpr);
          ctx.lineTo(p1.x * dpr, p1.y * dpr);
          ctx.stroke();
          ctx.restore();

          // 2. Zone fills between Fibonacci levels
          for (let i = 0; i < levels.length - 1; i++) {
            const yA = (p0y + dy * levels[i].lvl) * dpr;
            const yB = (p0y + dy * levels[i + 1].lvl) * dpr;
            const topY = Math.min(yA, yB);
            const height = Math.abs(yB - yA);
            ctx.fillStyle = levels[i].fill;
            ctx.fillRect(minX, topY, maxX - minX, height);
          }

          // 3. Horizontal levels and price badges
          levels.forEach(({ lvl, label, color }) => {
            const ly = (p0y + dy * lvl) * dpr;
            ctx.strokeStyle = color;
            ctx.lineWidth = (lvl === 0 || lvl === 1.0 || lvl === 0.618 ? 1.5 : 1) * dpr;
            ctx.beginPath();
            ctx.moveTo(minX, ly);
            ctx.lineTo(maxX, ly);
            ctx.stroke();

            // Calculate precise price level
            const lvlPrice = d.pts[0].price + (d.pts[1].price - d.pts[0].price) * lvl;
            const labelText = `${label} • ${lvlPrice.toFixed(dec)}`;

            // Badge pill background
            ctx.font = `600 ${8.5 * dpr}px 'JetBrains Mono', monospace`;
            const textW = ctx.measureText(labelText).width;
            const badgeW = textW + 8 * dpr;
            const badgeH = 14 * dpr;

            ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
            ctx.fillRect(minX + 6 * dpr, ly - 14 * dpr, badgeW, badgeH);
            ctx.strokeStyle = color;
            ctx.lineWidth = 0.8 * dpr;
            ctx.strokeRect(minX + 6 * dpr, ly - 14 * dpr, badgeW, badgeH);

            ctx.fillStyle = color;
            ctx.fillText(labelText, minX + 10 * dpr, ly - 3.5 * dpr);
          });
        }
      } else if (d.type === 'pos_long' || d.type === 'pos_short') {
        const isLong = d.type === 'pos_long';
        const pEntry = toXY(d.pts[0].time, d.pts[0].price);
        const pTP = toXY(d.pts[1].time, d.pts[1].price);
        const pSL = toXY(d.pts[2].time, d.pts[2].price);

        if (pEntry.x !== null && pEntry.y !== null && pTP.x !== null && pTP.y !== null && pSL.x !== null && pSL.y !== null) {
          const rx = Math.min(pEntry.x, pTP.x) * dpr;
          const rw = Math.max(80, Math.abs(pTP.x - pEntry.x)) * dpr;
          const pip = instrument.pip;
          const dec = instrument.decimals;

          // Target Zone (Green)
          ctx.fillStyle = 'rgba(0, 196, 110, 0.20)';
          ctx.strokeStyle = '#00C46E';
          ctx.lineWidth = 1.5 * dpr;
          const tpY = Math.min(pEntry.y, pTP.y) * dpr;
          const tpH = Math.abs(pTP.y - pEntry.y) * dpr;
          ctx.fillRect(rx, tpY, rw, tpH);
          ctx.strokeRect(rx, tpY, rw, tpH);

          // Stop Zone (Red)
          ctx.fillStyle = 'rgba(244, 63, 94, 0.20)';
          ctx.strokeStyle = '#F43F5E';
          ctx.lineWidth = 1.5 * dpr;
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

          // Metrics: Target Pips, Stop Pips & R:R
          const targetDist = Math.abs(d.pts[1].price - d.pts[0].price);
          const stopDist = Math.abs(d.pts[0].price - d.pts[2].price);
          const targetPips = targetDist / pip;
          const stopPips = stopDist / pip;
          const rr = stopDist > 0 ? (targetDist / stopDist).toFixed(2) : '1.00';

          // R:R Center Badge
          ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
          ctx.fillRect(rx + 6 * dpr, (pEntry.y - 10) * dpr, 68 * dpr, 20 * dpr);
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
          ctx.lineWidth = 1 * dpr;
          ctx.strokeRect(rx + 6 * dpr, (pEntry.y - 10) * dpr, 68 * dpr, 20 * dpr);

          ctx.fillStyle = '#FFFFFF';
          ctx.font = `bold ${9.5 * dpr}px JetBrains Mono, monospace`;
          ctx.fillText(`R:R 1:${rr}`, rx + 11 * dpr, (pEntry.y + 4) * dpr);

          // TP Top Label
          ctx.fillStyle = '#00C46E';
          ctx.font = `${8.5 * dpr}px JetBrains Mono, monospace`;
          const tpLabelY = isLong ? tpY - 4 * dpr : tpY + tpH + 11 * dpr;
          ctx.fillText(`TP: ${d.pts[1].price.toFixed(dec)} (+${targetPips.toFixed(1)}p)`, rx + 6 * dpr, tpLabelY);

          // SL Bottom Label
          ctx.fillStyle = '#F43F5E';
          ctx.font = `${8.5 * dpr}px JetBrains Mono, monospace`;
          const slLabelY = isLong ? slY + slH + 11 * dpr : slY - 4 * dpr;
          ctx.fillText(`SL: ${d.pts[2].price.toFixed(dec)} (-${stopPips.toFixed(1)}p)`, rx + 6 * dpr, slLabelY);
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
        if (d.type === 'pos_long' || d.type === 'pos_short') {
          const pEntry = toXY(d.pts[0].time, d.pts[0].price);
          const pTP = toXY(d.pts[1].time, d.pts[1].price);
          const pSL = toXY(d.pts[2].time, d.pts[2].price);

          if (pEntry.x !== null && pEntry.y !== null && pTP.x !== null && pTP.y !== null && pSL.x !== null && pSL.y !== null) {
            const leftX = Math.min(pEntry.x, pTP.x) * dpr;
            const rightX = Math.max(pEntry.x, pTP.x) * dpr;
            const centerX = (leftX + rightX) / 2;
            const entryY = pEntry.y * dpr;
            const tpY = pTP.y * dpr;
            const slY = pSL.y * dpr;

            const drawHandleDot = (x: number, y: number, color: string, radius = 5 * dpr) => {
              ctx.fillStyle = '#FFFFFF';
              ctx.strokeStyle = color;
              ctx.lineWidth = 2 * dpr;
              ctx.beginPath();
              ctx.arc(x, y, radius, 0, Math.PI * 2);
              ctx.fill();
              ctx.stroke();
            };

            // TP Top Edge Handles (Green)
            drawHandleDot(centerX, tpY, '#00C46E', 5.5 * dpr);
            drawHandleDot(rightX, tpY, '#00C46E', 4.5 * dpr);

            // SL Bottom Edge Handles (Red)
            drawHandleDot(centerX, slY, '#F43F5E', 5.5 * dpr);
            drawHandleDot(rightX, slY, '#F43F5E', 4.5 * dpr);

            // Entry Middle Line Handles (Blue)
            drawHandleDot(leftX, entryY, '#3B82F6', 5.5 * dpr);
            drawHandleDot(rightX, entryY, '#3B82F6', 5.5 * dpr);
          }
        } else {
          ctx.fillStyle = '#FFFFFF';
          ctx.strokeStyle = '#3B82F6';
          ctx.lineWidth = 2 * dpr;
          d.pts.forEach((pt) => {
            const p = toXY(pt.time, pt.price);
            if (p.x !== null && p.y !== null) {
              ctx.beginPath();
              ctx.arc(p.x * dpr, p.y * dpr, 4.5 * dpr, 0, Math.PI * 2);
              ctx.fill();
              ctx.stroke();
            }
          });
        }
      }

      ctx.restore();
    });

    // ── 5. LIVE PREVIEW DURING DRAWING ──────────────────────
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
            ctx.fillStyle = 'rgba(59, 130, 246, 0.14)';
            ctx.fillRect(rx, ry, rw, rh);
            ctx.strokeRect(rx, ry, rw, rh);
          } else if (activeTool === 'channel') {
            // Preview the actual band, so the shape the user releases on is the
            // shape they saw — the old preview drew a bare line.
            const preview = channelRails(
              makeChannelPoints(drawPtsRef.current[0], drawPtsRef.current[1])
            );
            const b0 = preview && toXY(preview.parallel[0].time, preview.parallel[0].price);
            const b1 = preview && toXY(preview.parallel[1].time, preview.parallel[1].price);

            ctx.beginPath();
            ctx.moveTo(p0.x * dpr, p0.y * dpr);
            ctx.lineTo(p1.x * dpr, p1.y * dpr);
            ctx.stroke();

            if (b0 && b1 && b0.x !== null && b0.y !== null && b1.x !== null && b1.y !== null) {
              ctx.beginPath();
              ctx.moveTo(b0.x * dpr, b0.y * dpr);
              ctx.lineTo(b1.x * dpr, b1.y * dpr);
              ctx.stroke();

              ctx.save();
              ctx.setLineDash([]);
              ctx.fillStyle = 'rgba(59, 130, 246, 0.10)';
              ctx.beginPath();
              ctx.moveTo(p0.x * dpr, p0.y * dpr);
              ctx.lineTo(p1.x * dpr, p1.y * dpr);
              ctx.lineTo(b1.x * dpr, b1.y * dpr);
              ctx.lineTo(b0.x * dpr, b0.y * dpr);
              ctx.closePath();
              ctx.fill();
              ctx.restore();
            }
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
  }, [drawings, selectedDrawingId, activeTool, currentStyle, toXY, width, height, mainSeries, separatorTF, forexSessions, activePosition, pendingOrders, displayCandles, getBarSpacingPx, chart, activeIndicators, activeTF, baseTF, instrument, currentSymbol]);

  useEffect(() => {
    redraw();
  }, [redraw, width, height, sortedTimes, displayCandles, separatorTF, forexSessions, activeTF, activeIndicators, pendingOrders]);

  // Pan and zoom emit range changes far faster than one per frame. Coalesce
  // them into a single pending frame and cancel it on cleanup — the previous
  // version queued an unbounded number of callbacks, and any still in flight
  // after unmount drew into a detached canvas.
  useEffect(() => {
    if (!chart) return;

    let frame: number | null = null;
    const handler = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        redraw();
      });
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(handler);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handler);
    };
  }, [chart, redraw]);

  // ── MOUSE EVENTS (SELECTION, DRAGGING & CREATION) ─────────
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const pt = fromXY(mx, my);

    mouseDownPosRef.current = { x: mx, y: my };
    isMouseDownRef.current = true;

    // Check click / drag on Position / Pending Order Lines or Badges
    const tradeHit = hitTestTrade(mx, my);
    if (tradeHit) {
      const pip = instrument.pip;
      // Moving a stop or closing while reviewing past candles is lookahead:
      // the user has already seen where the price goes.
      if (blockTradingInThePast()) return;

      if (tradeHit.action === 'CLOSE_ACTIVE') {
        const candle = currentTradingCandle();
        if (candle) closeAtMarket(candle.close, candle.time);
        redraw();
        return;
      }
      if (tradeHit.action === 'ADD_ACTIVE_SL' && activePosition) {
        const isLong = activePosition.type === 'LONG';
        const newSl = isLong ? activePosition.entry - pip * 25 : activePosition.entry + pip * 25;
        updateActivePositionSlTp(newSl, activePosition.tp);
        dragTradeRef.current = { type: 'ACTIVE_SL' };
        redraw();
        return;
      }
      if (tradeHit.action === 'ADD_ACTIVE_TP' && activePosition) {
        const isLong = activePosition.type === 'LONG';
        const newTp = isLong ? activePosition.entry + pip * 50 : activePosition.entry - pip * 50;
        updateActivePositionSlTp(activePosition.sl, newTp);
        dragTradeRef.current = { type: 'ACTIVE_TP' };
        redraw();
        return;
      }
      if (tradeHit.action === 'ADD_PENDING_SL' && tradeHit.orderId) {
        const o = pendingOrders.find((x) => x.id === tradeHit.orderId);
        if (o) {
          const isLong = o.type === 'LONG';
          const newSl = isLong ? o.targetPrice - pip * 25 : o.targetPrice + pip * 25;
          updatePendingOrder(o.id, { sl: newSl });
          dragTradeRef.current = { type: 'PENDING_SL', orderId: o.id };
        }
        redraw();
        return;
      }
      if (tradeHit.action === 'ADD_PENDING_TP' && tradeHit.orderId) {
        const o = pendingOrders.find((x) => x.id === tradeHit.orderId);
        if (o) {
          const isLong = o.type === 'LONG';
          const newTp = isLong ? o.targetPrice + pip * 50 : o.targetPrice - pip * 50;
          updatePendingOrder(o.id, { tp: newTp });
          dragTradeRef.current = { type: 'PENDING_TP', orderId: o.id };
        }
        redraw();
        return;
      }
      if (tradeHit.action === 'CLEAR_ACTIVE_SL') {
        if (activePosition) updateActivePositionSlTp(null, activePosition.tp);
        redraw();
        return;
      }
      if (tradeHit.action === 'CLEAR_ACTIVE_TP') {
        if (activePosition) updateActivePositionSlTp(activePosition.sl, null);
        redraw();
        return;
      }
      if (tradeHit.action === 'CANCEL_PENDING' && tradeHit.orderId) {
        cancelPendingOrder(tradeHit.orderId);
        redraw();
        return;
      }
      if (tradeHit.action === 'CLEAR_PENDING_SL' && tradeHit.orderId) {
        updatePendingOrder(tradeHit.orderId, { sl: null });
        redraw();
        return;
      }
      if (tradeHit.action === 'CLEAR_PENDING_TP' && tradeHit.orderId) {
        updatePendingOrder(tradeHit.orderId, { tp: null });
        redraw();
        return;
      }
      if (tradeHit.action === 'DRAG') {
        dragTradeRef.current = { type: tradeHit.type, orderId: tradeHit.orderId };
        return;
      }
    }

    if (activeTool === 'cursor') {
      const hit = hitTest(mx, my);
      if (hit) {
        selectDrawing(hit.drawingId);
        const selD = drawings.find((d) => d.id === hit.drawingId);
        if (selD) {
          if (hit.handleIdx !== null) {
            dragHandleRef.current = { drawingId: hit.drawingId, ptIdx: hit.handleIdx };
          } else {
            dragBodyRef.current = {
              drawingId: hit.drawingId,
              startPts: JSON.parse(JSON.stringify(selD.pts)),
              startMouse: { x: mx, y: my },
            };
          }
        }
        redraw();
        return;
      }

      // Click on empty space: deselect & forward mousedown to chart for panning
      selectDrawing(null);
      redraw();

      const canvas = canvasRef.current;
      if (canvas) {
        canvas.style.pointerEvents = 'none';
        const target = document.elementFromPoint(e.clientX, e.clientY);
        if (target && target !== canvas) {
          const simEvent = new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: e.clientX,
            clientY: e.clientY,
            screenX: e.screenX,
            screenY: e.screenY,
            buttons: e.buttons,
            button: e.button,
          });
          target.dispatchEvent(simEvent);
        }

        const restorePointerEvents = () => {
          if (canvasRef.current) {
            canvasRef.current.style.pointerEvents = 'auto';
          }
          window.removeEventListener('mouseup', restorePointerEvents);
        };
        window.addEventListener('mouseup', restorePointerEvents);
      }
      return;
    }

    const pip = instrument.pip;

    // Direct 1-Click Placement tools
    if (activeTool === 'pos_long' || activeTool === 'pos_short') {
      const isLong = activeTool === 'pos_long';
      const newD: Drawing = {
        id: newId('draw'),
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
      selectDrawing(newD.id);
      setActiveTool('cursor');
      return;
    }

    if (activeTool === 'hline') {
      const newD: Drawing = {
        id: newId('draw'),
        type: 'hline',
        pts: [pt],
        style: currentStyle,
      };
      addDrawing(newD);
      drawPtsRef.current = [];
      selectDrawing(newD.id);
      setActiveTool('cursor');
      return;
    }

    if (activeTool === 'vline') {
      const newD: Drawing = {
        id: newId('draw'),
        type: 'vline',
        pts: [pt],
        style: currentStyle,
      };
      addDrawing(newD);
      drawPtsRef.current = [];
      selectDrawing(newD.id);
      setActiveTool('cursor');
      return;
    }

    if (activeTool === 'text') {
      setTextDraft({ x: mx, y: my, pt });
      drawPtsRef.current = [];
      setActiveTool('cursor');
      return;
    }

    // 2-Point Placement tools
    if (drawPtsRef.current.length === 0) {
      drawPtsRef.current = [pt, pt];
      redraw();
    } else {
      const p0 = drawPtsRef.current[0];
      const newD: Drawing = {
        id: newId('draw'),
        type: activeTool,
        pts: buildDrawingPoints(activeTool, p0, pt),
        style: currentStyle,
      };
      addDrawing(newD);
      drawPtsRef.current = [];
      selectDrawing(newD.id);
      setActiveTool('cursor');
      redraw();
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const pt = fromXY(mx, my);

    // 0. Dragging Active Trade / Pending Order Lines
    if (dragTradeRef.current && isMouseDownRef.current) {
      const pip = instrument.pip;
      const minDistance = pip * 2;
      const { type, orderId } = dragTradeRef.current;

      if (type === 'ACTIVE_SL' && activePosition) {
        const isLong = activePosition.type === 'LONG';
        const validSl = isLong
          ? Math.min(activePosition.entry - minDistance, pt.price)
          : Math.max(activePosition.entry + minDistance, pt.price);
        updateActivePositionSlTp(validSl, activePosition.tp);
      } else if (type === 'ACTIVE_TP' && activePosition) {
        const isLong = activePosition.type === 'LONG';
        const validTp = isLong
          ? Math.max(activePosition.entry + minDistance, pt.price)
          : Math.min(activePosition.entry - minDistance, pt.price);
        updateActivePositionSlTp(activePosition.sl, validTp);
      } else if (type === 'PULL_ACTIVE' && activePosition) {
        const isLong = activePosition.type === 'LONG';
        const delta = pt.price - activePosition.entry;
        if (Math.abs(delta) >= minDistance) {
          if (delta > 0) {
            // Above entry: TP for LONG, SL for SHORT
            if (isLong) {
              updateActivePositionSlTp(activePosition.sl, Math.max(activePosition.entry + minDistance, pt.price));
            } else {
              updateActivePositionSlTp(Math.max(activePosition.entry + minDistance, pt.price), activePosition.tp);
            }
          } else {
            // Below entry: SL for LONG, TP for SHORT
            if (isLong) {
              updateActivePositionSlTp(Math.min(activePosition.entry - minDistance, pt.price), activePosition.tp);
            } else {
              updateActivePositionSlTp(activePosition.sl, Math.min(activePosition.entry - minDistance, pt.price));
            }
          }
        }
      } else if (type === 'PENDING_TARGET' && orderId) {
        updatePendingOrder(orderId, { targetPrice: pt.price });
      } else if (type === 'PENDING_SL' && orderId) {
        const order = pendingOrders.find((o) => o.id === orderId);
        if (order) {
          const isLong = order.type === 'LONG';
          const validSl = isLong
            ? Math.min(order.targetPrice - minDistance, pt.price)
            : Math.max(order.targetPrice + minDistance, pt.price);
          updatePendingOrder(orderId, { sl: validSl });
        }
      } else if (type === 'PENDING_TP' && orderId) {
        const order = pendingOrders.find((o) => o.id === orderId);
        if (order) {
          const isLong = order.type === 'LONG';
          const validTp = isLong
            ? Math.max(order.targetPrice + minDistance, pt.price)
            : Math.min(order.targetPrice - minDistance, pt.price);
          updatePendingOrder(orderId, { tp: validTp });
        }
      } else if (type === 'PULL_PENDING' && orderId) {
        const order = pendingOrders.find((o) => o.id === orderId);
        if (order) {
          const isLong = order.type === 'LONG';
          const delta = pt.price - order.targetPrice;
          if (Math.abs(delta) >= minDistance) {
            if (delta > 0) {
              // Above target: TP for BUY, SL for SELL
              if (isLong) {
                updatePendingOrder(orderId, { tp: Math.max(order.targetPrice + minDistance, pt.price) });
              } else {
                updatePendingOrder(orderId, { sl: Math.max(order.targetPrice + minDistance, pt.price) });
              }
            } else {
              // Below target: SL for BUY, TP for SELL
              if (isLong) {
                updatePendingOrder(orderId, { sl: Math.min(order.targetPrice - minDistance, pt.price) });
              } else {
                updatePendingOrder(orderId, { tp: Math.min(order.targetPrice - minDistance, pt.price) });
              }
            }
          }
        }
      }

      redraw();
      return;
    }

    // 1. Dragging a handle
    if (dragHandleRef.current && isMouseDownRef.current) {
      const { drawingId, ptIdx } = dragHandleRef.current;
      const d = drawings.find((item) => item.id === drawingId);
      if (d) {
        if (d.type === 'pos_long' || d.type === 'pos_short') {
          const isLong = d.type === 'pos_long';
          const pip = instrument.pip;
          const minDistance = pip * 2;
          const newPts = [...d.pts];
          const entryPrice = newPts[0].price;

          if (ptIdx === 0) {
            // Dragging Entry:
            const newEntry = pt.price;
            const deltaPrice = newEntry - entryPrice;
            newPts[0] = { time: pt.time, price: newEntry };
            // Move TP & SL synchronously to maintain pip distance
            newPts[1] = { time: newPts[1].time, price: newPts[1].price + deltaPrice };
            newPts[2] = { time: pt.time, price: newPts[2].price + deltaPrice };
          } else if (ptIdx === 1) {
            // Dragging TP (Take Profit):
            // LONG: TP MUST BE > ENTRY
            // SHORT: TP MUST BE < ENTRY
            const validTp = isLong
              ? Math.max(entryPrice + minDistance, pt.price)
              : Math.min(entryPrice - minDistance, pt.price);
            const validTime = Math.max(newPts[0].time + 60, pt.time);
            newPts[1] = { time: validTime, price: validTp };
          } else if (ptIdx === 2) {
            // Dragging SL (Stop Loss):
            // LONG: SL MUST BE < ENTRY
            // SHORT: SL MUST BE > ENTRY
            const validSl = isLong
              ? Math.min(entryPrice - minDistance, pt.price)
              : Math.max(entryPrice + minDistance, pt.price);
            newPts[2] = { time: newPts[0].time, price: validSl };
          } else if (ptIdx === 5) {
            // Dragging Right edge width only
            const validTime = Math.max(newPts[0].time + 60, pt.time);
            newPts[1] = { time: validTime, price: newPts[1].price };
          }

          updateDrawing(drawingId, { pts: newPts });
          redraw();
          return;
        }

        // Moving a channel endpoint must carry the width anchor with it,
        // otherwise the offset is recomputed against the new baseline and the
        // band collapses or flips as the slope changes.
        if (d.type === 'channel' && (ptIdx === 0 || ptIdx === 1)) {
          updateDrawing(drawingId, { pts: moveChannelEndpoint(d.pts, ptIdx, pt) });
          redraw();
          return;
        }

        const newPts = [...d.pts];
        newPts[ptIdx] = pt;
        updateDrawing(drawingId, { pts: newPts });
        redraw();
      }
      return;
    }

    // 2. Dragging a drawing body
    if (dragBodyRef.current && isMouseDownRef.current) {
      const { drawingId, startPts, startMouse } = dragBodyRef.current;
      const pStart = fromXY(startMouse.x, startMouse.y);
      const deltaTime = pt.time - pStart.time;
      const deltaPrice = pt.price - pStart.price;

      const newPts = startPts.map((p) => ({
        time: p.time + deltaTime,
        price: p.price + deltaPrice,
      }));
      updateDrawing(drawingId, { pts: newPts });
      redraw();
      return;
    }

    // 3. Live drawing preview
    if (drawPtsRef.current.length >= 2 && activeTool !== 'cursor') {
      drawPtsRef.current[1] = pt;
      redraw();
      return;
    }

    // 4. Cursor feedback on hover
    if (activeTool === 'cursor' && canvasRef.current && !isMouseDownRef.current) {
      const tradeHit = hitTestTrade(mx, my);
      if (tradeHit) {
        if (tradeHit.action.startsWith('CLOSE') || tradeHit.action.startsWith('CANCEL') || tradeHit.action.startsWith('CLEAR')) {
          canvasRef.current.style.cursor = 'pointer';
        } else {
          canvasRef.current.style.cursor = 'ns-resize';
        }
        return;
      }

      const hit = hitTest(mx, my);
      if (hit) {
        if (hit.handleIdx === 1 || hit.handleIdx === 2 || hit.handleIdx === 0) {
          canvasRef.current.style.cursor = 'ns-resize';
        } else if (hit.handleIdx === 5) {
          canvasRef.current.style.cursor = 'ew-resize';
        } else if (hit.handleIdx !== null) {
          canvasRef.current.style.cursor = 'grab';
        } else {
          canvasRef.current.style.cursor = 'move';
        }
      } else {
        canvasRef.current.style.cursor = 'default';
      }
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isMouseDownRef.current) return;
    isMouseDownRef.current = false;

    // Dragging a shape mutated it through `updateDrawing`, which never touched
    // the history — so Ctrl+Z skipped the move entirely and jumped to the state
    // before it. Close the gesture with a single undo step.
    const wasDraggingShape = dragHandleRef.current !== null || dragBodyRef.current !== null;

    dragHandleRef.current = null;
    dragBodyRef.current = null;
    dragTradeRef.current = null;

    if (wasDraggingShape) commitDrawingEdit();

    if (!mouseDownPosRef.current) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const dragDist = Math.hypot(mx - mouseDownPosRef.current.x, my - mouseDownPosRef.current.y);

    if (dragDist > 8 && drawPtsRef.current.length >= 2 && activeTool !== 'cursor') {
      const p0 = drawPtsRef.current[0];
      const p1 = drawPtsRef.current[1];
      const newD: Drawing = {
        id: newId('draw'),
        type: activeTool,
        pts: buildDrawingPoints(activeTool, p0, p1),
        style: currentStyle,
      };
      addDrawing(newD);
      drawPtsRef.current = [];
      selectDrawing(newD.id);
      setActiveTool('cursor');
      redraw();
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.style.pointerEvents = 'none';
    const target = document.elementFromPoint(e.clientX, e.clientY);
    canvas.style.pointerEvents = 'auto';
    if (target && target !== canvas) {
      const simWheel = new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: e.clientX,
        clientY: e.clientY,
        screenX: e.screenX,
        screenY: e.screenY,
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        deltaZ: e.deltaZ,
        deltaMode: e.deltaMode,
      });
      target.dispatchEvent(simWheel);
    }
  };

  // Selected drawing position for floating toolbar
  const selectedDrawing = drawings.find((d) => d.id === selectedDrawingId);
  const isRR = selectedDrawing?.type === 'pos_long' || selectedDrawing?.type === 'pos_short';

  let toolbarPos: { x: number; y: number } | null = null;
  if (selectedDrawing && selectedDrawing.pts.length > 0) {
    const xyPts = selectedDrawing.pts
      .map((p) => toXY(p.time, p.price))
      .filter((p) => p.x !== null && p.y !== null) as { x: number; y: number }[];

    if (xyPts.length > 0) {
      const minX = Math.min(...xyPts.map((p) => p.x));
      const maxX = Math.max(...xyPts.map((p) => p.x));
      const minY = Math.min(...xyPts.map((p) => p.y));
      const maxY = Math.max(...xyPts.map((p) => p.y));

      if (isRR) {
        // Place to the SIDE of the Position Box so it NEVER blocks handles, candles or metrics
        const tbWidth = 110;
        // Prefer placing to the right outside maxX
        let tx = maxX + 18;
        let ty = Math.min(height - 80, Math.max(20, minY + 10));

        // If not enough room on the right (close to price scale), place to the left of the box
        if (tx + tbWidth > width - 75) {
          tx = minX - tbWidth - 18;
        }
        // If still off-screen to the left, place above the highest point
        if (tx < 15) {
          tx = Math.max(15, minX);
          ty = Math.max(15, minY - 45);
        }

        toolbarPos = {
          x: Math.max(10, Math.min(width - tbWidth - 70, tx)),
          y: Math.max(10, Math.min(height - 50, ty)),
        };
      } else {
        const tbWidth = 220;
        let ty = minY - 45;
        if (ty < 35) {
          ty = maxY + 15;
        }
        const tx = (minX + maxX) / 2 - tbWidth / 2;
        toolbarPos = {
          x: Math.max(10, Math.min(width - tbWidth - 70, tx)),
          y: Math.max(10, Math.min(height - 50, ty)),
        };
      }
    }
  }

  return (
    <div className="u-position-absolute u-inset-0 u-overflow-hidden">
      <canvas
        ref={canvasRef}
        id="draw-canvas"
        width={width * (window.devicePixelRatio || 1)}
        height={height * (window.devicePixelRatio || 1)}
        className="active"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: `${width}px`,
          height: `${height}px`,
          pointerEvents: 'auto',
          zIndex: 10,
          cursor: activeTool === 'cursor' ? 'default' : 'crosshair',
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
      />

      {textDraft && (
        <input
          className="annotation-input"
          autoFocus
          placeholder="Texte de l’annotation — Entrée pour valider"
          aria-label="Texte de l’annotation"
          style={{ left: `${textDraft.x}px`, top: `${textDraft.y}px` }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              // Vider d'abord : le démontage peut encore émettre un `blur`,
              // qui validerait sinon le texte qu'on vient d'abandonner.
              e.currentTarget.value = '';
              setTextDraft(null);
            } else if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          onBlur={(e) => {
            const text = e.currentTarget.value.trim();
            const draft = textDraft;
            setTextDraft(null);
            if (!text) return;
            const newD: Drawing = {
              id: newId('draw'),
              type: 'text',
              pts: [draft.pt],
              style: { ...currentStyle, text },
            };
            addDrawing(newD);
            selectDrawing(newD.id);
          }}
        />
      )}

      {/* Floating Action Toolbar for Selected Drawing */}
      {selectedDrawing && toolbarPos && (
        <div
          id="drawing-floating-toolbar"
          style={{
            position: 'absolute',
            left: `${toolbarPos.x}px`,
            top: `${toolbarPos.y}px`,
            zIndex: 30,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: 'rgba(15, 23, 42, 0.95)',
            backdropFilter: 'blur(14px)',
            padding: '4px 8px',
            borderRadius: '8px',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
            pointerEvents: 'auto',
          }}
        >
          {isRR ? (
            <span className="u-font-size-10_5px u-font-weight-700 u-color-94a3b8 u-padding-right-4px u-letter-spacing-0_03em">
              {selectedDrawing.type === 'pos_long' ? '📈 ACHAT' : '📉 VENTE'}
            </span>
          ) : (
            <>
              {/* Color palette */}
              {['#3B82F6', '#00C46E', '#F43F5E', '#F59E0B', '#A78BFA', '#FFFFFF'].map((c) => (
                <div
                  key={c}
                  onClick={() => updateDrawing(selectedDrawing.id, { style: { ...selectedDrawing.style, color: c } })}
                  style={{
                    width: '14px',
                    height: '14px',
                    borderRadius: '50%',
                    background: c,
                    cursor: 'pointer',
                    border: selectedDrawing.style.color === c ? '2px solid white' : '1px solid rgba(0,0,0,0.3)',
                    transform: selectedDrawing.style.color === c ? 'scale(1.2)' : 'scale(1)',
                    transition: 'transform 0.1s ease',
                  }}
                  title={`Couleur ${c}`}
                />
              ))}

              <div className="u-width-1px u-height-14px u-background-rgba-255-255-255-0_15 u-margin-0-2px" />
            </>
          )}

          {/* Duplicate button */}
          <button
            onClick={() => {
              const pip = instrument.pip;
              const dup: Drawing = {
                ...selectedDrawing,
                id: newId('draw'),
                pts: selectedDrawing.pts.map((p) => ({ time: p.time, price: p.price + pip * 10 })),
              };
              addDrawing(dup);
              selectDrawing(dup.id);
            }} className="u-background-rgba-255-255-255-0_06 u-border-7eec68 u-color-cbd5e1 u-cursor-pointer u-display-flex u-align-items-center u-justify-content-center u-padding-4px-6px u-border-radius-5px u-transition-background-0_15s-ease"
            title="Dupliquer"
          >
            <Copy size={13} strokeWidth={2} />
          </button>

          {/* Delete button */}
          <button
            onClick={() => {
              removeDrawing(selectedDrawing.id);
              selectDrawing(null);
            }} className="u-background-rgba-244-63-94-0_18 u-border-d4a8b5 u-color-f43f5e u-cursor-pointer u-display-flex u-align-items-center u-justify-content-center u-padding-4px-6px u-border-radius-5px u-transition-background-0_15s-ease"
            title="Supprimer (Touche Suppr)"
          >
            <Trash2 size={13} strokeWidth={2} />
          </button>
        </div>
      )}
    </div>
  );
};
