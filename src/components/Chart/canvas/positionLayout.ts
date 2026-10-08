/**
 * Where each open position's badges sit, so that positions at nearby prices do
 * not hide one another.
 *
 * Badges are anchored to the right edge of the chart. Two positions opened at
 * the same level (averaging in) drew their badges at the same spot: only the
 * latest one could be read or clicked, and its ✕ closed it rather than the
 * other. Drawing and hit testing both read this layout, so what is seen is
 * what is clicked.
 */

import { Position } from '../../../types/trading';

/** Height of a badge; two badges closer than this vertically would overlap. */
export const BADGE_HEIGHT = 22;
/** Horizontal step between stacked badges: wider than the widest badge (243 px). */
export const BADGE_STRIDE = 252;

/**
 * Leftward shift of each position's badges, in CSS pixels, by position id.
 *
 * Positions are placed oldest first, each in the first slot where none of its
 * levels (entry, stop, target) comes within a badge height of a level already
 * there. The oldest position keeps the right edge.
 */
export function positionBadgeOffsets(
  positions: readonly Position[],
  priceToY: (price: number) => number | null
): Map<string, number> {
  const slots: number[][] = [];
  const offsets = new Map<string, number>();
  for (const position of positions) {
    const ys: number[] = [];
    for (const level of [position.entry, position.sl, position.tp]) {
      if (level === null || !Number.isFinite(level)) continue;
      const y = priceToY(level);
      if (y !== null && Number.isFinite(y)) ys.push(y);
    }
    let slot = 0;
    while (slots[slot]?.some((used) => ys.some((y) => Math.abs(y - used) < BADGE_HEIGHT))) slot++;
    (slots[slot] ??= []).push(...ys);
    offsets.set(position.id, slot * BADGE_STRIDE);
  }
  return offsets;
}
