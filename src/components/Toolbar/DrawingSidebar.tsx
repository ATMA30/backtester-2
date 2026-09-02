import React from 'react';
import {
  MousePointer,
  TrendingUp,
  Minus,
  Square,
  ArrowUpRight,
  ArrowDownRight,
  Trash2,
  Undo2,
  Redo2,
} from 'lucide-react';
import { useDrawingStore } from '../../store/useDrawingStore';
import { DrawingTool } from '../../types/drawing';

export const DrawingSidebar: React.FC = () => {
  const {
    activeTool,
    setActiveTool,
    clearDrawings,
    undo,
    redo,
    drawings,
  } = useDrawingStore();

  const tools: Array<{ id: DrawingTool; label: string; icon: React.ReactNode }> = [
    { id: 'cursor', label: 'Curseur / Sélection', icon: <MousePointer size={17} /> },
    { id: 'trendline', label: 'Ligne de tendance', icon: <TrendingUp size={17} /> },
    { id: 'hline', label: 'Ligne Horizontale', icon: <Minus size={17} /> },
    { id: 'rect', label: 'Zone / Rectangle', icon: <Square size={17} /> },
    { id: 'pos_long', label: 'Position Long (Achat)', icon: <ArrowUpRight size={17} className="text-green" /> },
    { id: 'pos_short', label: 'Position Short (Vente)', icon: <ArrowDownRight size={17} className="text-red" /> },
  ];

  return (
    <aside className="drawing-sidebar">
      <div className="tool-group">
        {tools.map((t) => (
          <button
            key={t.id}
            className={`tool-btn ${activeTool === t.id ? 'active' : ''}`}
            onClick={() => setActiveTool(t.id)}
            title={t.label}
          >
            {t.icon}
          </button>
        ))}
      </div>

      <div className="sidebar-divider" />

      <div className="tool-group">
        <button className="tool-btn" onClick={undo} title="Annuler (Cmd+Z)">
          <Undo2 size={16} />
        </button>
        <button className="tool-btn" onClick={redo} title="Rétablir (Cmd+Shift+Z)">
          <Redo2 size={16} />
        </button>
        <button
          className="tool-btn text-red"
          onClick={clearDrawings}
          disabled={!drawings.length}
          title="Effacer tous les dessins"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </aside>
  );
};
