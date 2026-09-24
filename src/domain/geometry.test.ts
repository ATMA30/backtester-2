import { describe, expect, it } from 'vitest';
import {
  baselinePriceAt,
  channelOffset,
  channelRails,
  defaultChannelOffset,
  isPointInPolygon,
  isPointInRect,
  makeChannelPoints,
  pointToRayDistance,
  pointToSegmentDistance,
  moveChannelEndpoint,
} from './geometry';
import { Point } from '../types/drawing';

const at = (time: number, price: number): Point => ({ time, price });

describe('pointToSegmentDistance', () => {
  it('measures the perpendicular distance inside the segment', () => {
    expect(pointToSegmentDistance(5, 3, 0, 0, 10, 0)).toBe(3);
  });

  it('clamps to the endpoints outside the segment', () => {
    expect(pointToSegmentDistance(-4, 0, 0, 0, 10, 0)).toBe(4);
    expect(pointToSegmentDistance(14, 0, 0, 0, 10, 0)).toBe(4);
  });

  it('handles a degenerate segment', () => {
    expect(pointToSegmentDistance(3, 4, 0, 0, 0, 0)).toBe(5);
  });
});

describe('pointToRayDistance', () => {
  it('extends past the second point but not behind the first', () => {
    expect(pointToRayDistance(100, 3, 0, 0, 10, 0)).toBe(3);
    expect(pointToRayDistance(-4, 0, 0, 0, 10, 0)).toBe(4);
  });
});

describe('isPointInRect', () => {
  it('accepts points inside, and within tolerance', () => {
    expect(isPointInRect(5, 5, 0, 0, 10, 10, 0)).toBe(true);
    expect(isPointInRect(-3, 5, 0, 0, 10, 10, 5)).toBe(true);
    expect(isPointInRect(-9, 5, 0, 0, 10, 10, 5)).toBe(false);
  });

  it('is independent of corner order', () => {
    expect(isPointInRect(5, 5, 10, 10, 0, 0, 0)).toBe(true);
  });
});

describe('isPointInPolygon', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it('distinguishes inside from outside', () => {
    expect(isPointInPolygon(5, 5, square)).toBe(true);
    expect(isPointInPolygon(15, 5, square)).toBe(false);
    expect(isPointInPolygon(5, -1, square)).toBe(false);
  });

  it('handles a sheared band, as a sloped channel produces', () => {
    const band = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 10, y: 20 },
      { x: 0, y: 10 },
    ];
    expect(isPointInPolygon(5, 10, band)).toBe(true);
    expect(isPointInPolygon(5, 1, band)).toBe(false);
  });
});

describe('baselinePriceAt', () => {
  it('interpolates along the baseline', () => {
    expect(baselinePriceAt(at(0, 100), at(10, 110), 5)).toBe(105);
  });

  it('extrapolates beyond both ends', () => {
    expect(baselinePriceAt(at(0, 100), at(10, 110), 20)).toBe(120);
    expect(baselinePriceAt(at(0, 100), at(10, 110), -10)).toBe(90);
  });

  it('is flat for a vertical baseline', () => {
    expect(baselinePriceAt(at(5, 100), at(5, 110), 7)).toBe(100);
  });
});

describe('channel geometry', () => {
  it('builds two rails separated by a constant price offset', () => {
    const pts = [at(0, 100), at(10, 110), at(5, 100)];
    const rails = channelRails(pts);

    expect(rails).not.toBeNull();
    // Baseline at t=5 is 105; the anchor sits at 100, so the offset is -5.
    expect(rails!.offset).toBe(-5);
    expect(rails!.parallel[0].price).toBe(95);
    expect(rails!.parallel[1].price).toBe(105);
    // Parallel means equal price gap at both ends.
    expect(rails!.parallel[1].price - rails!.baseline[1].price).toBe(
      rails!.parallel[0].price - rails!.baseline[0].price
    );
  });

  it('degrades to a zero-width band when the third point is missing', () => {
    const rails = channelRails([at(0, 100), at(10, 110)]);
    expect(rails!.offset).toBe(0);
    expect(rails!.parallel[0].price).toBe(100);
  });

  it('returns null for a shape with fewer than two points', () => {
    expect(channelRails([at(0, 100)])).toBeNull();
  });

  it('gives a fresh channel a visible, proportionate width', () => {
    // Regression: the tool used to create a two-point shape with no width and
    // no renderer, so nothing appeared on screen at all.
    const pts = makeChannelPoints(at(0, 100), at(10, 110));
    expect(pts).toHaveLength(3);
    expect(channelOffset(pts)).not.toBe(0);
    expect(Math.abs(channelOffset(pts))).toBeCloseTo(2.5, 6);
  });

  it('still gives a flat baseline a non-zero width', () => {
    const offset = defaultChannelOffset(at(0, 100), at(10, 100));
    expect(offset).not.toBe(0);
    expect(Number.isFinite(offset)).toBe(true);
  });

  it('keeps the width when either endpoint is dragged', () => {
    // Regression: recomputing the offset against the moved baseline collapsed
    // or flipped the band as the slope changed.
    const pts = makeChannelPoints(at(0, 100), at(10, 110));
    const width = channelOffset(pts);

    expect(channelOffset(moveChannelEndpoint(pts, 0, at(0, 105)))).toBeCloseTo(width, 9);
    expect(channelOffset(moveChannelEndpoint(pts, 1, at(10, 90)))).toBeCloseTo(width, 9);
  });

  it('keeps the width when an endpoint is dragged sideways', () => {
    const pts = makeChannelPoints(at(0, 100), at(10, 110));
    const width = channelOffset(pts);
    // Moving in time as well as price changes the anchor's interpolation
    // weight, which the naive delta-shift got wrong.
    expect(channelOffset(moveChannelEndpoint(pts, 1, at(40, 130)))).toBeCloseTo(width, 9);
  });

  it('ignores a non-finite anchor rather than propagating NaN', () => {
    expect(channelOffset([at(0, 100), at(10, 110), at(5, Number.NaN)])).toBe(0);
  });
});
