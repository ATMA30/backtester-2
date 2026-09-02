import React, { useState, useEffect } from 'react';
import { useUIStore } from '../../store/useUIStore';
import { useMarketStore } from '../../store/useMarketStore';

export const IndicatorConfigModal: React.FC = () => {
  const { activeModal, closeModal, selectedIndicatorType, showToast } = useUIStore();
  const { addIndicator } = useMarketStore();

  const [period, setPeriod] = useState(20);
  const [selectedColor, setSelectedColor] = useState('#3B82F6');

  const isOscillator = selectedIndicatorType === 'RSI' || selectedIndicatorType === 'MACD';

  useEffect(() => {
    if (selectedIndicatorType === 'RSI') {
      setPeriod(14);
      setSelectedColor('#A78BFA');
    } else if (selectedIndicatorType === 'MACD') {
      setPeriod(12);
      setSelectedColor('#3B82F6');
    } else if (selectedIndicatorType === 'EMA') {
      setPeriod(20);
      setSelectedColor('#10B981');
    } else if (selectedIndicatorType === 'SMA') {
      setPeriod(50);
      setSelectedColor('#F59E0B');
    } else if (selectedIndicatorType === 'BB') {
      setPeriod(20);
      setSelectedColor('#06B6D4');
    } else if (selectedIndicatorType === 'VWAP') {
      setPeriod(1);
      setSelectedColor('#EC4899');
    }
  }, [selectedIndicatorType]);

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
    closeModal();
    showToast(`Indicateur ${selectedIndicatorType} (${period}) ajouté !`, 'success');
  };

  return (
    <div id="indicator-modal" className="open" style={{ display: 'flex', opacity: 1 }} onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
      <div className="ind-modal-box" style={{ width: '380px' }}>
        <div className="ind-modal-header">
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="ind-modal-title" id="ind-modal-title">Ajouter {selectedIndicatorType}</div>
            <div style={{ fontSize: '11px', color: isOscillator ? '#A78BFA' : '#3B82F6', fontWeight: 600, marginTop: '2px', letterSpacing: '0.4px' }}>
              {isOscillator ? 'Oscillateur' : 'Indicateur de Tendance'}
            </div>
          </div>
          <button className="ind-modal-close" onClick={closeModal}>✕</button>
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
              onChange={(e) => setPeriod(parseInt(e.target.value) || 1)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirm();
                if (e.key === 'Escape') closeModal();
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
                onClick={() => setSelectedColor(c)}
              />
            ))}
          </div>
        </div>

        <div className="ind-modal-actions">
          <button className="ind-btn-cancel" onClick={closeModal}>Annuler</button>
          <button className="ind-btn-confirm" onClick={handleConfirm}>Ajouter</button>
        </div>
      </div>
    </div>
  );
};
