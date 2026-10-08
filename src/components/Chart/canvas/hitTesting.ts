/**
 * What is under the cursor: trade lines and badges, or a drawing and its handles.
 *
 * Pure functions of their input — no store, no ref — so the rules that decide
 * which object a click grabs can be read and tested apart from the canvas.
 */

import { channelRails, isPointInPolygon, isPointInRect, pointToRayDistance, pointToSegmentDistance } from '../../../domain/geometry';
import { Drawing } from '../../../types/drawing';
import { PendingOrder, Position } from '../../../types/trading';
import { positionBadgeOffsets } from './positionLayout';
import { ISeriesApi } from 'lightweight-charts';

export interface TradeHitInput {
  readonly mainSeries: ISeriesApi<'Candlestick' | 'Bar' | 'Line' | 'Area'> | null;
  readonly openPositions: readonly Position[];
  readonly width: number;
  readonly pendingOrders: readonly PendingOrder[];
}

export interface DrawingHitInput {
  readonly width: number;
  readonly height: number;
  readonly selectedDrawingId: string | null;
  readonly drawings: readonly Drawing[];
  readonly toXY: (time: number, price: number) => { x: number | null; y: number | null };
}

// ── HIT TESTING FOR POSITION & PENDING ORDER LINES / BUTTONS ──
export type TradeHit =
  | {
      action: 'CLOSE_ACTIVE' | 'ADD_ACTIVE_TP' | 'ADD_ACTIVE_SL' | 'CLEAR_ACTIVE_SL' | 'CLEAR_ACTIVE_TP';
      positionId: string;
      orderId?: undefined;
      type?: undefined;
    }
  | {
      action: 'CANCEL_PENDING' | 'ADD_PENDING_TP' | 'ADD_PENDING_SL' | 'CLEAR_PENDING_SL' | 'CLEAR_PENDING_TP';
      orderId: string;
      positionId?: undefined;
      type?: undefined;
    }
  | { action: 'DRAG'; type: 'ACTIVE_SL' | 'ACTIVE_TP' | 'PULL_ACTIVE'; positionId: string; orderId?: undefined }
  | { action: 'DRAG'; type: 'PENDING_SL' | 'PENDING_TP' | 'PULL_PENDING'; orderId: string; positionId?: undefined };

/** A line or badge row at `y`, `null` when its level is unset or off the scale. */
type Row = number | null;

interface TradeRows {
  readonly entry: Row;
  readonly sl: Row;
  readonly tp: Row;
  readonly hasSl: boolean;
  readonly hasTp: boolean;
  /** Right edge of this trade's badges. */
  readonly right: number;
}

/** The badge buttons of a trade: ✕ on each badge, +TP / +SL chips on the entry one. */
function buttonAt(rows: TradeRows, mx: number, my: number): 'CLOSE' | 'ADD_TP' | 'ADD_SL' | 'CLEAR_SL' | 'CLEAR_TP' | null {
  const { entry, sl, tp, hasSl, hasTp, right } = rows;
  const onClose = mx >= right - 36 && mx <= right - 8;
  if (entry !== null) {
    if (onClose && Math.abs(my - entry) < 14) return 'CLOSE';
    if (!hasTp && mx >= right - 68 && mx <= right - 40 && Math.abs(my - entry) < 14) return 'ADD_TP';
    const slChipRight = !hasTp ? right - 72 : right - 40;
    if (!hasSl && mx >= slChipRight - 28 && mx <= slChipRight && Math.abs(my - entry) < 14) return 'ADD_SL';
  }
  if (sl !== null && hasSl && onClose && Math.abs(my - sl) < 14) return 'CLEAR_SL';
  if (tp !== null && hasTp && onClose && Math.abs(my - tp) < 14) return 'CLEAR_TP';
  return null;
}

/** The lines of a trade, grabbed anywhere along the chart's width: stop, target, then entry. */
function lineAt(rows: TradeRows, my: number): 'SL' | 'TP' | 'ENTRY' | null {
  const { entry, sl, tp, hasSl, hasTp } = rows;
  if (sl !== null && hasSl && Math.abs(my - sl) < 12) return 'SL';
  if (tp !== null && hasTp && Math.abs(my - tp) < 12) return 'TP';
  if (entry !== null && Math.abs(my - entry) < 12) return 'ENTRY';
  return null;
}

/**
 * The trade control under the cursor.
 *
 * Two passes, every badge button before any line. Lines are grabbed across the
 * whole width: tested trade by trade, a newer position's stop line, 10 px from
 * an older position's entry, took the click meant for that older position's ✕.
 * Within each pass, the most recent position comes first (it is drawn on top),
 * then the pending orders.
 */
export function hitTestTradeAt(input: TradeHitInput, mx: number, my: number): TradeHit | null {
  const { openPositions, pendingOrders, mainSeries, width } = input;
  if (!mainSeries) return null;
  const y = (price: number | null): Row => {
    if (price === null || !price) return null;
    const coordinate = mainSeries.priceToCoordinate(price);
    return coordinate === null || coordinate === undefined ? null : coordinate;
  };

  // Badges sit where `positionLayout` put them, so a click reaches the one it is on.
  const offsets = positionBadgeOffsets(openPositions, (price) => mainSeries.priceToCoordinate(price));
  const positions = [...openPositions].reverse().map((p) => ({
    id: p.id,
    rows: { entry: y(p.entry), sl: y(p.sl), tp: y(p.tp), hasSl: Boolean(p.sl), hasTp: Boolean(p.tp), right: width - (offsets.get(p.id) ?? 0) },
  }));
  const orders = (pendingOrders ?? []).map((o) => ({
    id: o.id,
    rows: { entry: y(o.targetPrice), sl: y(o.sl), tp: y(o.tp), hasSl: Boolean(o.sl), hasTp: Boolean(o.tp), right: width },
  }));

  // 1. Buttons.
  for (const { id: positionId, rows } of positions) {
    const button = buttonAt(rows, mx, my);
    if (button === 'CLOSE') return { action: 'CLOSE_ACTIVE', positionId };
    if (button === 'ADD_TP') return { action: 'ADD_ACTIVE_TP', positionId };
    if (button === 'ADD_SL') return { action: 'ADD_ACTIVE_SL', positionId };
    if (button === 'CLEAR_SL') return { action: 'CLEAR_ACTIVE_SL', positionId };
    if (button === 'CLEAR_TP') return { action: 'CLEAR_ACTIVE_TP', positionId };
  }
  for (const { id: orderId, rows } of orders) {
    const button = buttonAt(rows, mx, my);
    if (button === 'CLOSE') return { action: 'CANCEL_PENDING', orderId };
    if (button === 'ADD_TP') return { action: 'ADD_PENDING_TP', orderId };
    if (button === 'ADD_SL') return { action: 'ADD_PENDING_SL', orderId };
    if (button === 'CLEAR_SL') return { action: 'CLEAR_PENDING_SL', orderId };
    if (button === 'CLEAR_TP') return { action: 'CLEAR_PENDING_TP', orderId };
  }

  // 2. Lines: drag a stop or a target, or pull one out of the entry line.
  for (const { id: positionId, rows } of positions) {
    const line = lineAt(rows, my);
    if (line === 'SL') return { action: 'DRAG', type: 'ACTIVE_SL', positionId };
    if (line === 'TP') return { action: 'DRAG', type: 'ACTIVE_TP', positionId };
    if (line === 'ENTRY') return { action: 'DRAG', type: 'PULL_ACTIVE', positionId };
  }
  for (const { id: orderId, rows } of orders) {
    const line = lineAt(rows, my);
    if (line === 'SL') return { action: 'DRAG', type: 'PENDING_SL', orderId };
    if (line === 'TP') return { action: 'DRAG', type: 'PENDING_TP', orderId };
    if (line === 'ENTRY') return { action: 'DRAG', type: 'PULL_PENDING', orderId };
  }

  return null;
}

// ── HIT TESTING FUNCTION ──────────────────────────────────
export function hitTestDrawingsAt(input: DrawingHitInput, mx: number, my: number): { drawingId: string; handleIdx: number | null } | null {
  const { drawings, selectedDrawingId, toXY, width, height } = input;
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
}
