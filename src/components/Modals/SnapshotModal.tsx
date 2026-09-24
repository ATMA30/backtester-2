import React, { useEffect, useState, useRef } from 'react';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import { Camera, X, Copy, Download } from 'lucide-react';
import { useUIStore } from '../../store/useUIStore';
import { useMarketStore } from '../../store/useMarketStore';

export const SnapshotModal: React.FC = () => {
  const { activeModal, closeModal, snapshotDataUrl, showToast } = useUIStore();
  const { currentSymbol } = useMarketStore();
  const [localUrl, setLocalUrl] = useState<string | null>(null);

  useEffect(() => {
    if (activeModal === 'snapshot') {
      const container = document.getElementById('tv-chart');
      if (container) {
        const canvases = Array.from(container.querySelectorAll('canvas'));
        if (canvases.length > 0) {
          const mainCanvas = canvases[0];
          const outCanvas = document.createElement('canvas');
          outCanvas.width = mainCanvas.width;
          outCanvas.height = mainCanvas.height;
          const ctx = outCanvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = '#0B0E14';
            ctx.fillRect(0, 0, outCanvas.width, outCanvas.height);

            canvases.forEach((c) => {
              try {
                ctx.drawImage(c, 0, 0);
              } catch {}
            });

            const dpr = window.devicePixelRatio || 1;
            ctx.fillStyle = 'rgba(11, 14, 20, 0.85)';
            ctx.fillRect(16 * dpr, (outCanvas.height / dpr - 42) * dpr, 340 * dpr, 30 * dpr);
            ctx.fillStyle = '#00C46E';
            ctx.font = `bold ${12 * dpr}px Inter, sans-serif`;
            ctx.fillText(`TradeView Pro`, 26 * dpr, (outCanvas.height / dpr - 22) * dpr);
            ctx.fillStyle = '#FFFFFF';
            ctx.font = `${11 * dpr}px JetBrains Mono, monospace`;
            ctx.fillText(` • ${currentSymbol} • ${new Date().toLocaleDateString('fr-FR')}`, 120 * dpr, (outCanvas.height / dpr - 22) * dpr);

            requestAnimationFrame(() => {
              setLocalUrl(outCanvas.toDataURL('image/png'));
            });
          }
        }
      }
    }
  }, [activeModal, currentSymbol]);

  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, activeModal === 'snapshot');

  if (activeModal !== 'snapshot') return null;

  const activeImg = snapshotDataUrl || localUrl;

  const copyToClipboard = async () => {
    if (!activeImg) return;
    try {
      const res = await fetch(activeImg);
      const blob = await res.blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      showToast('Capture HD copiée dans le presse-papier !', 'success');
    } catch {
      showToast('Impossible de copier (permission requise)', 'warning');
    }
  };

  const downloadPNG = () => {
    if (!activeImg) return;
    const a = document.createElement('a');
    a.href = activeImg;
    a.download = `TradeView_${currentSymbol}_${Date.now()}.png`;
    a.click();
    showToast('Capture HD téléchargée !', 'success');
  };

  return (
    <div id="snapshot-modal" className="custom-modal open u-display-flex u-opacity-1" onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
      <div className="custom-modal-box snapshot-box u-max-width-820px" ref={dialogRef} role="dialog" aria-modal="true" aria-label="Capture du graphique">
        <div className="custom-modal-header">
          <div className="custom-modal-title u-display-flex u-align-items-center u-gap-8px">
            <Camera size={16} strokeWidth={2} className="u-color-38bdf8" />
            <span>Capture du graphique</span>
          </div>
          <button className="custom-modal-close u-display-flex u-align-items-center u-justify-content-center" onClick={closeModal}>
            <X size={15} strokeWidth={2.4} />
          </button>
        </div>

        <div className="custom-modal-body snapshot-body u-padding-16px u-text-align-center">
          {activeImg ? (
            <img src={activeImg} alt="Aperçu Capture" className="snapshot-img u-width-100pct u-border-radius-radius-sm u-border-1px-solid-border-light u-box-shadow-shadow-lg" />
          ) : (
            <div className="u-padding-60px u-color-text-muted">Génération de l’image…</div>
          )}
        </div>

        <div className="custom-modal-actions u-padding-12px-16px u-display-flex u-justify-content-flex-end u-gap-8px">
          <button
            className="trade-btn buy u-height-34px u-padding-0-16px u-display-flex u-align-items-center u-gap-6px"
            onClick={copyToClipboard}
          >
            <Copy size={13} strokeWidth={2} />
            <span>Copier l'image</span>
          </button>
          <button
            className="trade-btn u-height-34px u-padding-0-16px u-background-accent u-color-fff u-display-flex u-align-items-center u-gap-6px"
            onClick={downloadPNG}
          >
            <Download size={13} strokeWidth={2} />
            <span>Enregistrer en PNG</span>
          </button>
          <button className="trade-btn u-height-34px u-padding-0-14px u-background-bg-elevated u-color-text-secondary" onClick={closeModal}>Fermer</button>
        </div>
      </div>
    </div>
  );
};
