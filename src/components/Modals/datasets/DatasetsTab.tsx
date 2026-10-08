import React from 'react';
import { Database, Trash2, UploadCloud } from 'lucide-react';
import { useMarketStore } from '../../../store/useMarketStore';
import { useUIStore } from '../../../store/useUIStore';
import { SessionLibrary } from './useSessionLibrary';

/** The candle sets cached in this browser: reload one, or delete it. */
export const DatasetsTab: React.FC<{ library: SessionLibrary }> = ({ library }) => {
  const currentSymbol = useMarketStore((m) => m.currentSymbol);
  const { closeModal, openModal } = useUIStore();
  const { datasets, handleLoadDataset, handleDeleteDataset } = library;

  return (
    <div className="ds-dataset-panel">
      <div className="ds-dataset-head">
        <span className="ds-dataset-intro">
          Données de chandeliers brutes stockées en cache local IndexedDB.
        </span>
        <button
          className="btn-sm btn-primary ds-labeled-btn"
          onClick={() => {
            closeModal();
            openModal('import');
          }}
        >
          <UploadCloud size={13} />
          <span>Importer un fichier</span>
        </button>
      </div>

      <div className="ds-dataset-list">
        {datasets.length === 0 ? (
          <div className="modal-empty">
            <Database size={30} strokeWidth={1.5} className="modal-empty-icon" aria-hidden />
            <div className="modal-empty-title">Aucun jeu de bougies</div>
            <p className="modal-empty-text">
              Importez un fichier CSV ou JSON pour conserver ses bougies en cache et les
              recharger sans réseau.
            </p>
            <button
              className="btn-sm btn-primary ds-labeled-btn"
              onClick={() => {
                closeModal();
                openModal('import');
              }}
            >
              <UploadCloud size={13} strokeWidth={2} />
              <span>Importer un fichier</span>
            </button>
          </div>
        ) : (
          datasets.map((d) => {
            const isActive = d.symbol === currentSymbol;
            return (
              <div
                key={d.symbol}
                className={`pair-card ${isActive ? 'selected' : ''}`}
                role="button"
                tabIndex={isActive ? -1 : 0}
                aria-disabled={isActive}
                aria-label={isActive ? `${d.symbol}, jeu actif` : `Charger ${d.symbol}`}
                onClick={() => !isActive && handleLoadDataset(d)}
                onKeyDown={(e) => {
                  // La touche doit viser la carte, pas son bouton « Supprimer ».
                  if (e.target !== e.currentTarget || isActive) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleLoadDataset(d);
                  }
                }}
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
                  <strong className="ds-dataset-symbol">{d.symbol}</strong>
                  <div className="ds-dataset-meta">
                    {d.candlesCount.toLocaleString()} bougies • {d.timeRange || 'Historique'}
                  </div>
                </div>
                <div className="ds-dataset-actions">
                  <span className={`badge-type ${isActive ? 'long' : ''}`}>{isActive ? 'Actif' : 'En cache'}</span>
                  {!isActive && (
                    <button
                      className="btn-sm btn-danger ds-dataset-delete"
                      onClick={(e) => handleDeleteDataset(e, d.symbol)}
                      title="Supprimer ce jeu de données"
                    >
                      <Trash2 size={12} strokeWidth={2} />
                      <span>Supprimer</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
