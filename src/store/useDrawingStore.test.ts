import { beforeEach, describe, expect, it } from 'vitest';
import { useDrawingStore } from './useDrawingStore';
import { Drawing } from '../types/drawing';

function makeTrendline(id: string): Drawing {
  return {
    id,
    type: 'trendline',
    pts: [
      { time: 0, price: 0 },
      { time: 1, price: 1 },
    ],
    style: { color: '#3B82F6', width: 2 },
  };
}

describe('useDrawingStore symbol scoping', () => {
  beforeEach(() => {
    localStorage.clear();
    useDrawingStore.setState({
      drawingsBySymbol: {},
      activeSymbol: 'EURUSD',
      drawings: [],
      history: [[]],
      historyIndex: 0,
      selectedDrawingId: null,
    });
  });

  it('does not leak drawings from one symbol to another', () => {
    useDrawingStore.getState().addDrawing(makeTrendline('a'));
    expect(useDrawingStore.getState().drawings).toHaveLength(1);

    useDrawingStore.getState().setActiveSymbol('VOLATILITY100');
    expect(useDrawingStore.getState().drawings).toHaveLength(0);

    useDrawingStore.getState().addDrawing(makeTrendline('b'));
    expect(useDrawingStore.getState().drawings.map((d) => d.id)).toEqual(['b']);

    useDrawingStore.getState().setActiveSymbol('EURUSD');
    expect(useDrawingStore.getState().drawings.map((d) => d.id)).toEqual(['a']);
  });

  it('persists each symbol drawing list separately to localStorage', () => {
    useDrawingStore.getState().addDrawing(makeTrendline('a'));
    useDrawingStore.getState().setActiveSymbol('VOLATILITY100');
    useDrawingStore.getState().addDrawing(makeTrendline('b'));

    const stored = JSON.parse(localStorage.getItem('tv_pro_drawings') as string);
    expect(stored.EURUSD.map((d: Drawing) => d.id)).toEqual(['a']);
    expect(stored.VOLATILITY100.map((d: Drawing) => d.id)).toEqual(['b']);
  });

  it('forgets a deleted symbol without touching the others', () => {
    useDrawingStore.getState().addDrawing(makeTrendline('a'));
    useDrawingStore.getState().setActiveSymbol('VOLATILITY100');
    useDrawingStore.getState().addDrawing(makeTrendline('b'));

    useDrawingStore.getState().removeSymbolData('VOLATILITY100');
    expect(useDrawingStore.getState().drawings).toHaveLength(0);

    useDrawingStore.getState().setActiveSymbol('EURUSD');
    expect(useDrawingStore.getState().drawings.map((d) => d.id)).toEqual(['a']);
  });
});
