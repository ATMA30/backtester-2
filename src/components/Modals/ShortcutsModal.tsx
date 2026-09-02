import React from 'react';
import { useUIStore } from '../../store/useUIStore';

export const ShortcutsModal: React.FC = () => {
  const { activeModal, closeModal } = useUIStore();

  if (activeModal !== 'shortcuts') return null;

  return (
    <div id="shortcuts-overlay" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
      <div className="shortcuts-box">
        <div className="shortcuts-title">
          Raccourcis clavier
          <button className="shortcuts-close" onClick={closeModal}>✕</button>
        </div>

        <div className="shortcuts-section">
          <div className="shortcuts-section-label">Outils de dessin</div>
          <div className="shortcut-row"><span className="shortcut-desc">Sélection</span><span className="shortcut-keys"><kbd>1</kbd></span></div>
          <div className="shortcut-row"><span className="shortcut-desc">Ligne de tendance</span><span className="shortcut-keys"><kbd>2</kbd></span></div>
          <div className="shortcut-row"><span className="shortcut-desc">Ligne horizontale</span><span className="shortcut-keys"><kbd>3</kbd></span></div>
          <div className="shortcut-row"><span className="shortcut-desc">Ligne verticale</span><span className="shortcut-keys"><kbd>4</kbd></span></div>
          <div className="shortcut-row"><span className="shortcut-desc">Rectangle</span><span className="shortcut-keys"><kbd>5</kbd></span></div>
          <div className="shortcut-row"><span className="shortcut-desc">Fibonacci</span><span className="shortcut-keys"><kbd>6</kbd></span></div>
          <div className="shortcut-row"><span className="shortcut-desc">Texte</span><span className="shortcut-keys"><kbd>7</kbd></span></div>
          <div className="shortcut-row"><span className="shortcut-desc">Zone de tendance</span><span className="shortcut-keys"><kbd>8</kbd></span></div>
          <div className="shortcut-row"><span className="shortcut-desc">Position Long (R:R)</span><span className="shortcut-keys"><kbd>9</kbd></span></div>
          <div className="shortcut-row"><span className="shortcut-desc">Position Short (R:R)</span><span className="shortcut-keys"><kbd>0</kbd></span></div>
          <div className="shortcut-row"><span className="shortcut-desc">Rayon</span><span className="shortcut-keys"><kbd>R</kbd></span></div>
          <div className="shortcut-row"><span className="shortcut-desc">Supprimer sélection</span><span className="shortcut-keys"><kbd>Del</kbd></span></div>
        </div>

        <div className="shortcuts-section">
          <div className="shortcuts-section-label">Trading &amp; Navigation</div>
          <div className="shortcut-row"><span className="shortcut-desc">Breakeven SL</span><span className="shortcut-keys"><kbd>B</kbd></span></div>
          <div className="shortcut-row"><span className="shortcut-desc">Capture d'écran HD</span><span className="shortcut-keys"><kbd>P</kbd></span></div>
          <div className="shortcut-row"><span className="shortcut-desc">Ajuster la vue</span><span className="shortcut-keys"><kbd>Ctrl</kbd><span className="shortcut-plus">+</span><kbd>F</kbd></span></div>
          <div className="shortcut-row"><span className="shortcut-desc">Importer des données</span><span className="shortcut-keys"><kbd>Ctrl</kbd><span className="shortcut-plus">+</span><kbd>O</kbd></span></div>
          <div className="shortcut-row"><span className="shortcut-desc">Fermer / Quitter</span><span className="shortcut-keys"><kbd>Esc</kbd></span></div>
          <div className="shortcut-row"><span className="shortcut-desc">Aide clavier</span><span className="shortcut-keys"><kbd>?</kbd></span></div>
        </div>

        <div className="shortcuts-section">
          <div className="shortcuts-section-label">Mode Replay</div>
          <div className="shortcut-row"><span className="shortcut-desc">Lecture / Pause</span><span className="shortcut-keys"><kbd>Space</kbd></span></div>
          <div className="shortcut-row"><span className="shortcut-desc">Bougie suivante</span><span className="shortcut-keys"><kbd>→</kbd></span></div>
          <div className="shortcut-row"><span className="shortcut-desc">Bougie précédente</span><span className="shortcut-keys"><kbd>←</kbd></span></div>
        </div>
      </div>
    </div>
  );
};
