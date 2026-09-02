import { create } from 'zustand';
import { Drawing, DrawingTool, DrawingStyle } from '../types/drawing';

interface DrawingState {
  drawings: Drawing[];
  activeTool: DrawingTool;
  selectedDrawingId: string | null;
  history: Drawing[][];
  historyIndex: number;
  currentStyle: DrawingStyle;

  setActiveTool: (tool: DrawingTool) => void;
  addDrawing: (drawing: Drawing) => void;
  updateDrawing: (id: string, updates: Partial<Drawing>) => void;
  removeDrawing: (id: string) => void;
  clearDrawings: () => void;
  selectDrawing: (id: string | null) => void;
  setCurrentStyle: (style: Partial<DrawingStyle>) => void;
  undo: () => void;
  redo: () => void;
}

export const useDrawingStore = create<DrawingState>((set, get) => ({
  drawings: [],
  activeTool: 'cursor',
  selectedDrawingId: null,
  history: [[]],
  historyIndex: 0,
  currentStyle: {
    color: '#3B82F6',
    width: 2,
    fill: 'rgba(59, 130, 246, 0.12)',
    fillOpacity: 0.12,
  },

  setActiveTool: (activeTool) => set({ activeTool, selectedDrawingId: null }),
  
  addDrawing: (drawing) => {
    const { drawings, history, historyIndex } = get();
    const newDrawings = [...drawings, drawing];
    const newHistory = [...history.slice(0, historyIndex + 1), newDrawings];
    set({
      drawings: newDrawings,
      history: newHistory,
      historyIndex: newHistory.length - 1,
      selectedDrawingId: drawing.id,
      activeTool: 'cursor',
    });
  },

  updateDrawing: (id, updates) => {
    const { drawings } = get();
    const newDrawings = drawings.map((d) => (d.id === id ? { ...d, ...updates } : d));
    set({ drawings: newDrawings });
  },

  removeDrawing: (id) => {
    const { drawings, history, historyIndex } = get();
    const newDrawings = drawings.filter((d) => d.id !== id);
    const newHistory = [...history.slice(0, historyIndex + 1), newDrawings];
    set({
      drawings: newDrawings,
      history: newHistory,
      historyIndex: newHistory.length - 1,
      selectedDrawingId: null,
    });
  },

  clearDrawings: () => {
    const { history, historyIndex } = get();
    const newHistory = [...history.slice(0, historyIndex + 1), []];
    set({
      drawings: [],
      history: newHistory,
      historyIndex: newHistory.length - 1,
      selectedDrawingId: null,
    });
  },

  selectDrawing: (selectedDrawingId) => set({ selectedDrawingId }),

  setCurrentStyle: (style) =>
    set((state) => ({ currentStyle: { ...state.currentStyle, ...style } })),

  undo: () => {
    const { history, historyIndex } = get();
    if (historyIndex > 0) {
      const nextIndex = historyIndex - 1;
      set({
        drawings: history[nextIndex],
        historyIndex: nextIndex,
        selectedDrawingId: null,
      });
    }
  },

  redo: () => {
    const { history, historyIndex } = get();
    if (historyIndex < history.length - 1) {
      const nextIndex = historyIndex + 1;
      set({
        drawings: history[nextIndex],
        historyIndex: nextIndex,
        selectedDrawingId: null,
      });
    }
  },
}));
