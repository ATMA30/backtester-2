/**
 * Floating toolbar of the selected drawing: colour, duplicate, delete.
 *
 * Positioned next to the shape (beside a long/short position box, above any
 * other drawing) and kept inside the chart. Extracted from `DrawingCanvas`.
 */

import { Copy, Trash2 } from 'lucide-react';
import { Drawing } from '../../types/drawing';
import { newId } from '../../utils/id';
import { useDrawingStore } from '../../store/useDrawingStore';
import { InstrumentSpec } from '../../domain/instruments';

interface SelectedDrawingToolbarProps {
  readonly toXY: (time: number, price: number) => { x: number | null; y: number | null };
  readonly width: number;
  readonly height: number;
  readonly instrument: InstrumentSpec;
}

export const SelectedDrawingToolbar: React.FC<SelectedDrawingToolbarProps> = ({ toXY, width, height, instrument }) => {
  const { drawings, selectedDrawingId, updateDrawing, addDrawing, selectDrawing, removeDrawing } = useDrawingStore();

  // Selected drawing position for floating toolbar
  const selectedDrawing = drawings.find((d) => d.id === selectedDrawingId);

  const isRR = selectedDrawing?.type === 'pos_long' || selectedDrawing?.type === 'pos_short';

  let toolbarPos: { x: number; y: number } | null = null;

  if (selectedDrawing && selectedDrawing.pts.length > 0) {
    const xyPts = selectedDrawing.pts
      .map((p) => toXY(p.time, p.price))
      .filter((p) => p.x !== null && p.y !== null) as { x: number; y: number }[];

    if (xyPts.length > 0) {
      const minX = Math.min(...xyPts.map((p) => p.x));
      const maxX = Math.max(...xyPts.map((p) => p.x));
      const minY = Math.min(...xyPts.map((p) => p.y));
      const maxY = Math.max(...xyPts.map((p) => p.y));

      if (isRR) {
        // Place to the SIDE of the Position Box so it NEVER blocks handles, candles or metrics
        const tbWidth = 110;
        // Prefer placing to the right outside maxX
        let tx = maxX + 18;
        let ty = Math.min(height - 80, Math.max(20, minY + 10));

        // If not enough room on the right (close to price scale), place to the left of the box
        if (tx + tbWidth > width - 75) {
          tx = minX - tbWidth - 18;
        }
        // If still off-screen to the left, place above the highest point
        if (tx < 15) {
          tx = Math.max(15, minX);
          ty = Math.max(15, minY - 45);
        }

        toolbarPos = {
          x: Math.max(10, Math.min(width - tbWidth - 70, tx)),
          y: Math.max(10, Math.min(height - 50, ty)),
        };
      } else {
        const tbWidth = 220;
        let ty = minY - 45;
        if (ty < 35) {
          ty = maxY + 15;
        }
        const tx = (minX + maxX) / 2 - tbWidth / 2;
        toolbarPos = {
          x: Math.max(10, Math.min(width - tbWidth - 70, tx)),
          y: Math.max(10, Math.min(height - 50, ty)),
        };
      }
    }
  }

  if (!(selectedDrawing && toolbarPos)) return null;
  return (
    <div
          id="drawing-floating-toolbar"
          style={{
            position: 'absolute',
            left: `${toolbarPos.x}px`,
            top: `${toolbarPos.y}px`,
            zIndex: 30,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: 'rgba(15, 23, 42, 0.95)',
            backdropFilter: 'blur(14px)',
            padding: '4px 8px',
            borderRadius: '8px',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
            pointerEvents: 'auto',
          }}
        >
          {isRR ? (
            <span className="dtb-position-label">
              {selectedDrawing.type === 'pos_long' ? '📈 ACHAT' : '📉 VENTE'}
            </span>
          ) : (
            <>
              {/* Color palette */}
              {['#3B82F6', '#00C46E', '#F43F5E', '#F59E0B', '#A78BFA', '#FFFFFF'].map((c) => (
                <button type="button"
                  key={c}
                  className="color-swatch"
                  aria-label={`Couleur ${c}`}
                  aria-pressed={selectedDrawing.style.color === c}
                  onClick={() => updateDrawing(selectedDrawing.id, { style: { ...selectedDrawing.style, color: c } })}
                  style={{
                    width: '14px',
                    height: '14px',
                    borderRadius: '50%',
                    background: c,
                    cursor: 'pointer',
                    border: selectedDrawing.style.color === c ? '2px solid white' : '1px solid rgba(0,0,0,0.3)',
                    transform: selectedDrawing.style.color === c ? 'scale(1.2)' : 'scale(1)',
                    transition: 'transform 0.1s ease',
                  }}
                  title={`Couleur ${c}`}
                />
              ))}
    
              <div className="dtb-separator" />
            </>
          )}
    
          {/* Duplicate button */}
          <button
            onClick={() => {
              const pip = instrument.pip;
              const dup: Drawing = {
                ...selectedDrawing,
                id: newId('draw'),
                pts: selectedDrawing.pts.map((p) => ({ time: p.time, price: p.price + pip * 10 })),
              };
              addDrawing(dup);
              selectDrawing(dup.id);
            }} className="dtb-duplicate"
            title="Dupliquer"
          >
            <Copy size={13} strokeWidth={2} />
          </button>
    
          {/* Delete button */}
          <button
            onClick={() => {
              removeDrawing(selectedDrawing.id);
              selectDrawing(null);
            }} className="dtb-delete"
            title="Supprimer (Touche Suppr)"
          >
            <Trash2 size={13} strokeWidth={2} />
          </button>
        </div>
      
  );
};
