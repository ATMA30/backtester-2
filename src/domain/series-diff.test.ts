import { describe, expect, it } from 'vitest';
import { MAX_TAIL_APPEND, droppedLeadingBars, isTailUpdate } from './series-diff';
import { ReplayAggregator } from './replay-aggregator';
import { TimeframeSeconds } from './timeframes';
import { Candle } from '../types/market';

const bar = (time: number): Candle => ({ time, open: 1, high: 1, low: 1, close: 1, volume: 0 });
const bars = (n: number, from = 0) => Array.from({ length: n }, (_, i) => bar(from + i * 60));

describe('isTailUpdate', () => {
  const prev = bars(10);

  it('accepts the last bar replaced in place', () => {
    const next = [...prev.slice(0, 9), { ...prev[9], close: 2 }];
    expect(isTailUpdate(prev, next)).toBe(true);
  });

  it('accepts one or a few bars appended', () => {
    expect(isTailUpdate(prev, [...prev, bar(600)])).toBe(true);
    expect(isTailUpdate(prev, [...prev, ...bars(MAX_TAIL_APPEND, 600)])).toBe(true);
  });

  it('refuses more bars than a tick produces', () => {
    expect(isTailUpdate(prev, [...prev, ...bars(MAX_TAIL_APPEND + 1, 600)])).toBe(false);
  });

  it('refuses a series whose finished bars are other objects', () => {
    // Same values, new objects: the series was rebuilt, not advanced.
    expect(isTailUpdate(prev, prev.map((c) => ({ ...c })))).toBe(false);
  });

  it('refuses a shorter series and one whose window slid', () => {
    expect(isTailUpdate(prev, prev.slice(0, 9))).toBe(false);
    expect(isTailUpdate(prev, [...prev.slice(1), bar(600)])).toBe(false);
  });

  it('refuses too short a history to compare', () => {
    expect(isTailUpdate(bars(1), bars(2))).toBe(false);
  });

  it('holds on what the replay aggregator really produces, tick after tick', () => {
    const base = bars(600);
    const agg = new ReplayAggregator();
    let previous = agg.advance(base, 100, TimeframeSeconds.M15, TimeframeSeconds.M1);
    for (let i = 101; i < 400; i++) {
      const next = agg.advance(base, i, TimeframeSeconds.M15, TimeframeSeconds.M1);
      expect(isTailUpdate(previous, next)).toBe(true);
      previous = next;
    }
  });
});

describe('droppedLeadingBars', () => {
  const prev = bars(10);

  it('is 0 when the window did not move', () => {
    expect(droppedLeadingBars(prev, [...prev, bar(600)])).toBe(0);
    expect(droppedLeadingBars(null, prev)).toBe(0);
  });

  it('counts the bars that left on the left', () => {
    expect(droppedLeadingBars(prev, prev.slice(4))).toBe(4);
  });

  it('matches the chunk the replay window slides by', () => {
    const base = bars(300);
    const agg = new ReplayAggregator(100, 20);
    const before = agg.advance(base, 99, TimeframeSeconds.M1, TimeframeSeconds.M1);
    const after = agg.advance(base, 100, TimeframeSeconds.M1, TimeframeSeconds.M1);
    expect(droppedLeadingBars(before, after)).toBe(20);
    // The very same candle, 20 places lower.
    expect(after[before.length - 1 - 20]).toBe(before[before.length - 1]);
  });
});
