import React, { useEffect, useRef, useCallback, useMemo } from 'react';
import { useDrawingStore } from '../../store/useDrawingStore';
import { useMarketStore } from '../../store/useMarketStore';
import { useTradeStore } from '../../store/useTradeStore';
import { Drawing, Point } from '../../types/drawing';
import { IChartApi, ISeriesApi } from 'lightweight-charts';
import { RenderContext } from './canvas/context';
import { drawPeriodSeparators } from './canvas/separators';
import { drawTradingSessions } from './canvas/sessions';
import { drawOpenPositions, drawPendingOrders } from './canvas/trades';
import { drawPaneSeparators } from './canvas/panes';
import { drawCreationPreview, drawDrawings } from './canvas/drawings';
import { drawClosesOnlyBoundary } from './canvas/boundary';
import { closesOnlyPrefixEnd } from '../../domain/candles';
import { useChartProjection } from './canvas/useChartProjection';
import { hitTestDrawingsAt, hitTestTradeAt } from './canvas/hitTesting';
import { useCanvasInteractions } from './canvas/useCanvasInteractions';
import { SelectedDrawingToolbar } from './SelectedDrawingToolbar';
import { getInstrument } from '../../domain/instruments';
import { newId } from '../../utils/id';

interface DrawingCanvasProps {
  chart: IChartApi | null;
  mainSeries: ISeriesApi<'Candlestick' | 'Bar' | 'Line' | 'Area'> | null;
  width: number;
  height: number;
}

export const DrawingCanvas: React.FC<DrawingCanvasProps> = ({
  chart,
  mainSeries,
  width,
  height,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const {
    drawings,
    activeTool,
    selectedDrawingId,
    currentStyle,
    addDrawing,
    selectDrawing,
  } = useDrawingStore();

  const {
    baseCandles,
    displayCandles,
    sortedTimes,
    baseTF,
    activeTF,
    currentSymbol,
    separatorTF,
    forexSessions,
    activeIndicators,
  } = useMarketStore();

  const { openPositions, pendingOrders } = useTradeStore();

  /**
   * Pip size and price precision for the active instrument.
   *
   * Resolved once here instead of the eleven inline
   * `currentSymbol.includes('JPY') ? 0.01 : 0.0001` / `price > 500 ? 2 : 5`
   * derivations this file used to carry — those disagreed with the sizing rules
   * in the trade store and mis-rendered gold, indices and crypto.
   */
  const instrument = useMemo(
    () => getInstrument(currentSymbol, displayCandles[displayCandles.length - 1]?.close),
    [currentSymbol, displayCandles]
  );

  const drawPtsRef = useRef<Point[]>([]);
  /** Measured on the base series: aggregating closes into weeks makes up wicks. */
  const closesOnlyBefore = useMemo(() => closesOnlyPrefixEnd(baseCandles), [baseCandles]);

  // Coordinates, hit tests and mouse handling live in `canvas/`; this component
  // owns the canvas element, the render loop and the wiring between them.
  const { getBarSpacingPx, toXY, fromXY } = useChartProjection({ chart, mainSeries, sortedTimes, displayCandles, activeTF, baseTF });

  // ── HIT TESTING FOR POSITION & PENDING ORDER LINES / BUTTONS ──
  const hitTestTrade = useCallback(
    (mx: number, my: number) => hitTestTradeAt({ openPositions, pendingOrders, mainSeries, width }, mx, my),
    [openPositions, pendingOrders, mainSeries, width]
  );

  // ── HIT TESTING FUNCTION ──────────────────────────────────
  const hitTest = useCallback(
    (mx: number, my: number) => hitTestDrawingsAt({ drawings, selectedDrawingId, toXY, width, height }, mx, my),
    [drawings, selectedDrawingId, toXY, width, height]
  );

  // ── DRAWING CANVAS REDRAW ─────────────────────────────────
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !chart || !mainSeries) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // ── 0. CALCULATE VISIBLE CANDLE RANGE ───────────────────
    let startIdx = 1;
    let endIdx = displayCandles.length - 1;
    if (chart && displayCandles.length > 0) {
      const visibleRange = chart.timeScale().getVisibleRange();
      if (visibleRange && typeof visibleRange.from === 'number' && typeof visibleRange.to === 'number') {
        const fromT = visibleRange.from;
        const toT = visibleRange.to;
        let l = 0, r = displayCandles.length - 1;
        while (l <= r) {
          const mid = (l + r) >> 1;
          if (displayCandles[mid].time < fromT) l = mid + 1;
          else r = mid - 1;
        }
        startIdx = Math.max(1, l - 5);

        l = 0; r = displayCandles.length - 1;
        while (l <= r) {
          const mid = (l + r) >> 1;
          if (displayCandles[mid].time <= toT) l = mid + 1;
          else r = mid - 1;
        }
        endIdx = Math.min(displayCandles.length - 1, l + 5);
      }
    }


    // Chaque couche est une fonction pure de `chart/canvas/`, dans l'ordre de
    // peinture : ce qui est dessiné après recouvre ce qui l'a été avant.
    const rc: RenderContext = {
      ctx, dpr, width, height, startIdx, endIdx, displayCandles, toXY, getBarSpacingPx, mainSeries,
      instrument, currentSymbol, separatorTF, forexSessions, activeTF, baseTF, openPositions,
      pendingOrders, activeIndicators, drawings, selectedDrawingId, activeTool, currentStyle,
      drawPts: drawPtsRef.current,
      closesOnlyBefore,
    };
    drawPeriodSeparators(rc);
    drawTradingSessions(rc);
    drawOpenPositions(rc);
    drawPendingOrders(rc);
    drawPaneSeparators(rc);
    drawDrawings(rc);
    drawCreationPreview(rc);
    drawClosesOnlyBoundary(rc);
  }, [closesOnlyBefore, drawings, selectedDrawingId, activeTool, currentStyle, toXY, width, height, mainSeries, separatorTF, forexSessions, openPositions, pendingOrders, displayCandles, getBarSpacingPx, chart, activeIndicators, activeTF, baseTF, instrument, currentSymbol]);

  useEffect(() => {
    redraw();
  }, [redraw, width, height, sortedTimes, displayCandles, separatorTF, forexSessions, activeTF, activeIndicators, pendingOrders]);

  // Pan and zoom emit range changes far faster than one per frame. Coalesce
  // them into a single pending frame and cancel it on cleanup — the previous
  // version queued an unbounded number of callbacks, and any still in flight
  // after unmount drew into a detached canvas.
  useEffect(() => {
    if (!chart) return;

    let frame: number | null = null;
    const handler = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        redraw();
      });
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(handler);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handler);
    };
  }, [chart, redraw]);

  const { handleMouseDown, handleMouseMove, handleMouseUp, handleWheel, textDraft, setTextDraft } = useCanvasInteractions({
    canvasRef,
    drawPtsRef,
    fromXY,
    hitTestTrade,
    hitTest,
    instrument,
    redraw,
  });

  return (
    <div className="draw-canvas-layer">
      <canvas
        ref={canvasRef}
        id="draw-canvas"
        width={width * (window.devicePixelRatio || 1)}
        height={height * (window.devicePixelRatio || 1)}
        className="active"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: `${width}px`,
          height: `${height}px`,
          pointerEvents: 'auto',
          zIndex: 10,
          cursor: activeTool === 'cursor' ? 'default' : 'crosshair',
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
      />

      {textDraft && (
        <input
          className="annotation-input"
          autoFocus
          placeholder="Texte de l’annotation — Entrée pour valider"
          aria-label="Texte de l’annotation"
          style={{ left: `${textDraft.x}px`, top: `${textDraft.y}px` }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              // Vider d'abord : le démontage peut encore émettre un `blur`,
              // qui validerait sinon le texte qu'on vient d'abandonner.
              e.currentTarget.value = '';
              setTextDraft(null);
            } else if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          onBlur={(e) => {
            const text = e.currentTarget.value.trim();
            const draft = textDraft;
            setTextDraft(null);
            if (!text) return;
            const newD: Drawing = {
              id: newId('draw'),
              type: 'text',
              pts: [draft.pt],
              style: { ...currentStyle, text },
            };
            addDrawing(newD);
            selectDrawing(newD.id);
          }}
        />
      )}

      {/* Floating Action Toolbar for Selected Drawing */}
      <SelectedDrawingToolbar toXY={toXY} width={width} height={height} instrument={instrument} />
    </div>
  );
};
