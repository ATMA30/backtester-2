import { describe, expect, it } from 'vitest';
import { EMPTY_FILTER, NO_SETUP, computeMetrics, filterTrades, parseAnnotation, setupsOf } from './journal';
import { Position } from '../types/trading';

const day = (iso: string) => Date.parse(`${iso}T12:00:00Z`) / 1000;

const trade = (id: string, patch: Partial<Position>): Position => ({
  id,
  symbol: 'EURUSD',
  type: 'LONG',
  entry: 1.1,
  sl: null,
  tp: null,
  size: 10_000,
  time: day('2024-01-01'),
  status: 'CLOSED',
  pnl: 0,
  ...patch,
});

const history = [
  trade('a', { type: 'LONG', closeTime: day('2024-01-02'), pnl: 100, annotation: { setup: 'Cassure' } }),
  trade('b', { type: 'SHORT', closeTime: day('2024-01-05'), pnl: -50, annotation: { setup: 'cassure ' } }),
  trade('c', { type: 'LONG', closeTime: day('2024-01-09'), pnl: 30, annotation: { setup: 'Retour sur zone' } }),
  trade('d', { type: 'SHORT', closeTime: day('2024-01-12'), pnl: -20 }),
];

describe('filterTrades', () => {
  const ids = (list: Position[]) => list.map((t) => t.id);

  it('keeps everything without a filter', () => {
    expect(ids(filterTrades(history, EMPTY_FILTER))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('bounds by close date, both ends inclusive', () => {
    const from = Date.parse('2024-01-05T00:00:00Z') / 1000;
    const to = Date.parse('2024-01-09T23:59:59Z') / 1000;
    expect(ids(filterTrades(history, { ...EMPTY_FILTER, from, to }))).toEqual(['b', 'c']);
  });

  it('filters by side', () => {
    expect(ids(filterTrades(history, { ...EMPTY_FILTER, side: 'SHORT' }))).toEqual(['b', 'd']);
  });

  it('matches a setup whatever its case or spacing, and finds the trades without one', () => {
    expect(ids(filterTrades(history, { ...EMPTY_FILTER, setup: 'CASSURE' }))).toEqual(['a', 'b']);
    expect(ids(filterTrades(history, { ...EMPTY_FILTER, setup: NO_SETUP }))).toEqual(['d']);
  });

  it('combines the criteria', () => {
    expect(ids(filterTrades(history, { ...EMPTY_FILTER, side: 'LONG', setup: 'cassure' }))).toEqual(['a']);
  });
});

describe('setupsOf', () => {
  it('lists each setup once, most used first, under its most frequent spelling', () => {
    const more = [...history, trade('e', { annotation: { setup: 'cassure' } }), trade('f', { annotation: { setup: 'cassure' } })];
    expect(setupsOf(more)).toEqual(['cassure', 'Retour sur zone']);
  });
});

describe('computeMetrics', () => {
  it('measures a selection as if it were the whole account', () => {
    const shorts = filterTrades(history, { ...EMPTY_FILTER, side: 'SHORT' });
    const m = computeMetrics(shorts, 10_000);
    expect(m).toMatchObject({ totalTrades: 2, winningTrades: 0, totalPnL: -70, balance: 9_930 });
    // Two losses in a row from the starting capital: 0.7 % below the peak.
    expect(m.maxDrawdown).toBeCloseTo(0.7, 2);
  });

  it('orders the equity curve by close time, whatever the list order', () => {
    const reversed = [...history].reverse();
    expect(computeMetrics(reversed, 10_000).maxDrawdown).toBe(computeMetrics(history, 10_000).maxDrawdown);
  });

  it('reports nothing on an empty selection', () => {
    expect(computeMetrics([], 10_000)).toMatchObject({ totalTrades: 0, winRate: 0, averageR: null, totalPnL: 0 });
  });
});

describe('parseAnnotation', () => {
  it('bounds the text it keeps', () => {
    const parsed = parseAnnotation({ setup: 'x'.repeat(100), note: 'y'.repeat(3_000), emotion: 'calme' });
    expect(parsed?.setup).toHaveLength(40);
    expect(parsed?.note).toHaveLength(2_000);
  });

  it('refuses what is not an annotation', () => {
    expect(parseAnnotation('cassure')).toBeUndefined();
    expect(parseAnnotation({ setup: 42, emotion: 'furieux' })).toBeUndefined();
  });
});
