import { describe, expect, it } from 'vitest';
import { BADGE_STRIDE, positionBadgeOffsets } from './positionLayout';
import { Position } from '../../../types/trading';

/** 1.0 → y 1000, 1.1 → y 900: a pip is 1 px. */
const priceToY = (price: number) => (2 - price) * 1000;

const position = (id: string, entry: number, sl: number | null = null, tp: number | null = null): Position => ({
  id, type: 'LONG', entry, sl, tp, size: 1, time: 0, status: 'OPEN',
});

describe('positionBadgeOffsets', () => {
  it('leaves positions apart on the right edge', () => {
    const offsets = positionBadgeOffsets([position('a', 1.1), position('b', 1.05)], priceToY);
    expect([...offsets.values()]).toEqual([0, 0]);
  });

  it('moves a position at the same level one slot to the left, the oldest keeping the edge', () => {
    const offsets = positionBadgeOffsets([position('a', 1.1), position('b', 1.1), position('c', 1.1)], priceToY);
    expect(offsets.get('a')).toBe(0);
    expect(offsets.get('b')).toBe(BADGE_STRIDE);
    expect(offsets.get('c')).toBe(2 * BADGE_STRIDE);
  });

  it('counts stops and targets too: a stop on another entry overlaps it', () => {
    // b's stop at 1.099 is 1 px from a's entry.
    const offsets = positionBadgeOffsets([position('a', 1.1), position('b', 1.12, 1.099)], priceToY);
    expect(offsets.get('b')).toBe(BADGE_STRIDE);
  });

  it('reuses the first free slot', () => {
    const offsets = positionBadgeOffsets(
      [position('a', 1.1), position('b', 1.1), position('c', 1.05)],
      priceToY
    );
    expect(offsets.get('c')).toBe(0);
  });

  it('ignores levels off the scale', () => {
    const offsets = positionBadgeOffsets([position('a', 1.1), position('b', 1.1)], () => null);
    expect([...offsets.values()]).toEqual([0, 0]);
  });
});
