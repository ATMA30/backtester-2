import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  GripVertical,
  MousePointer,
  ArrowUpRight,
  Square,
  Layers,
  Type,
  Trash2,
  Eraser,
} from 'lucide-react';
import { useDrawingStore } from '../../store/useDrawingStore';

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

  useEffect(() => {
    isDraggingRef.current = isDragging;
  }, [isDragging]);

  useEffect(() => {
    isDimmedRef.current = isDimmed;
  }, [isDimmed]);

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
      <div className="draw-drag-handle" title="Glisser pour déplacer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <GripVertical size={13} strokeWidth={2} style={{ color: 'var(--text-muted)', opacity: 0.6 }} />
      </div>

      {/* Selection */}
      <button
        className={`draw-btn ${activeTool === 'cursor' ? 'active' : ''}`}
        id="dt-cursor"
        title="Sélection (1)"
        onClick={() => setActiveTool('cursor')}
      >
        <MousePointer size={15} strokeWidth={activeTool === 'cursor' ? 2.2 : 1.8} />
      </button>

      <div className="draw-sep-h" />

      {/* Trendline */}
      <button
        className={`draw-btn ${activeTool === 'trendline' ? 'active' : ''}`}
        id="dt-trendline"
        title="Ligne de tendance (2)"
        onClick={() => setActiveTool('trendline')}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={activeTool === 'trendline' ? "2.5" : "2"} strokeLinecap="round">
          <circle cx="4" cy="20" r="2" fill="currentColor" />
          <line x1="4" y1="20" x2="20" y2="4" />
          <circle cx="20" cy="4" r="2" fill="currentColor" />
        </svg>
      </button>

      {/* Horizontal line */}
      <button
        className={`draw-btn ${activeTool === 'hline' ? 'active' : ''}`}
        id="dt-hline"
        title="Ligne horizontale (3)"
        onClick={() => setActiveTool('hline')}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={activeTool === 'hline' ? "2.5" : "2"} strokeLinecap="round">
          <line x1="2" y1="12" x2="22" y2="12" />
          <circle cx="12" cy="12" r="2" fill="currentColor" />
        </svg>
      </button>

      {/* Vertical line */}
      <button
        className={`draw-btn ${activeTool === 'vline' ? 'active' : ''}`}
        id="dt-vline"
        title="Ligne verticale (4)"
        onClick={() => setActiveTool('vline')}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={activeTool === 'vline' ? "2.5" : "2"} strokeLinecap="round">
          <line x1="12" y1="2" x2="12" y2="22" />
          <circle cx="12" cy="12" r="2" fill="currentColor" />
        </svg>
      </button>

      {/* Ray */}
      <button
        className={`draw-btn ${activeTool === 'ray' ? 'active' : ''}`}
        id="dt-ray"
        title="Rayon (R)"
        onClick={() => setActiveTool('ray')}
      >
        <ArrowUpRight size={15} strokeWidth={activeTool === 'ray' ? 2.4 : 1.9} />
      </button>

      <div className="draw-sep-h" />

      {/* Rectangle */}
      <button
        className={`draw-btn ${activeTool === 'rect' ? 'active' : ''}`}
        id="dt-rect"
        title="Rectangle (5)"
        onClick={() => setActiveTool('rect')}
      >
        <Square size={15} strokeWidth={activeTool === 'rect' ? 2.2 : 1.8} />
      </button>

      {/* Fibonacci */}
      <button
        className={`draw-btn ${activeTool === 'fib' ? 'active' : ''}`}
        id="dt-fib"
        title="Retracement de Fibonacci (6)"
        onClick={() => setActiveTool('fib')}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          {/* Top Level (0.0) */}
          <line x1="2" y1="4" x2="22" y2="4" stroke="#94A3B8" strokeWidth="1.8" strokeLinecap="round" />
          {/* Mid Level (0.382) */}
          <line x1="2" y1="9" x2="22" y2="9" stroke="#F59E0B" strokeWidth="1.6" strokeLinecap="round" strokeDasharray="3 2" />
          {/* Golden Level (0.618) - Prominent Gold */}
          <line x1="2" y1="14" x2="22" y2="14" stroke="#EAB308" strokeWidth="2.2" strokeLinecap="round" />
          {/* Bottom Level (1.0) */}
          <line x1="2" y1="20" x2="22" y2="20" stroke="#3B82F6" strokeWidth="1.8" strokeLinecap="round" />
          {/* Dynamic Trend Anchor */}
          <line x1="4" y1="19" x2="20" y2="5" stroke="#60A5FA" strokeWidth="2" strokeLinecap="round" />
          <circle cx="4" cy="19" r="2.2" fill="#3B82F6" />
          <circle cx="20" cy="5" r="2.2" fill="#60A5FA" />
        </svg>
      </button>

      {/* Trend Channel */}
      <button
        className={`draw-btn ${activeTool === 'channel' ? 'active' : ''}`}
        id="dt-channel"
        title="Canal parallèle de tendance (8)"
        onClick={() => setActiveTool('channel')}
      >
        <Layers size={17} strokeWidth={activeTool === 'channel' ? 2.4 : 1.9} />
      </button>

      <div className="draw-sep-h" />

      {/* Position Long */}
      <button
        className={`draw-btn ${activeTool === 'pos_long' ? 'active' : ''}`}
        id="dt-pos-long"
        title="Position Long / Ratio R:R (9)"
        onClick={() => setActiveTool('pos_long')}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          {/* Profit Zone (Top Green) */}
          <rect x="3" y="3" width="18" height="8.5" rx="1.5" fill="rgba(16, 185, 129, 0.4)" stroke="#10B981" strokeWidth="1.8" />
          {/* Loss Zone (Bottom Red) */}
          <rect x="3" y="12.5" width="18" height="8.5" rx="1.5" fill="rgba(244, 63, 94, 0.4)" stroke="#F43F5E" strokeWidth="1.8" />
          {/* White Entry Line */}
          <line x1="2" y1="12" x2="22" y2="12" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" />
          {/* Bold Green Target Arrow UP */}
          <path d="M12 9V4.5M9 7L12 4L15 7" stroke="#10B981" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Position Short */}
      <button
        className={`draw-btn ${activeTool === 'pos_short' ? 'active' : ''}`}
        id="dt-pos-short"
        title="Position Short / Ratio R:R (0)"
        onClick={() => setActiveTool('pos_short')}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          {/* Loss Zone (Top Red) */}
          <rect x="3" y="3" width="18" height="8.5" rx="1.5" fill="rgba(244, 63, 94, 0.4)" stroke="#F43F5E" strokeWidth="1.8" />
          {/* Profit Zone (Bottom Green) */}
          <rect x="3" y="12.5" width="18" height="8.5" rx="1.5" fill="rgba(16, 185, 129, 0.4)" stroke="#10B981" strokeWidth="1.8" />
          {/* White Entry Line */}
          <line x1="2" y1="12" x2="22" y2="12" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" />
          {/* Bold Green Target Arrow DOWN */}
          <path d="M12 15V19.5M9 17L12 20L15 17" stroke="#10B981" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <div className="draw-sep-h" />

      {/* Text */}
      <button
        className={`draw-btn ${activeTool === 'text' ? 'active' : ''}`}
        id="dt-text"
        title="Texte d'annotation (7)"
        onClick={() => setActiveTool('text')}
      >
        <Type size={15} strokeWidth={activeTool === 'text' ? 2.4 : 1.9} />
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
        <Trash2 size={15} strokeWidth={1.8} />
      </button>

      {/* Clear all */}
      <button
        className="draw-btn danger"
        title="Effacer tous les dessins"
        onClick={clearDrawings}
      >
        <Eraser size={15} strokeWidth={1.8} />
      </button>
    </div>
  );
};
