import { describe, expect, it } from 'vitest';
import { hitTestDrawingsAt, hitTestTradeAt } from './hitTesting';
import { BADGE_STRIDE } from './positionLayout';
import { Drawing } from '../../../types/drawing';
import { Position } from '../../../types/trading';

/** Price p is drawn at y = (2 − p) × 1000: 1.10 → 900, 1.09 → 910. */
const series = { priceToCoordinate: (p: number) => (2 - p) * 1000 } as never;
const WIDTH = 1000;

const position: Position = {
  id: 'p', symbol: 'EURUSD', type: 'LONG', entry: 1.1, sl: 1.09, tp: 1.12, size: 100_000, time: 1, status: 'OPEN',
};

describe('hitTestTradeAt', () => {
  const input = { mainSeries: series, openPositions: [position], width: WIDTH, pendingOrders: [] };

  it('grabs the close button on the entry badge', () => {
    expect(hitTestTradeAt(input, WIDTH - 20, 900)).toEqual({ action: 'CLOSE_ACTIVE', positionId: 'p' });
  });

  it('tells two open positions apart, the latest on top where they overlap', () => {
    const second: Position = { ...position, id: 'q', type: 'SHORT', entry: 1.05, sl: 1.08, tp: 1.0 };
    // Stops kept away from the entries: within 12 px a stop line wins over its entry.
    const first: Position = { ...position, sl: 1.07 };
    const both = { ...input, openPositions: [first, second] };
    expect(hitTestTradeAt(both, 500, 950)).toMatchObject({ type: 'PULL_ACTIVE', positionId: 'q' });
    expect(hitTestTradeAt(both, 500, 900)).toMatchObject({ type: 'PULL_ACTIVE', positionId: 'p' });
  });

  it('reaches both of two positions opened at the same price: the second one’s badges sit to the left', () => {
    const stacked = { ...input, openPositions: [position, { ...position, id: 'r' }] };
    expect(hitTestTradeAt(stacked, WIDTH - 20, 900)).toEqual({ action: 'CLOSE_ACTIVE', positionId: 'p' });
    expect(hitTestTradeAt(stacked, WIDTH - BADGE_STRIDE - 20, 900)).toEqual({ action: 'CLOSE_ACTIVE', positionId: 'r' });
  });

  it('drags the stop from its line', () => {
    expect(hitTestTradeAt(input, 500, 910)).toMatchObject({ action: 'DRAG', type: 'ACTIVE_SL' });
  });

  it('finds nothing away from every line', () => {
    expect(hitTestTradeAt(input, 500, 400)).toBeNull();
  });

  it('never answers without a series', () => {
    expect(hitTestTradeAt({ ...input, mainSeries: null }, WIDTH - 20, 900)).toBeNull();
  });
});

describe('hitTestDrawingsAt', () => {
  const line: Drawing = {
    id: 'l', type: 'trendline', symbol: 'EURUSD',
    pts: [{ time: 0, price: 0 }, { time: 100, price: 100 }],
    style: { color: '#fff', width: 2, lineStyle: 'solid' },
  } as never;
  // Identity projection: (time, price) → (x, y).
  const input = { width: WIDTH, height: 800, selectedDrawingId: null, drawings: [line], toXY: (t: number, p: number) => ({ x: t, y: p }) };

  it('selects a trendline clicked near its segment', () => {
    expect(hitTestDrawingsAt(input, 50, 52)).toMatchObject({ drawingId: 'l' });
  });

  it('leaves the price scale and the time axis to the chart', () => {
    expect(hitTestDrawingsAt(input, WIDTH - 10, 50)).toBeNull();
    expect(hitTestDrawingsAt(input, 50, 790)).toBeNull();
  });
});
