import React, { useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import { useUIStore } from '../../store/useUIStore';
import { useMarketStore } from '../../store/useMarketStore';

const DEFAULT_CONFIGS: Record<string, { period: number; color: string }> = {
  RSI: { period: 14, color: '#A78BFA' },
  MACD: { period: 12, color: '#3B82F6' },
  EMA: { period: 20, color: '#10B981' },
  SMA: { period: 50, color: '#F59E0B' },
  BB: { period: 20, color: '#06B6D4' },
  VWAP: { period: 1, color: '#EC4899' },
};

export const IndicatorConfigModal: React.FC = () => {
  const { activeModal, closeModal, selectedIndicatorType, showToast } = useUIStore();
  const { addIndicator } = useMarketStore();

  const defaultConfig = (selectedIndicatorType && DEFAULT_CONFIGS[selectedIndicatorType]) || { period: 20, color: '#3B82F6' };
  const [customPeriod, setCustomPeriod] = useState<number | null>(null);
  const [customColor, setCustomColor] = useState<string | null>(null);

  const period = customPeriod ?? defaultConfig.period;
  const selectedColor = customColor ?? defaultConfig.color;

  const isOscillator = selectedIndicatorType === 'RSI' || selectedIndicatorType === 'MACD';

  if (activeModal !== 'indicator-config' || !selectedIndicatorType) return null;

  const colorSwatches = [
    '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
    '#EC4899', '#06B6D4', '#F97316', '#FFFFFF', '#A78BFA'
  ];

  const handleConfirm = () => {
    addIndicator({
      id: 'ind_' + Date.now(),
      type: selectedIndicatorType,
      period: Number(period) || (isOscillator ? 14 : 20),
      color: selectedColor,
    });
    setCustomPeriod(null);
    setCustomColor(null);
    closeModal();
    showToast(`Indicateur ${selectedIndicatorType} (${period}) ajouté !`, 'success');
  };

  const handleClose = () => {
    setCustomPeriod(null);
    setCustomColor(null);
    closeModal();
  };

  return (
    <div id="indicator-modal" className="open" style={{ display: 'flex', opacity: 1 }} onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
      <div className="ind-modal-box" style={{ width: '380px' }}>
        <div className="ind-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <SlidersHorizontal size={16} strokeWidth={2} style={{ color: '#3B82F6' }} />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div className="ind-modal-title" id="ind-modal-title">Ajouter {selectedIndicatorType}</div>
              <div style={{ fontSize: '11px', color: isOscillator ? '#A78BFA' : '#3B82F6', fontWeight: 600, marginTop: '2px', letterSpacing: '0.4px' }}>
                {isOscillator ? 'Oscillateur' : 'Indicateur de Tendance'}
              </div>
            </div>
          </div>
          <button className="ind-modal-close" onClick={handleClose} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={15} strokeWidth={2.4} />
          </button>
        </div>

        {selectedIndicatorType !== 'VWAP' && (
          <div className="ind-field" id="ind-period-field">
            <label htmlFor="ind-period" id="ind-period-label">
              {selectedIndicatorType === 'MACD' ? 'Période Rapide' : 'Période (nb de bougies)'}
            </label>
            <input
              type="number"
              id="ind-period"
              value={period}
              onChange={(e) => setCustomPeriod(parseInt(e.target.value) || 1)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirm();
                if (e.key === 'Escape') handleClose();
              }}
            />
          </div>
        )}

        <div className="ind-field">
          <label>Couleur du tracé</label>
          <div className="ind-color-swatches" id="ind-color-swatches">
            {colorSwatches.map((c) => (
              <div
                key={c}
                className={`ind-color-swatch ${selectedColor === c ? 'active' : ''}`}
                style={{ background: c, width: 22, height: 22, borderRadius: 4, cursor: 'pointer', border: selectedColor === c ? '2px solid white' : '1px solid rgba(255,255,255,0.2)' }}
                onClick={() => setCustomColor(c)}
              />
            ))}
          </div>
        </div>

        <div className="ind-modal-actions">
          <button className="ind-btn-cancel" onClick={handleClose}>Annuler</button>
          <button className="ind-btn-confirm" onClick={handleConfirm}>Ajouter</button>
        </div>
      </div>
    </div>
  );
};
