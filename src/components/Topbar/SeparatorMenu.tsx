import React from 'react';
import { Calendar, CalendarDays, CalendarRange, Clock, Columns, Slash } from 'lucide-react';
import { useMarketStore } from '../../store/useMarketStore';
import { useUIStore } from '../../store/useUIStore';
import { SeparatorTF } from '../../types/market';

/** Vertical lines at the start of each day, week, month or year. */
export const SeparatorMenu: React.FC = () => {
  const separatorTF = useMarketStore((m) => m.separatorTF);
  const setSeparatorTF = useMarketStore((m) => m.setSeparatorTF);
  const { activeDropdown, toggleDropdown, closeAllDropdowns, showToast } = useUIStore();

  return (
    <div className="tv-dropdown sep-dropdown">
      <button
        className={`tv-icon-btn ${separatorTF ? 'active' : ''}`}
        id="btn-sep"
        onClick={() => toggleDropdown('sep')}
        title="Séparateurs de période"
      >
        <Columns size={16} strokeWidth={separatorTF ? 2.2 : 1.8} />
      </button>
      {activeDropdown === 'sep' && (
        <div className="tv-dropdown-menu sep-menu show sep-menu-list">
          <div className="sep-menu-title">Séparateurs de période</div>
          {[
            { tf: null, label: 'Désactivé', icon: <Slash size={12} strokeWidth={2} /> },
            { tf: '1D', label: 'Journalier (1D)', icon: <Calendar size={12} strokeWidth={2} />, cls: 'sep-color-day' },
            { tf: '1W', label: 'Hebdomadaire (1W)', icon: <CalendarRange size={12} strokeWidth={2} />, cls: 'sep-color-week' },
            { tf: '1M', label: 'Mensuel (1M)', icon: <CalendarDays size={12} strokeWidth={2} />, cls: 'sep-color-month' },
            { tf: '1Y', label: 'Annuel (1Y)', icon: <Clock size={12} strokeWidth={2} />, cls: 'sep-color-year' },
          ].map((s) => (
            <button type="button"
              key={String(s.tf)}
              className={`tv-dropdown-item ${separatorTF === s.tf ? 'active' : ''} sep-option`}
              onClick={() => {
                setSeparatorTF(s.tf as SeparatorTF);
                closeAllDropdowns();
                showToast(`Séparateurs : ${s.label}`, 'info', 2000);
              }}
            >
              <span className={`sep-icon ${s.cls || ''} sep-option-icon`}>
                {s.icon}
              </span>
              <span>{s.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
