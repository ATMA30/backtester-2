import { beforeEach, describe, expect, it } from 'vitest';
import { flushDrawingPersistence, parseDrawings, useDrawingStore } from './useDrawingStore';
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

    // Writes are debounced to keep drag gestures smooth; force the flush.
    flushDrawingPersistence();

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

describe('useDrawingStore validation and history', () => {
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

  it('drops malformed drawings coming from an untrusted session file', () => {
    const parsed = parseDrawings([
      makeTrendline('ok'),
      { id: 'no-points', type: 'trendline', pts: [], style: { color: '#fff', width: 1 } },
      { id: 'bad-coords', type: 'rect', pts: [{ time: NaN, price: 1 }], style: { color: '#fff', width: 1 } },
      { id: 'unknown-tool', type: 'wormhole', pts: [{ time: 1, price: 1 }], style: { color: '#fff', width: 1 } },
      null,
    ]);

    expect(parsed.map((d) => d.id)).toEqual(['ok']);
  });

  it('does not resolve inherited members for exotic symbol names', () => {
    // `map['toString']` used to return a function, and the canvas then crashed
    // on `drawings.map is not a function`.
    useDrawingStore.getState().setActiveSymbol('toString');
    expect(useDrawingStore.getState().drawings).toEqual([]);
  });

  it('records one undo step per deletion', () => {
    const store = useDrawingStore.getState();
    store.addDrawing(makeTrendline('a'));
    store.removeDrawing('a');
    expect(useDrawingStore.getState().drawings).toHaveLength(0);

    // A second delete of the same id must not push a redundant history entry —
    // App and DrawingCanvas both listened for Delete, so undo needed two presses.
    useDrawingStore.getState().removeDrawing('a');
    useDrawingStore.getState().undo();
    expect(useDrawingStore.getState().drawings.map((d) => d.id)).toEqual(['a']);
  });
});

describe('useDrawingStore — réparation des canaux', () => {
  it('redonne une largeur à un canal enregistré à deux points', () => {
    // Régression : la création en deux clics produisait un canal sans son
    // troisième point. Écart nul, rails confondus, rendu en simple ligne.
    const [repaired] = parseDrawings([
      {
        id: 'chan-legacy',
        type: 'channel',
        pts: [
          { time: 0, price: 100 },
          { time: 10, price: 110 },
        ],
        style: { color: '#3B82F6', width: 2 },
      },
    ]);

    expect(repaired.pts).toHaveLength(3);
    expect(repaired.pts[0]).toEqual({ time: 0, price: 100 });
    expect(repaired.pts[1]).toEqual({ time: 10, price: 110 });
  });

  it('laisse intact un canal déjà complet', () => {
    const pts = [
      { time: 0, price: 100 },
      { time: 10, price: 110 },
      { time: 5, price: 102 },
    ];
    const [kept] = parseDrawings([
      { id: 'chan', type: 'channel', pts, style: { color: '#3B82F6', width: 2 } },
    ]);
    expect(kept.pts).toEqual(pts);
  });

  it('ne touche pas aux autres outils à deux points', () => {
    const [line] = parseDrawings([
      {
        id: 'tl',
        type: 'trendline',
        pts: [
          { time: 0, price: 100 },
          { time: 10, price: 110 },
        ],
        style: { color: '#3B82F6', width: 2 },
      },
    ]);
    expect(line.pts).toHaveLength(2);
  });

  it('clearAllSymbolsDrawings efface les dessins de tous les symboles et le stockage', () => {
    useDrawingStore.getState().addDrawing(makeTrendline('a'));
    useDrawingStore.getState().setActiveSymbol('VOLATILITY100');
    useDrawingStore.getState().addDrawing(makeTrendline('b'));

    flushDrawingPersistence();
    expect(localStorage.getItem('tv_pro_drawings')).not.toBeNull();

    useDrawingStore.getState().clearAllSymbolsDrawings();

    expect(useDrawingStore.getState().drawings).toHaveLength(0);
    expect(useDrawingStore.getState().drawingsBySymbol).toEqual({});
    expect(localStorage.getItem('tv_pro_drawings')).toBeNull();
  });
});
