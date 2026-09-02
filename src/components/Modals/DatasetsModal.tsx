import React, { useEffect, useState } from 'react';
import { useUIStore } from '../../store/useUIStore';
import { useMarketStore } from '../../store/useMarketStore';
import { useDrawingStore } from '../../store/useDrawingStore';
import { getAllDatasets, deleteDataset } from '../../services/db';
import { DatasetMeta } from '../../types/market';

export const DatasetsModal: React.FC = () => {
  const { activeModal, closeModal, openModal, showToast } = useUIStore();
  const { currentSymbol, setSymbol, setBaseCandles, setTimeframe, triggerFitContent } = useMarketStore();
  const { removeSymbolData } = useDrawingStore();

  const [datasets, setDatasets] = useState<DatasetMeta[]>([]);

  useEffect(() => {
    if (activeModal !== 'datasets') return;
    getAllDatasets().then(setDatasets);
  }, [activeModal]);

  if (activeModal !== 'datasets') return null;

  const handleLoad = (dataset: DatasetMeta) => {
    if (!dataset.data || dataset.data.length === 0) return;
    setSymbol(dataset.symbol);
    setBaseCandles(dataset.data, dataset.baseTF);
    setTimeframe(dataset.baseTF);
    triggerFitContent();
    closeModal();
    showToast(`🟢 ${dataset.symbol} : session rechargée (${dataset.data.length.toLocaleString()} bougies)`, 'success', 3500);
  };

  const handleDelete = async (e: React.MouseEvent, symbol: string) => {
    e.stopPropagation();
    if (symbol === currentSymbol) {
      showToast('Impossible de supprimer la session active', 'warning');
      return;
    }
    await deleteDataset(symbol);
    removeSymbolData(symbol);
    setDatasets((prev) => prev.filter((d) => d.symbol !== symbol));
    showToast(`Session ${symbol} supprimée`, 'info');
  };

  return (
    <div id="datasets-modal" className="custom-modal open" style={{ display: 'flex', opacity: 1 }} onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
      <div className="custom-modal-box" style={{ maxWidth: '620px' }}>
        <div className="custom-modal-header">
          <div className="custom-modal-title">💾 Datasets &amp; Sessions Sauvegardées</div>
          <button className="custom-modal-close" onClick={closeModal}>✕</button>
        </div>

        <div className="custom-modal-body">
          <div className="datasets-list-wrap" style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '48vh', overflowY: 'auto' }}>
            {datasets.length === 0 && (
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', padding: '12px' }}>
                Aucune session sauvegardée pour l'instant.
              </div>
            )}
            {datasets.map((d) => {
              const isActive = d.symbol === currentSymbol;
              return (
                <div
                  key={d.symbol}
                  className={`pair-card ${isActive ? 'selected' : ''}`}
                  onClick={() => !isActive && handleLoad(d)}
                  style={{
                    background: isActive ? 'rgba(59, 130, 246, 0.15)' : 'var(--bg-elevated)',
                    border: isActive ? '1px solid var(--accent)' : '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '12px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    cursor: isActive ? 'default' : 'pointer',
                  }}
                >
                  <div>
                    <strong style={{ fontSize: '13px', fontFamily: 'var(--mono)' }}>{d.symbol}</strong>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                      {d.candlesCount.toLocaleString()} bougies chargées en mémoire
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className={`badge-type ${isActive ? 'long' : ''}`}>{isActive ? 'Actif' : 'Sauvegardé'}</span>
                    {!isActive && (
                      <button
                        className="btn-sm btn-danger"
                        onClick={(e) => handleDelete(e, d.symbol)}
                        title="Supprimer cette session"
                      >
                        Suppr.
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
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
