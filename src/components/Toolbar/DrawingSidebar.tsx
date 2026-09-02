import React from 'react';
import { useDrawingStore } from '../../store/useDrawingStore';
import { DrawingTool } from '../../types/drawing';

export const DrawingSidebar: React.FC = () => {
  const { activeTool, setActiveTool, clearDrawings, removeDrawing, selectedDrawingId } = useDrawingStore();

  return (
    <div id="draw-toolbar">
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
