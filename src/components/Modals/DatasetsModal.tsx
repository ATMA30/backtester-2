import React from 'react';
import { useUIStore } from '../../store/useUIStore';
import { useMarketStore } from '../../store/useMarketStore';

export const DatasetsModal: React.FC = () => {
  const { activeModal, closeModal, openModal, showToast } = useUIStore();
  const { baseCandles, currentSymbol } = useMarketStore();

  if (activeModal !== 'datasets') return null;

  return (
    <div id="datasets-modal" className="custom-modal" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
      <div className="custom-modal-box" style={{ maxWidth: '620px' }}>
        <div className="custom-modal-header">
          <div className="custom-modal-title">💾 Datasets &amp; Sessions Sauvegardées</div>
          <button className="custom-modal-close" onClick={closeModal}>✕</button>
        </div>

        <div className="custom-modal-body">
          <div className="datasets-list-wrap">
            <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong style={{ fontSize: '13px' }}>{currentSymbol} (Session Active)</strong>
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                  {baseCandles.length.toLocaleString()} bougies chargées en mémoire
                </div>
              </div>
              <span className="badge-type long">Actif</span>
            </div>
          </div>
        </div>

        <div className="custom-modal-actions">
          <button className="btn-sm btn-primary" onClick={() => { closeModal(); openModal('import'); }}>
            + Importer nouveau CSV
          </button>
          <button className="btn-sm" onClick={closeModal}>Fermer</button>
        </div>
      </div>
    </div>
  );
};
