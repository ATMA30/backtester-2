/**
 * Pure geometry for drawing hit-testing and the parallel channel.
 *
 * Extracted from `DrawingCanvas` so the maths can be tested without a canvas,
 * a chart instance or a DOM. Screen-space helpers take pixels; channel helpers
 * work in chart space (epoch seconds × price), because a channel's width is a
 * *price* distance — keeping it in pixels would change the channel every time
 * the price scale moves.
 */

import { Point } from '../types/drawing';

// ── SCREEN-SPACE HIT TESTING ──────────────────────────────────

/** Shortest distance from a point to a finite segment. */
export function pointToSegmentDistance(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(px - x1, py - y1);

  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Shortest distance from a point to a ray starting at (x1, y1) through (x2, y2). */
export function pointToRayDistance(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(px - x1, py - y1);

  const t = Math.max(0, ((px - x1) * dx + (py - y1) * dy) / lengthSquared);
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** True when a point lies inside an axis-aligned rectangle, plus tolerance. */
export function isPointInRect(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  tolerance = 8
): boolean {
  return (
    px >= Math.min(x1, x2) - tolerance &&
    px <= Math.max(x1, x2) + tolerance &&
    py >= Math.min(y1, y2) - tolerance &&
    py <= Math.max(y1, y2) + tolerance
  );
}

/** True when a point lies inside the quadrilateral A→B→C→D (convex or not). */
export function isPointInPolygon(
  px: number,
  py: number,
  polygon: readonly { x: number; y: number }[]
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

// ── PARALLEL CHANNEL ──────────────────────────────────────────

/**
 * A channel is stored as three points:
 *   `pts[0]`, `pts[1]` — the baseline (its slope and extent);
 *   `pts[2]`           — an anchor whose *vertical* distance to the baseline
 *                        sets the channel width.
 *
 * The width is therefore a price offset, constant across the channel, which is
 * what "parallel channel" means to a trader. Deriving it from a perpendicular
 * pixel distance would make the channel breathe as the price scale rescales.
 */
export interface ChannelRails {
  readonly baseline: readonly [Point, Point];
  readonly parallel: readonly [Point, Point];
  /** Price distance between the two rails; signed (negative = below). */
  readonly offset: number;
}

/** Price on the baseline at `time`, extrapolating beyond both ends. */
export function baselinePriceAt(p0: Point, p1: Point, time: number): number {
  const span = p1.time - p0.time;
  if (span === 0) return p0.price;
  return p0.price + ((p1.price - p0.price) * (time - p0.time)) / span;
}

/** Signed price offset of the width anchor relative to the baseline. */
export function channelOffset(pts: readonly Point[]): number {
  if (pts.length < 3) return 0;
  const offset = pts[2].price - baselinePriceAt(pts[0], pts[1], pts[2].time);
  return Number.isFinite(offset) ? offset : 0;
}

/** Both rails of a channel, ready to draw. Returns null for a degenerate shape. */
export function channelRails(pts: readonly Point[]): ChannelRails | null {
  if (pts.length < 2) return null;
  const [p0, p1] = pts;
  if (!Number.isFinite(p0.price) || !Number.isFinite(p1.price)) return null;

  const offset = channelOffset(pts);
  return {
    baseline: [p0, p1],
    parallel: [
      { time: p0.time, price: p0.price + offset },
      { time: p1.time, price: p1.price + offset },
    ],
    offset,
  };
}

/**
 * Default width for a freshly drawn channel: a quarter of the baseline's own
 * price travel, so the channel is visible immediately and proportionate to the
 * move the user just outlined. Falls back to a small fraction of the price
 * level for a flat baseline, which would otherwise produce a zero-width band.
 */
export function defaultChannelOffset(p0: Point, p1: Point): number {
  const travel = p1.price - p0.price;
  if (Math.abs(travel) > 0) return -travel * 0.25;

  const level = Math.abs(p0.price) || 1;
  return -level * 0.005;
}

/** Build the third point for a new channel from its baseline. */
export function makeChannelPoints(p0: Point, p1: Point): Point[] {
  const offset = defaultChannelOffset(p0, p1);
  const midTime = (p0.time + p1.time) / 2;
  return [p0, p1, { time: midTime, price: baselinePriceAt(p0, p1, midTime) + offset }];
}

/**
 * Move one end of the baseline while holding the channel width constant.
 *
 * Shifting the anchor by the endpoint's own price delta is wrong: moving a
 * single endpoint by Δ moves the baseline at the anchor's time by only a
 * fraction of Δ (half of it at the midpoint), so the width drifts as the slope
 * changes. Re-deriving the anchor from the offset measured *before* the move
 * preserves it exactly, whatever the endpoint's new time and price.
 */
export function moveChannelEndpoint(
  pts: readonly Point[],
  index: 0 | 1,
  next: Point
): Point[] {
  const offset = channelOffset(pts);
  const updated = [...pts];
  updated[index] = next;

  if (updated.length >= 3) {
    updated[2] = {
      ...updated[2],
      price: baselinePriceAt(updated[0], updated[1], updated[2].time) + offset,
    };
  }
  return updated;
}
