import React, { useRef, useState } from 'react';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import { AlertTriangle, BookOpen, Database, Layers, PenTool, RotateCcw, Sliders, Trash2, X } from 'lucide-react';
import { useUIStore } from '../../store/useUIStore';
import { resetAllAppData } from '../../services/resetApp';

export const ResetAllModal: React.FC = () => {
  const { activeModal, closeModal, showToast } = useUIStore();
  const [isResetting, setIsResetting] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useDialogFocus(dialogRef, activeModal === 'reset-all');

  if (activeModal !== 'reset-all') return null;

  const handleConfirmReset = async () => {
    setIsResetting(true);
    try {
      await resetAllAppData({ reload: true });
      closeModal();
      showToast('Toutes les données ont été réinitialisées avec succès.', 'success', 4000);
    } catch (err) {
      console.error('[ResetAllModal] Reset failed:', err);
      showToast('Erreur lors de la réinitialisation des données.', 'error', 5000);
      setIsResetting(false);
    }
  };

  return (
    <div
      id="reset-all-modal"
      className="custom-modal open modal-overlay-open"
      onClick={(e) => {
        if (!isResetting && e.target === e.currentTarget) closeModal();
      }}
    >
      <div
        className="custom-modal-box reset-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-modal-title"
      >
        {/* Header */}
        <div className="custom-modal-header reset-header">
          <div className="custom-modal-title modal-title-row">
            <span className="reset-title-icon-badge">
              <RotateCcw size={16} strokeWidth={2.4} className="reset-title-icon" />
            </span>
            <span id="reset-modal-title">Tout réinitialiser &amp; repartir de zéro</span>
          </div>
          <button
            type="button"
            className="custom-modal-close modal-close-btn"
            onClick={closeModal}
            disabled={isResetting}
            aria-label="Fermer la boîte de dialogue"
          >
            <X size={15} strokeWidth={2.4} />
          </button>
        </div>

        {/* Body Content */}
        <div className="custom-modal-body reset-body">
          <p className="reset-intro">
            Cette opération supprime <strong>définitivement l’ensemble des données locales</strong> enregistrées dans votre navigateur pour remettre l’application dans son état d’origine.
          </p>

          <div className="reset-items-grid">
            <div className="reset-item">
              <div className="reset-item-icon-wrap icon-drawings">
                <PenTool size={15} strokeWidth={2} />
              </div>
              <div className="reset-item-content">
                <strong>Graphiques &amp; tracés</strong>
                <span>Tous les dessins, tracés, rectangles, positions et annotations sur l’ensemble des symboles</span>
              </div>
            </div>

            <div className="reset-item">
              <div className="reset-item-icon-wrap icon-data">
                <Database size={15} strokeWidth={2} />
              </div>
              <div className="reset-item-content">
                <strong>Fichiers &amp; jeux de données</strong>
                <span>Tous les fichiers CSV/JSON importés et les séries de bougies en cache local</span>
              </div>
            </div>

            <div className="reset-item">
              <div className="reset-item-icon-wrap icon-sessions">
                <Layers size={15} strokeWidth={2} />
              </div>
              <div className="reset-item-content">
                <strong>Sessions de backtest</strong>
                <span>L’intégralité de vos sessions et stratégies sauvegardées</span>
              </div>
            </div>

            <div className="reset-item">
              <div className="reset-item-icon-wrap icon-journal">
                <BookOpen size={15} strokeWidth={2} />
              </div>
              <div className="reset-item-content">
                <strong>Journal &amp; compte de trading</strong>
                <span>L’historique des trades, positions, statistiques et captures d’écran</span>
              </div>
            </div>

            <div className="reset-item">
              <div className="reset-item-icon-wrap icon-settings">
                <Sliders size={15} strokeWidth={2} />
              </div>
              <div className="reset-item-content">
                <strong>Réglages &amp; préférences</strong>
                <span>Indicateurs configurés, sessions forex, commissions et options d’affichage</span>
              </div>
            </div>
          </div>

          <div className="reset-warning-card">
            <AlertTriangle size={18} strokeWidth={2.2} className="reset-warning-icon" aria-hidden />
            <div className="reset-warning-text">
              <strong>Action irréversible :</strong> aucune donnée supprimée ne pourra être récupérée. Si vous souhaitez conserver des sessions, pensez à les exporter en JSON au préalable.
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="reset-modal-actions">
          <button
            type="button"
            className="btn-sm btn-ghost reset-btn-cancel"
            onClick={closeModal}
            disabled={isResetting}
          >
            Annuler
          </button>
          <button
            type="button"
            className="btn-sm btn-danger reset-btn-confirm"
            id="btn-confirm-reset-all"
            onClick={handleConfirmReset}
            disabled={isResetting}
          >
            {isResetting ? (
              <>
                <span className="reset-spinner" aria-hidden />
                <span>Réinitialisation en cours...</span>
              </>
            ) : (
              <>
                <Trash2 size={13} strokeWidth={2.2} />
                <span>Tout supprimer et repartir de zéro</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
