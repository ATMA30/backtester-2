import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ImageOff, Trash2, X } from 'lucide-react';
import { deleteCapture, getCapture } from '../../../services/db';

interface TradeCaptureThumbProps {
  readonly tradeId: string;
  /** Called once the capture is deleted, so the trade forgets it had one. */
  readonly onDeleted: () => void;
}

/**
 * The chart at the close of a trade, as a thumbnail that opens full size.
 *
 * A session imported from another browser keeps `hasScreenshot` but not the
 * image, which never leaves IndexedDB: that case says so instead of an empty box.
 */
export const TradeCaptureThumb: React.FC<TradeCaptureThumbProps> = ({ tradeId, onDeleted }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    void getCapture(tradeId).then((blob) => {
      if (cancelled) return;
      if (!blob) {
        setMissing(true);
        return;
      }
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [tradeId]);

  if (missing) {
    return (
      <p className="trade-capture-missing">
        <ImageOff size={12} aria-hidden /> Capture absente de ce navigateur (session importée).
      </p>
    );
  }
  if (!url) return null;

  return (
    <div className="trade-capture">
      <button type="button" className="trade-capture-thumb" onClick={() => setZoomed(true)} aria-label="Agrandir la capture">
        <img src={url} alt="Graphique à la clôture du trade" />
      </button>
      <button
        type="button"
        className="trade-capture-delete"
        onClick={() => void deleteCapture(tradeId).then((r) => r.ok && onDeleted())}
        title="Supprimer la capture"
        aria-label="Supprimer la capture"
      >
        <Trash2 size={11} />
      </button>
      {/* In a portal: the journal panel is transformed, and a transformed
          ancestor turns `position: fixed` into "fixed to that panel". */}
      {zoomed &&
        createPortal(
          <div className="trade-capture-viewer" role="dialog" aria-label="Capture du graphique" onClick={() => setZoomed(false)}>
            <img src={url} alt="Graphique à la clôture du trade" />
            <button type="button" className="trade-capture-viewer-close" aria-label="Fermer la capture" onClick={() => setZoomed(false)}>
              <X size={16} />
            </button>
          </div>,
          document.body
        )}
    </div>
  );
};
