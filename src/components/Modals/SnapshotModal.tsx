import React, { useEffect, useState } from 'react';
import { useUIStore } from '../../store/useUIStore';
import { useMarketStore } from '../../store/useMarketStore';

export const SnapshotModal: React.FC = () => {
  const { activeModal, closeModal, showToast } = useUIStore();
  const { currentSymbol } = useMarketStore();
  const [imgUrl, setImgUrl] = useState<string | null>(null);

  useEffect(() => {
    if (activeModal === 'snapshot') {
      // Capture screenshot from chart container
      const container = document.getElementById('tv-chart');
      if (container) {
        const canvases = container.querySelectorAll('canvas');
        if (canvases.length > 0) {
          const mainCanvas = canvases[0];
          const outCanvas = document.createElement('canvas');
          outCanvas.width = mainCanvas.width;
          outCanvas.height = mainCanvas.height;
          const ctx = outCanvas.getContext('2d');
          if (ctx) {
            canvases.forEach((c) => ctx.drawImage(c, 0, 0));
            // Add watermark
            ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.font = 'bold 16px Inter, sans-serif';
            ctx.fillText(`TradeView Pro • ${currentSymbol}`, 24, outCanvas.height - 24);
            setImgUrl(outCanvas.toDataURL('image/png'));
          }
        }
      }
    }
  }, [activeModal, currentSymbol]);

  if (activeModal !== 'snapshot') return null;

  const copyToClipboard = async () => {
    if (!imgUrl) return;
    try {
      const res = await fetch(imgUrl);
      const blob = await res.blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      showToast('Capture copiée dans le presse-papier !', 'success');
    } catch (e) {
      showToast('Impossible de copier (permission requise)', 'warning');
    }
  };

  const downloadPNG = () => {
    if (!imgUrl) return;
    const a = document.createElement('a');
    a.href = imgUrl;
    a.download = `TradeView_${currentSymbol}_${Date.now()}.png`;
    a.click();
    showToast('Image PNG téléchargée !', 'success');
  };

  return (
    <div id="snapshot-modal" className="custom-modal" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
      <div className="custom-modal-box snapshot-box" style={{ maxWidth: '780px' }}>
        <div className="custom-modal-header">
          <div className="custom-modal-title">📸 Capture HD du Graphique</div>
          <button className="custom-modal-close" onClick={closeModal}>✕</button>
        </div>

        <div className="custom-modal-body snapshot-body">
          {imgUrl ? (
            <img src={imgUrl} alt="Aperçu Capture" className="snapshot-img" style={{ width: '100%', borderRadius: 'var(--radius-sm)' }} />
          ) : (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>Génération de la capture...</div>
          )}
        </div>

        <div className="custom-modal-actions">
          <button className="btn-sm btn-primary" onClick={copyToClipboard}>📋 Copier l'image</button>
          <button className="btn-sm btn-primary" onClick={downloadPNG}>📥 Télécharger PNG</button>
          <button className="btn-sm" onClick={closeModal}>Fermer</button>
        </div>
      </div>
    </div>
  );
};
