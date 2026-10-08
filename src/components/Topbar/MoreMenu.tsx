import React from 'react';
import { Camera, Keyboard, Maximize2, Minimize2, MoreHorizontal, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { useMarketStore } from '../../store/useMarketStore';
import { useUIStore } from '../../store/useUIStore';
import { useIsFullscreen, toggleFullscreen } from '../../hooks/useFullscreen';

/**
 * Actions applicatives, hors du flux d'analyse : trois icônes de moins dans une
 * rangée qui en comptait huit de poids identique.
 */
export const MoreMenu: React.FC = () => {
  const soundEnabled = useMarketStore((m) => m.soundEnabled);
  const toggleSound = useMarketStore((m) => m.toggleSound);
  const { activeDropdown, toggleDropdown, openModal, showToast } = useUIStore();
  // Subscribed rather than read once per render: leaving fullscreen with F11 or
  // Escape used to leave the menu entry stuck on "Quitter le plein écran".
  const isFullscreen = useIsFullscreen();

  const handleToggleFullscreen = async () => {
    const entered = await toggleFullscreen();
    showToast(entered ? 'Plein écran activé' : 'Plein écran quitté', 'info', 2000);
  };

  return (
    <div className="tv-dropdown more-menu">
      <button
        className="tv-icon-btn"
        id="btn-more"
        onClick={() => toggleDropdown('more')}
        title="Plus d’actions"
        aria-haspopup="menu"
        aria-expanded={activeDropdown === 'more'}
      >
        <MoreHorizontal size={16} strokeWidth={2} />
      </button>
      {activeDropdown === 'more' && (
        <div className="tv-dropdown-menu show more-menu-list" role="menu">
          <button type="button" className="tv-dropdown-item" id="btn-snapshot" role="menuitem" onClick={() => openModal('snapshot')}>
            <Camera size={13} strokeWidth={2} />
            <span>Capturer le graphique</span>
            <span className="shortcut-hint">P</span>
          </button>
          <button type="button" className="tv-dropdown-item" id="btn-fullscreen" role="menuitem" onClick={() => void handleToggleFullscreen()}>
            {isFullscreen ? <Minimize2 size={13} strokeWidth={2} /> : <Maximize2 size={13} strokeWidth={2} />}
            <span>{isFullscreen ? 'Quitter le plein écran' : 'Plein écran'}</span>
            <span className="shortcut-hint">F</span>
          </button>
          <button type="button" className="tv-dropdown-item" id="btn-sound" role="menuitem" onClick={toggleSound}>
            {soundEnabled ? <Volume2 size={13} strokeWidth={2} /> : <VolumeX size={13} strokeWidth={2} />}
            <span>{soundEnabled ? 'Couper les sons' : 'Activer les sons'}</span>
          </button>
          <div className="dropdown-divider" />
          <button type="button" className="tv-dropdown-item" role="menuitem" onClick={() => openModal('shortcuts')}>
            <Keyboard size={13} strokeWidth={2} />
            <span>Raccourcis clavier</span>
            <span className="shortcut-hint">?</span>
          </button>
          <div className="dropdown-divider" />
          <button
            type="button"
            className="tv-dropdown-item tv-dropdown-item-danger"
            role="menuitem"
            onClick={() => openModal('reset-all')}
          >
            <RotateCcw size={13} strokeWidth={2} />
            <span>Tout réinitialiser (reprendre à zéro)</span>
          </button>
        </div>
      )}
    </div>
  );
};
