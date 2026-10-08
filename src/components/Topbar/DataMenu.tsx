import React from 'react';
import { BookOpen, ChevronDown, Database, Globe, RotateCcw, UploadCloud } from 'lucide-react';
import { useUIStore } from '../../store/useUIStore';

/**
 * Porte unique : les quatre entrées concurrentes (fichier, marchés,
 * sauvegardes, démo) partagent enfin un seul point de départ.
 */
export const DataMenu: React.FC = () => {
  const { activeDropdown, toggleDropdown, openModal } = useUIStore();

  return (
  <div className="tv-dropdown data-menu">
    <button
      id="upload-btn"
      onClick={() => toggleDropdown('data')}
      aria-haspopup="menu"
      aria-expanded={activeDropdown === 'data'} className="data-menu-trigger"
    >
      <Database size={14} strokeWidth={2.2} />
      <span>Données</span>
      <ChevronDown size={11} strokeWidth={2.4} />
    </button>
    {activeDropdown === 'data' && (
      <div
        className="tv-dropdown-menu show data-menu-list"
        role="menu"
      >
        <div className="dropdown-section-label">Charger</div>
        <button type="button" className="tv-dropdown-item" role="menuitem" onClick={() => openModal('live')}>
          <Globe size={13} strokeWidth={2} className="data-menu-icon-live" />
          <span>Choisir un instrument</span>
        </button>
        <button type="button" className="tv-dropdown-item" role="menuitem" onClick={() => openModal('import')}>
          <UploadCloud size={13} strokeWidth={2} className="data-menu-icon-import" />
          <span>Importer un fichier</span>
        </button>
        <div className="dropdown-divider" />
        <div className="dropdown-section-label">Reprendre</div>
        <button type="button" className="tv-dropdown-item" role="menuitem" onClick={() => openModal('datasets')}>
          <Database size={13} strokeWidth={2} className="data-menu-icon-saves" />
          <span>Sauvegardes et jeux de données</span>
        </button>
        <button type="button" className="tv-dropdown-item" role="menuitem" onClick={() => openModal('trade-history')}>
          <BookOpen size={13} strokeWidth={2} className="data-menu-icon-journal" />
          <span>Journal de trades</span>
        </button>
        <div className="dropdown-divider" />
        <div className="dropdown-section-label">Gestion</div>
        <button
          type="button"
          className="tv-dropdown-item tv-dropdown-item-danger"
          id="btn-reset-all"
          role="menuitem"
          onClick={() => openModal('reset-all')}
        >
          <RotateCcw size={13} strokeWidth={2} className="data-menu-icon-reset" />
          <span>Tout réinitialiser (reprendre à zéro)</span>
        </button>
      </div>
    )}
  </div>
  );
};
