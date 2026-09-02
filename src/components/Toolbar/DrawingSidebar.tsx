import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useDrawingStore } from '../../store/useDrawingStore';
import { DrawingTool } from '../../types/drawing';

const STORAGE_KEY = 'tv_draw_toolbar_pos';
const SNAP_THRESHOLD = 20; // Magnetic snapping zone: within 20px of screen edges
const SNAP_MARGIN = 14;     // Margin when snapped to edge
const TOPBAR_HEIGHT = 46;

export const DrawingSidebar: React.FC = () => {
  const { activeTool, setActiveTool, clearDrawings, removeDrawing, selectedDrawingId } = useDrawingStore();

  // Position state (persisted in localStorage)
  const [position, setPosition] = useState<{ x: number; y: number }>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
          return { x: parsed.x, y: parsed.y };
        }
      }
    } catch {
      // ignore
    }
    return { x: 14, y: 60 };
  });

  const [isDimmed, setIsDimmed] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isSnapped, setIsSnapped] = useState<boolean>(false);

  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const fadeTimerRef = useRef<number | null>(null);
  const isDraggingRef = useRef<boolean>(false);
  const isDimmedRef = useRef<boolean>(false);
  const dragStartRef = useRef<{ pointerX: number; pointerY: number; posX: number; posY: number }>({
    pointerX: 0,
    pointerY: 0,
    posX: 0,
    posY: 0,
  });

  isDraggingRef.current = isDragging;
  isDimmedRef.current = isDimmed;

  // ── CLAMP & MAGNETISM (SNAPPING) HELPER ─────────────────────
  const clampAndSnap = useCallback((rawX: number, rawY: number) => {
    const el = toolbarRef.current;
    const w = el ? el.offsetWidth : 44;
    const h = el ? el.offsetHeight : 450;
    const winW = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const winH = typeof window !== 'undefined' ? window.innerHeight : 800;

    let x = rawX;
    let y = rawY;
    let snapped = false;

    // Left magnetic edge (<20px from edge)
    if (x < SNAP_THRESHOLD) {
      x = SNAP_MARGIN;
      snapped = true;
    }
    // Right magnetic edge (<20px from edge)
    else if (winW - (x + w) < SNAP_THRESHOLD) {
      x = winW - w - SNAP_MARGIN;
      snapped = true;
    }

    // Top magnetic edge (below topbar)
    if (y - TOPBAR_HEIGHT < SNAP_THRESHOLD) {
      y = TOPBAR_HEIGHT + SNAP_MARGIN;
      snapped = true;
    }
    // Bottom magnetic edge
    else if (winH - (y + h) < SNAP_THRESHOLD) {
      y = winH - h - SNAP_MARGIN;
      snapped = true;
    }

    // Strict boundary clamping so toolbar never gets lost off-screen
    const maxX = Math.max(SNAP_MARGIN, winW - w - SNAP_MARGIN);
    const maxY = Math.max(TOPBAR_HEIGHT + SNAP_MARGIN, winH - h - SNAP_MARGIN);
    x = Math.max(SNAP_MARGIN, Math.min(x, maxX));
    y = Math.max(TOPBAR_HEIGHT + 4, Math.min(y, maxY));

    return { x, y, snapped };
  }, []);

  // ── KEEP POSITION VALID ON RESIZE / LOAD ────────────────────
  useEffect(() => {
    const handleResize = () => {
      setPosition((prev) => {
        const { x, y } = clampAndSnap(prev.x, prev.y);
        return { x, y };
      });
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [clampAndSnap]);

  // ── ADAPTIVE OPACITY (2s IDLE -> 40%, < 50px PROXIMITY -> 100%) ──
  useEffect(() => {
    const handlePointerMove = (e: PointerEvent | MouseEvent) => {
      if (isDraggingRef.current) {
        if (fadeTimerRef.current) {
          clearTimeout(fadeTimerRef.current);
          fadeTimerRef.current = null;
        }
        setIsDimmed(false);
        return;
      }

      const el = toolbarRef.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      const dx = Math.max(rect.left - e.clientX, 0, e.clientX - rect.right);
      const dy = Math.max(rect.top - e.clientY, 0, e.clientY - rect.bottom);
      const distance = Math.hypot(dx, dy);

      if (distance <= 50) {
        // Immediately restore 100% opacity
        if (fadeTimerRef.current) {
          clearTimeout(fadeTimerRef.current);
          fadeTimerRef.current = null;
        }
        setIsDimmed(false);
      } else {
        // Beyond 50px: schedule 40% dimming after 2 seconds of inactivity
        if (!fadeTimerRef.current && !isDimmedRef.current) {
          fadeTimerRef.current = window.setTimeout(() => {
            setIsDimmed(true);
            fadeTimerRef.current = null;
          }, 2000);
        }
      }
    };

    // Initial 2s timer on mount
    fadeTimerRef.current = window.setTimeout(() => {
      setIsDimmed(true);
      fadeTimerRef.current = null;
    }, 2000);

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      if (fadeTimerRef.current) {
        clearTimeout(fadeTimerRef.current);
      }
    };
  }, []);

  // ── DRAG HANDLER ────────────────────────────────────────────
  const handlePointerDown = (e: React.PointerEvent) => {
    // If clicking on an action button, do not start drag
    if ((e.target as HTMLElement).closest('.draw-btn')) return;

    e.preventDefault();
    if (fadeTimerRef.current) {
      clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
    setIsDimmed(false);
    setIsDragging(true);

    dragStartRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      posX: position.x,
      posY: position.y,
    };

    const handlePointerMove = (moveEvt: PointerEvent) => {
      const rawX = dragStartRef.current.posX + (moveEvt.clientX - dragStartRef.current.pointerX);
      const rawY = dragStartRef.current.posY + (moveEvt.clientY - dragStartRef.current.pointerY);
      const { x, y, snapped } = clampAndSnap(rawX, rawY);
      setPosition({ x, y });
      setIsSnapped(snapped);
    };

    const handlePointerUp = (upEvt: PointerEvent) => {
      setIsDragging(false);
      setIsSnapped(false);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);

      const rawX = dragStartRef.current.posX + (upEvt.clientX - dragStartRef.current.pointerX);
      const rawY = dragStartRef.current.posY + (upEvt.clientY - dragStartRef.current.pointerY);
      const finalPos = clampAndSnap(rawX, rawY);
      setPosition({ x: finalPos.x, y: finalPos.y });

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: finalPos.x, y: finalPos.y }));
      } catch {
        // ignore
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const handleMouseEnter = () => {
    if (fadeTimerRef.current) {
      clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
    setIsDimmed(false);
  };

  const isNearRightEdge = typeof window !== 'undefined' && position.x > window.innerWidth - 160;

  return (
    <div
      ref={toolbarRef}
      id="draw-toolbar"
      className={`${isDimmed ? 'dimmed' : ''} ${isDragging ? 'is-dragging' : ''} ${isSnapped ? 'is-snapped' : ''} ${isNearRightEdge ? 'tooltip-left' : ''}`}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
      onPointerDown={handlePointerDown}
      onMouseEnter={handleMouseEnter}
    >
      {/* Sleek Drag Grip Handle */}
      <div className="draw-drag-handle" title="Glisser pour déplacer">
        <div className="draw-drag-grip">
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
      </div>

      {/* Selection */}
      <button
        className={`draw-btn ${activeTool === 'cursor' ? 'active' : ''}`}
        id="dt-cursor"
        title="Sélection (1)"
        onClick={() => setActiveTool('cursor')}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m4 4 7.07 17 2.51-7.39L21 11.07z" />
        </svg>
      </button>

      <div className="draw-sep-h" />

      {/* Trendline */}
      <button
        className={`draw-btn ${activeTool === 'trendline' ? 'active' : ''}`}
        id="dt-trendline"
        title="Ligne de tendance (2)"
        onClick={() => setActiveTool('trendline')}
      >
        <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <line x1="4" y1="20" x2="20" y2="4" />
        </svg>
      </button>

      {/* Horizontal line */}
      <button
        className={`draw-btn ${activeTool === 'hline' ? 'active' : ''}`}
        id="dt-hline"
        title="Ligne horizontale (3)"
        onClick={() => setActiveTool('hline')}
      >
        <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="7" x2="7" y2="7" strokeWidth="1.4" opacity="0.35" />
          <line x1="3" y1="17" x2="7" y2="17" strokeWidth="1.4" opacity="0.35" />
        </svg>
      </button>

      {/* Vertical line */}
      <button
        className={`draw-btn ${activeTool === 'vline' ? 'active' : ''}`}
        id="dt-vline"
        title="Ligne verticale (4)"
        onClick={() => setActiveTool('vline')}
      >
        <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <line x1="12" y1="3" x2="12" y2="21" />
          <line x1="7" y1="3" x2="7" y2="7" strokeWidth="1.4" opacity="0.35" />
          <line x1="17" y1="3" x2="17" y2="7" strokeWidth="1.4" opacity="0.35" />
        </svg>
      </button>

      {/* Ray */}
      <button
        className={`draw-btn ${activeTool === 'ray' ? 'active' : ''}`}
        id="dt-ray"
        title="Rayon (R)"
        onClick={() => setActiveTool('ray')}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="5" y1="19" x2="19" y2="5" />
          <polyline points="14 5 19 5 19 10" />
        </svg>
      </button>

      <div className="draw-sep-h" />

      {/* Rectangle */}
      <button
        className={`draw-btn ${activeTool === 'rect' ? 'active' : ''}`}
        id="dt-rect"
        title="Rectangle (5)"
        onClick={() => setActiveTool('rect')}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="7" width="18" height="10" rx="1.5" />
        </svg>
      </button>

      {/* Fibonacci */}
      <button
        className={`draw-btn ${activeTool === 'fib' ? 'active' : ''}`}
        id="dt-fib"
        title="Fibonacci (6)"
        onClick={() => setActiveTool('fib')}
      >
        <svg viewBox="0 0 24 24" stroke="currentColor" strokeLinecap="round">
          <line x1="3" y1="5" x2="21" y2="5" strokeWidth="2.2" />
          <line x1="3" y1="10" x2="21" y2="10" strokeWidth="1.8" />
          <line x1="3" y1="15" x2="21" y2="15" strokeWidth="1.4" opacity="0.7" />
          <line x1="3" y1="20" x2="21" y2="20" strokeWidth="2.2" />
        </svg>
      </button>

      {/* Trend Channel */}
      <button
        className={`draw-btn ${activeTool === 'channel' ? 'active' : ''}`}
        id="dt-channel"
        title="Zone de tendance (8)"
        onClick={() => setActiveTool('channel')}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 18 L9 6 L21 8 L15 20 Z" fill="currentColor" fillOpacity="0.15" />
          <line x1="3" y1="18" x2="9" y2="6" />
          <line x1="15" y1="20" x2="21" y2="8" />
        </svg>
      </button>

      <div className="draw-sep-h" />

      {/* Position Long */}
      <button
        className={`draw-btn ${activeTool === 'pos_long' ? 'active' : ''}`}
        id="dt-pos-long"
        title="Position Long (9)"
        onClick={() => setActiveTool('pos_long')}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="#00D26A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="8" fill="rgba(0,210,106,0.25)" stroke="#00D26A" />
          <rect x="3" y="11" width="18" height="10" fill="rgba(255,59,92,0.25)" stroke="#FF3B5C" />
          <line x1="3" y1="11" x2="21" y2="11" stroke="#60A5FA" strokeWidth="2" />
        </svg>
      </button>

      {/* Position Short */}
      <button
        className={`draw-btn ${activeTool === 'pos_short' ? 'active' : ''}`}
        id="dt-pos-short"
        title="Position Short (0)"
        onClick={() => setActiveTool('pos_short')}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="#FF3B5C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="10" fill="rgba(255,59,92,0.25)" stroke="#FF3B5C" />
          <rect x="3" y="13" width="18" height="8" fill="rgba(0,210,106,0.25)" stroke="#00D26A" />
          <line x1="3" y1="13" x2="21" y2="13" stroke="#F59E0B" strokeWidth="2" />
        </svg>
      </button>

      <div className="draw-sep-h" />

      {/* Text */}
      <button
        className={`draw-btn ${activeTool === 'text' ? 'active' : ''}`}
        id="dt-text"
        title="Texte (7)"
        onClick={() => setActiveTool('text')}
        style={{ fontSize: '13px', fontWeight: 700 }}
      >
        T
      </button>

      <div className="draw-sep-h" />

      {/* Delete selection */}
      <button
        className="draw-btn danger"
        title="Supprimer la sélection (Suppr)"
        onClick={() => {
          if (selectedDrawingId) removeDrawing(selectedDrawingId);
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      </button>

      {/* Clear all */}
      <button
        className="draw-btn danger"
        title="Effacer tous les dessins"
        onClick={clearDrawings}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 5H9l-7 7 7 7h11l4-4V9z" />
          <line x1="18" y1="9" x2="12" y2="15" />
          <line x1="12" y1="9" x2="18" y2="15" />
        </svg>
      </button>
    </div>
  );
};
