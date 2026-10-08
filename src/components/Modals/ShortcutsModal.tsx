import React, { useRef } from 'react';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import { Keyboard, X } from 'lucide-react';
import { useUIStore } from '../../store/useUIStore';

export const ShortcutsModal: React.FC = () => {
  const { activeModal, closeModal } = useUIStore();

  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, activeModal === 'shortcuts');

  if (activeModal !== 'shortcuts') return null;

  return (
    <div id="shortcuts-overlay" className="open modal-overlay-open" onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
      <div className="shortcuts-box" ref={dialogRef} role="dialog" aria-modal="true" aria-label="Raccourcis clavier">
        <div className="shortcuts-title shortcuts-header">
          <div className="modal-title-row">
            <Keyboard size={16} strokeWidth={2} className="modal-title-icon" />
            <span>Raccourcis clavier</span>
          </div>
          <button className="shortcuts-close modal-close-btn" onClick={closeModal}>
            <X size={15} strokeWidth={2.4} />
          </button>
        </div>

        <div className="shortcuts-section">
          <div className="shortcuts-section-label">Outils de dessin</div>
          <div className="shortcut-row"><span className="shortcut-desc">Sélection</span><span className="shortcut-keys"><kbd>1</kbd></span></div>
          <div className="shortcut-row"><span className="shortcut-desc">Ligne de tendance</span><span className="shortcut-keys"><kbd>2</kbd></span></div>
          <div className="shortcut-row"><span className="shortcut-desc">Ligne horizontale</span><span className="shortcut-keys"><kbd>3</kbd></span></div>
          <div className="shortcut-row"><span className="shortcut-desc">Ligne verticale</span><span className="shortcut-keys"><kbd>4</kbd></span></div>
          <div className="shortcut-row"><span className="shortcut-desc">Rectangle</span><span className="shortcut-keys"><kbd>5</kbd></span></div>
          <div className="shortcut-row"><span className="shortcut-desc">Fibonacci</span><span className="shortcut-keys"><kbd>6</kbd></span></div>
          <div className="shortcut-row"><span className="shortcut-desc">Texte</span><span className="shortcut-keys"><kbd>7</kbd><span className="shortcut-plus">/</span><kbd>T</kbd></span></div>
          <div className="shortcut-row"><span className="shortcut-desc">Canal parallèle</span><span className="shortcut-keys"><kbd>8</kbd></span></div>
          <div className="shortcut-row"><span className="shortcut-desc">Position acheteuse</span><span className="shortcut-keys"><kbd>9</kbd></span></div>
          <div className="shortcut-row"><span className="shortcut-desc">Position vendeuse</span><span className="shortcut-keys"><kbd>0</kbd></span></div>
          <div className="shortcut-row"><span className="shortcut-desc">Rayon</span><span className="shortcut-keys"><kbd>R</kbd></span></div>
          <div className="shortcut-row"><span className="shortcut-desc">Supprimer le tracé</span><span className="shortcut-keys"><kbd>Del</kbd></span></div>
        </div>

        <div className="shortcuts-section">
          <div className="shortcuts-section-label">Trading &amp; Navigation</div>
          {/* Cette liste doit décrire le clavier réel. « Ctrl+F » et « Ctrl+O »
              y figuraient alors que le gestionnaire ignore délibérément tous les
              accords Ctrl/Cmd — pour ne pas détourner Recharger ou Nouvel onglet
              — donc aucune des deux touches n'a jamais rien fait. Les actions
              existent désormais sur des touches simples. */}
          <div className="shortcut-row"><span className="shortcut-desc">Stop à l’entrée</span><span className="shortcut-keys"><kbd>B</kbd></span></div>
          <div className="shortcut-row"><span className="shortcut-desc">Capturer le graphique</span><span className="shortcut-keys"><kbd>P</kbd></span></div>
          <div className="shortcut-row"><span className="shortcut-desc">Ajuster la vue</span><span className="shortcut-keys"><kbd>A</kbd></span></div>
          <div className="shortcut-row"><span className="shortcut-desc">Ouvrir les données</span><span className="shortcut-keys"><kbd>D</kbd></span></div>
          <div className="shortcut-row"><span className="shortcut-desc">Plein écran</span><span className="shortcut-keys"><kbd>F</kbd></span></div>
          <div className="shortcut-row"><span className="shortcut-desc">Annuler / Rétablir</span><span className="shortcut-keys"><kbd>Ctrl</kbd><span className="shortcut-plus">+</span><kbd>Z</kbd></span></div>
          <div className="shortcut-row"><span className="shortcut-desc">Fermer / Quitter</span><span className="shortcut-keys"><kbd>Esc</kbd></span></div>
          <div className="shortcut-row"><span className="shortcut-desc">Ces raccourcis</span><span className="shortcut-keys"><kbd>?</kbd></span></div>
        </div>

        <div className="shortcuts-section">
          <div className="shortcuts-section-label">Rejouer l’historique</div>
          <div className="shortcut-row"><span className="shortcut-desc">Lecture / Pause</span><span className="shortcut-keys"><kbd>Space</kbd></span></div>
          <div className="shortcut-row"><span className="shortcut-desc">Bougie suivante</span><span className="shortcut-keys"><kbd>→</kbd></span></div>
          <div className="shortcut-row"><span className="shortcut-desc">Bougie précédente</span><span className="shortcut-keys"><kbd>←</kbd></span></div>
        </div>
      </div>
    </div>
  );
};
