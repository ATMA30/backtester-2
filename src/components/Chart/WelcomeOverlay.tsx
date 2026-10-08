import React, { useState } from 'react';
import { TrendingUp, UploadCloud } from 'lucide-react';
import { useMarketStore } from '../../store/useMarketStore';
import { useUIStore } from '../../store/useUIStore';
import { fetchHistoricalSeries, PROVENANCE_LABELS } from '../../services/historicalApi';

/** With nothing loaded: import a file, or try the demo series (with its spinner). */
export const WelcomeOverlay: React.FC = () => {
  const { displayCandles, setBaseCandles, setSymbol, setDataSource } = useMarketStore();
  const { openModal, showToast } = useUIStore();
  const [isLoading, setIsLoading] = useState(false);

  const loadDemo = async () => {
    setIsLoading(true);
    try {
      const series = await fetchHistoricalSeries({ symbol: 'EURUSD', interval: '1d', range: 'max' });
      if (!series.candles.length) {
        showToast('Aucune donnée disponible pour la démo.', 'error', 4000);
        return;
      }
      setSymbol('EURUSD');
      setBaseCandles(series.candles);
      setDataSource(`Données réelles · ${PROVENANCE_LABELS[series.provenance]}`, series.isSimulated);

      const count = series.candles.length.toLocaleString('fr-FR');
      showToast(
        series.isSimulated
          ? `Données simulées : aucune source n’a répondu. Résultats non exploitables.`
          : `EUR/USD chargé · ${count} bougies · ${PROVENANCE_LABELS[series.provenance]}`,
        series.isSimulated ? 'warning' : 'success',
        series.isSimulated ? 7000 : 3000
      );
    } catch (error) {
      console.warn('[TradingChart] demo load failed:', error);
      showToast('Échec du chargement de la démo.', 'error', 4000);
    } finally {
      // `finally` matters: the previous version left the spinner spinning
      // forever whenever the fetch threw.
      setIsLoading(false);
    }
  };

  return (
    <>
        {/* Loading Spinner */}
        {isLoading && (
          <div id="loading" className="chart-loading-layout">
            <div className="spinner" />
          </div>
        )}

        {/* Welcome Overlay if empty */}
        {displayCandles.length === 0 && !isLoading && (
          <div id="welcome-overlay">
            <div className="welcome-content">
              <div className="welcome-icon welcome-logo-center">
                <TrendingUp size={28} strokeWidth={2.5} className="welcome-logo-glyph" />
              </div>
              <div className="welcome-title">Rejouez le marché, <span>bougie par bougie</span></div>
              <div className="welcome-sub">
                Choisissez un instrument ou importez vos données pour commencer.
              </div>
              <button type="button"
                id="drop-zone"
                onClick={() => openModal('import')}
              >
                <div className="drop-icon welcome-drop-icon-center">
                  <UploadCloud size={30} strokeWidth={1.8} className="welcome-drop-glyph" />
                </div>
                <div className="drop-text">Déposez un CSV ou un JSON, ou parcourez</div>
                <div className="drop-hint">Colonnes attendues : date, open, high, low, close, volume</div>
                <div className="drop-formats">
                  <span className="fmt-badge">CSV</span>
                  <span className="fmt-badge">JSON</span>
                </div>
              </button>
              <button id="load-sample" onClick={loadDemo}>
                Essayer avec EUR/USD
              </button>
            </div>
          </div>
        )}
    </>
  );
};
