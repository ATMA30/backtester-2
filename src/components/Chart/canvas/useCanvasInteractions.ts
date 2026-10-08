/**
 * Mouse interaction with the drawing layer: create, select, drag and delete
 * drawings; drag stops, targets and pending orders on the chart.
 *
 * The four handlers and the refs only they use, moved out of `DrawingCanvas`
 * unchanged. The drawing and trade stores are read here directly; what the
 * component owns (canvas, projection, hit tests, redraw) comes in as input.
 */

import React, { MutableRefObject, RefObject, useRef, useState } from 'react';
import { blockTradingInThePast, currentTradingCandle } from '../../Replay/replayGuards';
import { Drawing, DrawingTool, Point } from '../../../types/drawing';
import { newId } from '../../../utils/id';
import { makeChannelPoints, moveChannelEndpoint } from '../../../domain/geometry';
import { useDrawingStore } from '../../../store/useDrawingStore';
import { useTradeStore } from '../../../store/useTradeStore';
import { InstrumentSpec } from '../../../domain/instruments';
import { hitTestDrawingsAt, hitTestTradeAt } from './hitTesting';

/**
 * Points d'un tracé à deux extrémités.
 *
 * Il existe deux voies de création — glisser-déposer et deux clics — et seule la
 * première traitait le cas du canal. La seconde produisait un canal à deux
 * points, donc d'écart nul : les deux rails se superposaient et la forme
 * s'affichait comme une simple ligne.
 */
function buildDrawingPoints(tool: DrawingTool, p0: Point, p1: Point): Point[] {
  return tool === 'channel' ? makeChannelPoints(p0, p1) : [p0, p1];
}

export interface InteractionInput {
  readonly canvasRef: RefObject<HTMLCanvasElement | null>;
  /** Points placed for the drawing being created — shared with the preview layer. */
  readonly drawPtsRef: MutableRefObject<Point[]>;
  readonly fromXY: (x: number, y: number) => Point;
  readonly hitTestTrade: (mx: number, my: number) => ReturnType<typeof hitTestTradeAt>;
  readonly hitTest: (mx: number, my: number) => ReturnType<typeof hitTestDrawingsAt>;
  readonly instrument: InstrumentSpec;
  readonly redraw: () => void;
}

export function useCanvasInteractions({ canvasRef, drawPtsRef, fromXY, hitTestTrade, hitTest, instrument, redraw }: InteractionInput) {
  const { activeTool, drawings, currentStyle, addDrawing, updateDrawing, selectDrawing, setActiveTool, commitDrawingEdit } = useDrawingStore();
  const { closeAtMarket, openPositions, updatePositionSlTp, pendingOrders, updatePendingOrder, cancelPendingOrder } = useTradeStore();

  /** The open position `id`, and a setter for its stop and target. */
  const positionControls = (id: string | undefined) => {
    const position = id ? (openPositions.find((p) => p.id === id) ?? null) : null;
    const setLevels = (sl: number | null, tp: number | null) => {
      if (position) updatePositionSlTp(position.id, sl, tp);
    };
    return { position, setLevels };
  };

  const isMouseDownRef = useRef(false);

  const mouseDownPosRef = useRef<{ x: number; y: number } | null>(null);

  const dragHandleRef = useRef<{ drawingId: string; ptIdx: number } | null>(null);

  const dragBodyRef = useRef<{ drawingId: string; startPts: Point[]; startMouse: { x: number; y: number } } | null>(null);

  const dragTradeRef = useRef<{
    type: 'ACTIVE_SL' | 'ACTIVE_TP' | 'PENDING_TARGET' | 'PENDING_SL' | 'PENDING_TP' | 'PULL_ACTIVE' | 'PULL_PENDING';
    orderId?: string;
    positionId?: string;
  } | null>(null);

  /**
   * Annotation being typed, anchored where the user clicked. A native
   * `prompt()` used to block the page with an unstyled box far from the chart.
   */
  const [textDraft, setTextDraft] = useState<{ x: number; y: number; pt: Point } | null>(null);

  // ── MOUSE EVENTS (SELECTION, DRAGGING & CREATION) ─────────
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const pt = fromXY(mx, my);

    mouseDownPosRef.current = { x: mx, y: my };
    isMouseDownRef.current = true;

    // Check click / drag on Position / Pending Order Lines or Badges
    const tradeHit = hitTestTrade(mx, my);
    if (tradeHit) {
      const pip = instrument.pip;
      // Moving a stop or closing while reviewing past candles is lookahead:
      // the user has already seen where the price goes.
      if (blockTradingInThePast()) return;
      const { position: activePosition, setLevels } = positionControls(tradeHit.positionId);

      if (tradeHit.action === 'CLOSE_ACTIVE') {
        const candle = currentTradingCandle();
        if (candle && activePosition) closeAtMarket(activePosition.id, candle.close, candle.time);
        redraw();
        return;
      }
      if (tradeHit.action === 'ADD_ACTIVE_SL' && activePosition) {
        const isLong = activePosition.type === 'LONG';
        const newSl = isLong ? activePosition.entry - pip * 25 : activePosition.entry + pip * 25;
        setLevels(newSl, activePosition.tp);
        dragTradeRef.current = { type: 'ACTIVE_SL', positionId: activePosition.id };
        redraw();
        return;
      }
      if (tradeHit.action === 'ADD_ACTIVE_TP' && activePosition) {
        const isLong = activePosition.type === 'LONG';
        const newTp = isLong ? activePosition.entry + pip * 50 : activePosition.entry - pip * 50;
        setLevels(activePosition.sl, newTp);
        dragTradeRef.current = { type: 'ACTIVE_TP', positionId: activePosition.id };
        redraw();
        return;
      }
      if (tradeHit.action === 'ADD_PENDING_SL' && tradeHit.orderId) {
        const o = pendingOrders.find((x) => x.id === tradeHit.orderId);
        if (o) {
          const isLong = o.type === 'LONG';
          const newSl = isLong ? o.targetPrice - pip * 25 : o.targetPrice + pip * 25;
          updatePendingOrder(o.id, { sl: newSl });
          dragTradeRef.current = { type: 'PENDING_SL', orderId: o.id };
        }
        redraw();
        return;
      }
      if (tradeHit.action === 'ADD_PENDING_TP' && tradeHit.orderId) {
        const o = pendingOrders.find((x) => x.id === tradeHit.orderId);
        if (o) {
          const isLong = o.type === 'LONG';
          const newTp = isLong ? o.targetPrice + pip * 50 : o.targetPrice - pip * 50;
          updatePendingOrder(o.id, { tp: newTp });
          dragTradeRef.current = { type: 'PENDING_TP', orderId: o.id };
        }
        redraw();
        return;
      }
      if (tradeHit.action === 'CLEAR_ACTIVE_SL') {
        if (activePosition) setLevels(null, activePosition.tp);
        redraw();
        return;
      }
      if (tradeHit.action === 'CLEAR_ACTIVE_TP') {
        if (activePosition) setLevels(activePosition.sl, null);
        redraw();
        return;
      }
      if (tradeHit.action === 'CANCEL_PENDING' && tradeHit.orderId) {
        cancelPendingOrder(tradeHit.orderId);
        redraw();
        return;
      }
      if (tradeHit.action === 'CLEAR_PENDING_SL' && tradeHit.orderId) {
        updatePendingOrder(tradeHit.orderId, { sl: null });
        redraw();
        return;
      }
      if (tradeHit.action === 'CLEAR_PENDING_TP' && tradeHit.orderId) {
        updatePendingOrder(tradeHit.orderId, { tp: null });
        redraw();
        return;
      }
      if (tradeHit.action === 'DRAG') {
        dragTradeRef.current = { type: tradeHit.type, orderId: tradeHit.orderId, positionId: tradeHit.positionId };
        return;
      }
    }

    if (activeTool === 'cursor') {
      const hit = hitTest(mx, my);
      if (hit) {
        selectDrawing(hit.drawingId);
        const selD = drawings.find((d) => d.id === hit.drawingId);
        if (selD) {
          if (hit.handleIdx !== null) {
            dragHandleRef.current = { drawingId: hit.drawingId, ptIdx: hit.handleIdx };
          } else {
            dragBodyRef.current = {
              drawingId: hit.drawingId,
              startPts: JSON.parse(JSON.stringify(selD.pts)),
              startMouse: { x: mx, y: my },
            };
          }
        }
        redraw();
        return;
      }

      // Click on empty space: deselect & forward mousedown to chart for panning
      selectDrawing(null);
      redraw();

      const canvas = canvasRef.current;
      if (canvas) {
        canvas.style.pointerEvents = 'none';
        const target = document.elementFromPoint(e.clientX, e.clientY);
        if (target && target !== canvas) {
          const simEvent = new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: e.clientX,
            clientY: e.clientY,
            screenX: e.screenX,
            screenY: e.screenY,
            buttons: e.buttons,
            button: e.button,
          });
          target.dispatchEvent(simEvent);
        }

        const restorePointerEvents = () => {
          if (canvasRef.current) {
            canvasRef.current.style.pointerEvents = 'auto';
          }
          window.removeEventListener('mouseup', restorePointerEvents);
        };
        window.addEventListener('mouseup', restorePointerEvents);
      }
      return;
    }

    const pip = instrument.pip;

    // Direct 1-Click Placement tools
    if (activeTool === 'pos_long' || activeTool === 'pos_short') {
      const isLong = activeTool === 'pos_long';
      const newD: Drawing = {
        id: newId('draw'),
        type: activeTool,
        pts: [
          pt,
          { time: pt.time + 3600 * 24 * 3, price: isLong ? pt.price + pip * 40 : pt.price - pip * 40 },
          { time: pt.time, price: isLong ? pt.price - pip * 20 : pt.price + pip * 20 },
        ],
        style: currentStyle,
      };
      addDrawing(newD);
      drawPtsRef.current = [];
      selectDrawing(newD.id);
      setActiveTool('cursor');
      return;
    }

    if (activeTool === 'hline') {
      const newD: Drawing = {
        id: newId('draw'),
        type: 'hline',
        pts: [pt],
        style: currentStyle,
      };
      addDrawing(newD);
      drawPtsRef.current = [];
      selectDrawing(newD.id);
      setActiveTool('cursor');
      return;
    }

    if (activeTool === 'vline') {
      const newD: Drawing = {
        id: newId('draw'),
        type: 'vline',
        pts: [pt],
        style: currentStyle,
      };
      addDrawing(newD);
      drawPtsRef.current = [];
      selectDrawing(newD.id);
      setActiveTool('cursor');
      return;
    }

    if (activeTool === 'text') {
      setTextDraft({ x: mx, y: my, pt });
      drawPtsRef.current = [];
      setActiveTool('cursor');
      return;
    }

    // 2-Point Placement tools
    if (drawPtsRef.current.length === 0) {
      drawPtsRef.current = [pt, pt];
      redraw();
    } else {
      const p0 = drawPtsRef.current[0];
      const newD: Drawing = {
        id: newId('draw'),
        type: activeTool,
        pts: buildDrawingPoints(activeTool, p0, pt),
        style: currentStyle,
      };
      addDrawing(newD);
      drawPtsRef.current = [];
      selectDrawing(newD.id);
      setActiveTool('cursor');
      redraw();
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const pt = fromXY(mx, my);

    // 0. Dragging Active Trade / Pending Order Lines
    if (dragTradeRef.current && isMouseDownRef.current) {
      const pip = instrument.pip;
      const minDistance = pip * 2;
      const { type, orderId, positionId } = dragTradeRef.current;
      const { position: activePosition, setLevels } = positionControls(positionId);

      if (type === 'ACTIVE_SL' && activePosition) {
        const isLong = activePosition.type === 'LONG';
        const validSl = isLong
          ? Math.min(activePosition.entry - minDistance, pt.price)
          : Math.max(activePosition.entry + minDistance, pt.price);
        setLevels(validSl, activePosition.tp);
      } else if (type === 'ACTIVE_TP' && activePosition) {
        const isLong = activePosition.type === 'LONG';
        const validTp = isLong
          ? Math.max(activePosition.entry + minDistance, pt.price)
          : Math.min(activePosition.entry - minDistance, pt.price);
        setLevels(activePosition.sl, validTp);
      } else if (type === 'PULL_ACTIVE' && activePosition) {
        const isLong = activePosition.type === 'LONG';
        const delta = pt.price - activePosition.entry;
        if (Math.abs(delta) >= minDistance) {
          if (delta > 0) {
            // Above entry: TP for LONG, SL for SHORT
            if (isLong) {
              setLevels(activePosition.sl, Math.max(activePosition.entry + minDistance, pt.price));
            } else {
              setLevels(Math.max(activePosition.entry + minDistance, pt.price), activePosition.tp);
            }
          } else {
            // Below entry: SL for LONG, TP for SHORT
            if (isLong) {
              setLevels(Math.min(activePosition.entry - minDistance, pt.price), activePosition.tp);
            } else {
              setLevels(activePosition.sl, Math.min(activePosition.entry - minDistance, pt.price));
            }
          }
        }
      } else if (type === 'PENDING_TARGET' && orderId) {
        updatePendingOrder(orderId, { targetPrice: pt.price });
      } else if (type === 'PENDING_SL' && orderId) {
        const order = pendingOrders.find((o) => o.id === orderId);
        if (order) {
          const isLong = order.type === 'LONG';
          const validSl = isLong
            ? Math.min(order.targetPrice - minDistance, pt.price)
            : Math.max(order.targetPrice + minDistance, pt.price);
          updatePendingOrder(orderId, { sl: validSl });
        }
      } else if (type === 'PENDING_TP' && orderId) {
        const order = pendingOrders.find((o) => o.id === orderId);
        if (order) {
          const isLong = order.type === 'LONG';
          const validTp = isLong
            ? Math.max(order.targetPrice + minDistance, pt.price)
            : Math.min(order.targetPrice - minDistance, pt.price);
          updatePendingOrder(orderId, { tp: validTp });
        }
      } else if (type === 'PULL_PENDING' && orderId) {
        const order = pendingOrders.find((o) => o.id === orderId);
        if (order) {
          const isLong = order.type === 'LONG';
          const delta = pt.price - order.targetPrice;
          if (Math.abs(delta) >= minDistance) {
            if (delta > 0) {
              // Above target: TP for BUY, SL for SELL
              if (isLong) {
                updatePendingOrder(orderId, { tp: Math.max(order.targetPrice + minDistance, pt.price) });
              } else {
                updatePendingOrder(orderId, { sl: Math.max(order.targetPrice + minDistance, pt.price) });
              }
            } else {
              // Below target: SL for BUY, TP for SELL
              if (isLong) {
                updatePendingOrder(orderId, { sl: Math.min(order.targetPrice - minDistance, pt.price) });
              } else {
                updatePendingOrder(orderId, { tp: Math.min(order.targetPrice - minDistance, pt.price) });
              }
            }
          }
        }
      }

      redraw();
      return;
    }

    // 1. Dragging a handle
    if (dragHandleRef.current && isMouseDownRef.current) {
      const { drawingId, ptIdx } = dragHandleRef.current;
      const d = drawings.find((item) => item.id === drawingId);
      if (d) {
        if (d.type === 'pos_long' || d.type === 'pos_short') {
          const isLong = d.type === 'pos_long';
          const pip = instrument.pip;
          const minDistance = pip * 2;
          const newPts = [...d.pts];
          const entryPrice = newPts[0].price;

          if (ptIdx === 0) {
            // Dragging Entry:
            const newEntry = pt.price;
            const deltaPrice = newEntry - entryPrice;
            newPts[0] = { time: pt.time, price: newEntry };
            // Move TP & SL synchronously to maintain pip distance
            newPts[1] = { time: newPts[1].time, price: newPts[1].price + deltaPrice };
            newPts[2] = { time: pt.time, price: newPts[2].price + deltaPrice };
          } else if (ptIdx === 1) {
            // Dragging TP (Take Profit):
            // LONG: TP MUST BE > ENTRY
            // SHORT: TP MUST BE < ENTRY
            const validTp = isLong
              ? Math.max(entryPrice + minDistance, pt.price)
              : Math.min(entryPrice - minDistance, pt.price);
            const validTime = Math.max(newPts[0].time + 60, pt.time);
            newPts[1] = { time: validTime, price: validTp };
          } else if (ptIdx === 2) {
            // Dragging SL (Stop Loss):
            // LONG: SL MUST BE < ENTRY
            // SHORT: SL MUST BE > ENTRY
            const validSl = isLong
              ? Math.min(entryPrice - minDistance, pt.price)
              : Math.max(entryPrice + minDistance, pt.price);
            newPts[2] = { time: newPts[0].time, price: validSl };
          } else if (ptIdx === 5) {
            // Dragging Right edge width only
            const validTime = Math.max(newPts[0].time + 60, pt.time);
            newPts[1] = { time: validTime, price: newPts[1].price };
          }

          updateDrawing(drawingId, { pts: newPts });
          redraw();
          return;
        }

        // Moving a channel endpoint must carry the width anchor with it,
        // otherwise the offset is recomputed against the new baseline and the
        // band collapses or flips as the slope changes.
        if (d.type === 'channel' && (ptIdx === 0 || ptIdx === 1)) {
          updateDrawing(drawingId, { pts: moveChannelEndpoint(d.pts, ptIdx, pt) });
          redraw();
          return;
        }

        const newPts = [...d.pts];
        newPts[ptIdx] = pt;
        updateDrawing(drawingId, { pts: newPts });
        redraw();
      }
      return;
    }

    // 2. Dragging a drawing body
    if (dragBodyRef.current && isMouseDownRef.current) {
      const { drawingId, startPts, startMouse } = dragBodyRef.current;
      const pStart = fromXY(startMouse.x, startMouse.y);
      const deltaTime = pt.time - pStart.time;
      const deltaPrice = pt.price - pStart.price;

      const newPts = startPts.map((p) => ({
        time: p.time + deltaTime,
        price: p.price + deltaPrice,
      }));
      updateDrawing(drawingId, { pts: newPts });
      redraw();
      return;
    }

    // 3. Live drawing preview
    if (drawPtsRef.current.length >= 2 && activeTool !== 'cursor') {
      drawPtsRef.current[1] = pt;
      redraw();
      return;
    }

    // 4. Cursor feedback on hover
    if (activeTool === 'cursor' && canvasRef.current && !isMouseDownRef.current) {
      const tradeHit = hitTestTrade(mx, my);
      if (tradeHit) {
        if (tradeHit.action.startsWith('CLOSE') || tradeHit.action.startsWith('CANCEL') || tradeHit.action.startsWith('CLEAR')) {
          canvasRef.current.style.cursor = 'pointer';
        } else {
          canvasRef.current.style.cursor = 'ns-resize';
        }
        return;
      }

      const hit = hitTest(mx, my);
      if (hit) {
        if (hit.handleIdx === 1 || hit.handleIdx === 2 || hit.handleIdx === 0) {
          canvasRef.current.style.cursor = 'ns-resize';
        } else if (hit.handleIdx === 5) {
          canvasRef.current.style.cursor = 'ew-resize';
        } else if (hit.handleIdx !== null) {
          canvasRef.current.style.cursor = 'grab';
        } else {
          canvasRef.current.style.cursor = 'move';
        }
      } else {
        canvasRef.current.style.cursor = 'default';
      }
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isMouseDownRef.current) return;
    isMouseDownRef.current = false;

    // Dragging a shape mutated it through `updateDrawing`, which never touched
    // the history — so Ctrl+Z skipped the move entirely and jumped to the state
    // before it. Close the gesture with a single undo step.
    const wasDraggingShape = dragHandleRef.current !== null || dragBodyRef.current !== null;

    dragHandleRef.current = null;
    dragBodyRef.current = null;
    dragTradeRef.current = null;

    if (wasDraggingShape) commitDrawingEdit();

    if (!mouseDownPosRef.current) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const dragDist = Math.hypot(mx - mouseDownPosRef.current.x, my - mouseDownPosRef.current.y);

    if (dragDist > 8 && drawPtsRef.current.length >= 2 && activeTool !== 'cursor') {
      const p0 = drawPtsRef.current[0];
      const p1 = drawPtsRef.current[1];
      const newD: Drawing = {
        id: newId('draw'),
        type: activeTool,
        pts: buildDrawingPoints(activeTool, p0, p1),
        style: currentStyle,
      };
      addDrawing(newD);
      drawPtsRef.current = [];
      selectDrawing(newD.id);
      setActiveTool('cursor');
      redraw();
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.style.pointerEvents = 'none';
    const target = document.elementFromPoint(e.clientX, e.clientY);
    canvas.style.pointerEvents = 'auto';
    if (target && target !== canvas) {
      const simWheel = new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: e.clientX,
        clientY: e.clientY,
        screenX: e.screenX,
        screenY: e.screenY,
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        deltaZ: e.deltaZ,
        deltaMode: e.deltaMode,
      });
      target.dispatchEvent(simWheel);
    }
  };

  return { handleMouseDown, handleMouseMove, handleMouseUp, handleWheel, textDraft, setTextDraft };
}
