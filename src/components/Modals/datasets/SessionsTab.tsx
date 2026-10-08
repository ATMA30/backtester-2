import React from 'react';
import { CheckCircle2, FileJson, Layers, Save } from 'lucide-react';
import { useMarketStore } from '../../../store/useMarketStore';
import { SessionCard } from './SessionCard';
import { SessionLibrary } from './useSessionLibrary';

/** Save the current state, import a session file, and the list of saved sessions. */
export const SessionsTab: React.FC<{ library: SessionLibrary }> = ({ library }) => {
  const currentSymbol = useMarketStore((m) => m.currentSymbol);
  const {
    sessions, isCreatingSession, setIsCreatingSession, sessionNameInput, setSessionNameInput, fileInputRef,
    handleSaveCurrentSession, handleImportJson,
  } = library;

  return (
    <div>
      {/* Top Action Bar */}
      <div className="modal-toolbar">
        {!isCreatingSession ? (
          // Quand la liste est vide, l'action principale vit dans
          // l'état vide : la répéter ici ferait deux fois le même
          // appel à l'action dans un écran qui n'a rien à montrer.
          sessions.length > 0 && (
            <button
              className="btn-sm btn-primary ds-labeled-btn"
              onClick={() => setIsCreatingSession(true)}
            >
              <Save size={14} strokeWidth={2} />
              <span>Enregistrer la session</span>
            </button>
          )
        ) : (
          <div className="ds-name-form">
            <input
              type="text"
              className="form-input ds-name-input"
              value={sessionNameInput}
              onChange={(e) => setSessionNameInput(e.target.value)}
              placeholder={`Nommez cette session — ex. ${currentSymbol} scalping Londres`}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveCurrentSession();
                if (e.key === 'Escape') setIsCreatingSession(false);
              }}
            />
            <button
              className="btn-sm btn-primary ds-name-confirm"
              onClick={handleSaveCurrentSession}
            >
              <CheckCircle2 size={13} />
              <span>Enregistrer</span>
            </button>
            <button
              className="btn-sm ds-name-cancel"
              onClick={() => setIsCreatingSession(false)}
            >
              Annuler
            </button>
          </div>
        )}

        <div className="ds-toolbar-group">
          <input
            type="file"
            ref={fileInputRef}
            accept=".json" className="file-input-hidden"
            onChange={handleImportJson}
          />
          <button
            className="btn-sm btn-ghost ds-labeled-btn"
            onClick={() => fileInputRef.current?.click()}
            title="Importer une sauvegarde"
          >
            <FileJson size={13} />
            <span>Importer</span>
          </button>
        </div>
      </div>

      {/* Sessions List */}
      <div className="ds-session-list"
      >
        {sessions.length === 0 ? (
          <div className="modal-empty">
            <Layers size={30} strokeWidth={1.5} className="modal-empty-icon" aria-hidden />
            <div className="modal-empty-title">Aucune session enregistrée</div>
            <p className="modal-empty-text">
              Sauvegardez l’état de votre graphique, vos indicateurs et vos positions en
              cours pour les retrouver plus tard.
            </p>
            <button
              className="btn-sm btn-primary ds-labeled-btn"
              onClick={() => setIsCreatingSession(true)}
            >
              <Save size={13} strokeWidth={2} />
              <span>Enregistrer maintenant</span>
            </button>
          </div>
        ) : (
          sessions.map((s) => <SessionCard key={s.id} session={s} library={library} />)
        )}
      </div>
    </div>
  );
};
