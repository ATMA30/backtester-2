import React, { useState, useRef } from 'react';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import { SlidersHorizontal, X } from 'lucide-react';
import { useUIStore } from '../../store/useUIStore';
import { useMarketStore } from '../../store/useMarketStore';
import { newId } from '../../utils/id';
import { IndicatorKind } from '../../types/market';

/**
 * Bounds on the period.
 *
 * The field accepted any integer, while the settings reader
 * (`parseIndicators`) drops anything above 5000 on the next reload — so an
 * indicator configured at 10 000 worked until the page was refreshed and then
 * vanished without a word. Same rule, one place, enforced at entry.
 */
const MIN_PERIOD = 1;
const MAX_PERIOD = 5_000;

const DEFAULT_CONFIGS: Record<string, { period: number; color: string }> = {
  RSI: { period: 14, color: '#A78BFA' },
  MACD: { period: 12, color: '#3B82F6' },
  EMA: { period: 20, color: '#10B981' },
  SMA: { period: 50, color: '#F59E0B' },
  BB: { period: 20, color: '#06B6D4' },
  VWAP: { period: 1, color: '#EC4899' },
};

/** Keep the period inside the range the persistence layer will accept. */
function clampPeriod(value: number, fallback: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_PERIOD, Math.max(MIN_PERIOD, n));
}

/**
 * Read the period field.
 *
 * `parseInt(v) || 1` turned an emptied field into 1 rather than leaving the
 * default in place, so clearing the input to retype silently committed a
 * 1-period average. `null` means "no override yet".
 */
function readPeriodInput(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? Math.min(MAX_PERIOD, Math.max(MIN_PERIOD, n)) : null;
}

export const IndicatorConfigModal: React.FC = () => {
  const { activeModal, closeModal, selectedIndicatorType, showToast } = useUIStore();
  const { addIndicator } = useMarketStore();

  const defaultConfig = (selectedIndicatorType && DEFAULT_CONFIGS[selectedIndicatorType]) || { period: 20, color: '#3B82F6' };
  const [customPeriod, setCustomPeriod] = useState<number | null>(null);
  const [customColor, setCustomColor] = useState<string | null>(null);

  const period = customPeriod ?? defaultConfig.period;
  const selectedColor = customColor ?? defaultConfig.color;

  const isOscillator = selectedIndicatorType === 'RSI' || selectedIndicatorType === 'MACD';

  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, activeModal === 'indicator-config' && Boolean(selectedIndicatorType));

  if (activeModal !== 'indicator-config' || !selectedIndicatorType) return null;

  const colorSwatches = [
    '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
    '#EC4899', '#06B6D4', '#F97316', '#FFFFFF', '#A78BFA'
  ];

  const handleConfirm = () => {
    addIndicator({
      // `'ind_' + Date.now()` collided for two indicators added within the same
      // millisecond, and `addIndicator` de-duplicates by id — so the second one
      // was silently dropped.
      id: newId('ind'),
      type: selectedIndicatorType as IndicatorKind,
      period: clampPeriod(period, isOscillator ? 14 : 20),
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
    <div id="indicator-modal" className="open u-display-flex u-opacity-1" onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
      <div className="ind-modal-box u-width-380px" ref={dialogRef} role="dialog" aria-modal="true" aria-label="Réglages de l’indicateur">
        <div className="ind-modal-header">
          <div className="u-display-flex u-align-items-center u-gap-8px">
            <SlidersHorizontal size={16} strokeWidth={2} className="u-color-3b82f6" />
            <div className="u-display-flex u-flex-direction-column">
              <div className="ind-modal-title" id="ind-modal-title">Ajouter {selectedIndicatorType}</div>
              <div style={{ fontSize: '11px', color: isOscillator ? '#A78BFA' : '#3B82F6', fontWeight: 600, marginTop: '2px', letterSpacing: '0.4px' }}>
                {isOscillator ? 'Oscillateur' : 'Indicateur de Tendance'}
              </div>
            </div>
          </div>
          <button className="ind-modal-close u-display-flex u-align-items-center u-justify-content-center" onClick={handleClose}>
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
              min={MIN_PERIOD}
              max={MAX_PERIOD}
              onChange={(e) => setCustomPeriod(readPeriodInput(e.target.value))}
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
          <button className="ind-btn-confirm" onClick={handleConfirm}>Ajouter l’indicateur</button>
        </div>
      </div>
    </div>
  );
};
