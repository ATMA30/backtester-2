import React from 'react';
import { ChevronDown, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useMarketStore } from '../../store/useMarketStore';
import { useUIStore } from '../../store/useUIStore';
import { IndicatorKind } from '../../types/market';

/** Add an indicator (through its settings dialog), or remove an active one. */
export const IndicatorsMenu: React.FC = () => {
  const activeIndicators = useMarketStore((m) => m.activeIndicators);
  const removeIndicator = useMarketStore((m) => m.removeIndicator);
  const { activeDropdown, toggleDropdown, closeAllDropdowns, openModal, setSelectedIndicatorType } = useUIStore();

  return (
  <div className="tv-dropdown">
    <button
      className="tv-dropdown-btn ind-trigger"
      id="btn-indicators"
      onClick={() => toggleDropdown('indicators')}
    >
      <SlidersHorizontal size={13} strokeWidth={2} style={{ color: activeIndicators.length > 0 ? '#3B82F6' : 'inherit' }} />
      <span>Indicateurs</span>
      {activeIndicators.length > 0 && (
        <span className="ind-count">
          {activeIndicators.length}
        </span>
      )}
      <ChevronDown size={11} strokeWidth={2.5} />
    </button>
    {activeDropdown === 'indicators' && (
      <div className="tv-dropdown-menu show ind-menu">
        <div className="dropdown-section-label ind-section-trend">
          TENDANCE
        </div>
        {[
          { type: 'EMA', label: 'EMA', desc: 'Moyenne Mobile Exponentielle' },
          { type: 'SMA', label: 'SMA', desc: 'Moyenne Mobile Simple' },
          { type: 'BB', label: 'Bandes de Bollinger', desc: 'Canal de volatilité (20, 2)' },
          { type: 'VWAP', label: 'VWAP', desc: 'Prix moyen pondéré par volume' },
        ].map((ind) => (
          <button type="button"
            key={ind.type}
            className="tv-dropdown-item ind-option"
            onClick={() => {
              setSelectedIndicatorType(ind.type as IndicatorKind);
              closeAllDropdowns();
              openModal('indicator-config');
            }}
          >
            <span className="ind-option-name">{ind.label}</span>
            <span className="ind-option-desc">{ind.desc}</span>
          </button>
        ))}

        <div className="dropdown-divider ind-divider" />
        <div className="dropdown-section-label ind-section-osc">
          OSCILLATEURS
        </div>
        {[
          { type: 'RSI', label: 'RSI', desc: 'Relative Strength Index (0-100)' },
          { type: 'MACD', label: 'MACD', desc: 'Convergence / Divergence (12, 26)' },
        ].map((ind) => (
          <button type="button"
            key={ind.type}
            className="tv-dropdown-item ind-option"
            onClick={() => {
              setSelectedIndicatorType(ind.type as IndicatorKind);
              closeAllDropdowns();
              openModal('indicator-config');
            }}
          >
            <span className="ind-option-name">{ind.label}</span>
            <span className="ind-option-desc">{ind.desc}</span>
          </button>
        ))}

        <div className="dropdown-divider ind-divider" />
        <div className="dropdown-section-label ind-section-active">Indicateurs actifs</div>
        <div id="active-indicators-list">
          {activeIndicators.length === 0 ? (
            <div className="ind-empty">
              Aucun indicateur actif
            </div>
          ) : (
            activeIndicators.map((i) => (
              <div key={i.id} className="active-ind-item ind-active-row">
                <span style={{ fontSize: '11.5px', fontWeight: 600, color: i.color }}>{i.type} ({i.period})</span>
                <button
                  onClick={(e) => { e.stopPropagation(); removeIndicator(i.id); }}
                  title="Retirer cet indicateur" className="ind-remove"
                >
                  <Trash2 size={12} strokeWidth={2} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    )}
  </div>
  );
};
