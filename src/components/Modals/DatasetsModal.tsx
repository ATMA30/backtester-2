import React, { useRef, useState } from 'react';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import { Database, X, Layers, RotateCcw } from 'lucide-react';
import { useUIStore } from '../../store/useUIStore';
import { useSessionLibrary } from './datasets/useSessionLibrary';
import { SessionsTab } from './datasets/SessionsTab';
import { DatasetsTab } from './datasets/DatasetsTab';

/** Saved sessions and cached candle sets, in two tabs. */
export const DatasetsModal: React.FC = () => {
  const { activeModal, closeModal, openModal } = useUIStore();
  const library = useSessionLibrary();
  const { sessions, datasets } = library;
  const [activeTab, setActiveTab] = useState<'sessions' | 'datasets'>('sessions');

  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, activeModal === 'datasets');

  if (activeModal !== 'datasets') return null;

  return (
    <div
      id="datasets-modal"
      className="custom-modal open modal-overlay-open"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeModal();
      }}
    >
      <div className="custom-modal-box ds-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-label="Données et sessions">
        {/* Header */}
        <div className="custom-modal-header ds-header">
          <div className="custom-modal-title modal-title-row">
            <Database size={16} strokeWidth={2} className="modal-title-icon" />
            <span>Sauvegardes et jeux de données</span>
          </div>
          <button
            className="custom-modal-close modal-close-btn"
            onClick={closeModal}
          >
            <X size={15} strokeWidth={2.4} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="ds-tabs-bar"
        >
          <div className="seg-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'sessions'}
              className={`seg-tab ${activeTab === 'sessions' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('sessions')}
            >
              <Layers size={13} />
              <span>Sessions sauvegardées</span>
              <span className="seg-tab-count">{sessions.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'datasets'}
              className={`seg-tab ${activeTab === 'datasets' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('datasets')}
            >
              <Database size={13} />
              <span>Jeux de bougies</span>
              <span className="seg-tab-count">{datasets.length}</span>
            </button>
          </div>
        </div>

        {/* Body Content */}
        <div className="custom-modal-body ds-body">
          {activeTab === 'sessions' ? <SessionsTab library={library} /> : <DatasetsTab library={library} />}
        </div>

        {/* Modal Footer */}
        <div className="ds-modal-footer">
          <button
            type="button"
            className="ds-reset-all-link"
            id="btn-ds-reset-all"
            onClick={() => openModal('reset-all')}
            title="Supprimer toutes les données sauvegardées et réinitialiser l’application"
          >
            <RotateCcw size={12} strokeWidth={2} />
            <span>Tout effacer &amp; repartir de zéro</span>
          </button>
        </div>
      </div>
    </div>
  );
};
