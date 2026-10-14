import React from 'react';
import { Play } from 'lucide-react';
import { useMarketStore } from '../../store/useMarketStore';
import { useReplayStore } from '../../store/useReplayStore';
import { useUIStore } from '../../store/useUIStore';
import { deleteDataset } from '../../services/db';
import { fetchHistoricalSeries, PROVENANCE_LABELS } from '../../services/historicalApi';

/** Provenance first, then the candles shown and their range, and whether a replay runs. */
export const StatusBar: React.FC = () => {
  const { displayCandles, dataSourceLabel, isSimulatedData } = useMarketStore();
  const isReplayActive = useReplayStore((r) => r.isActive);

  const firstCandle = displayCandles[0];
  const lastCandle = displayCandles[displayCandles.length - 1];

  const dateRangeStr =
    firstCandle && lastCandle
      ? `${new Date(firstCandle.time * 1000).toLocaleDateString('fr-FR')} → ${new Date(
          lastCandle.time * 1000
        ).toLocaleDateString('fr-FR')}`
      : '';

  // `Connecté` was shown as soon as candles were in memory, even offline — it
  // described a connection that did not exist. State the truth instead.
  const statusLabel = !displayCandles.length
    ? 'Aucune donnée'
    : isSimulatedData
      ? 'Données simulées'
      : (dataSourceLabel ?? 'Données chargées');

  const provenanceTitle = isSimulatedData
    ? 'Série générée localement : aucune source de marché n’a répondu. Résultats non exploitables.'
    : dataSourceLabel
      ? `Origine des bougies : ${dataSourceLabel}`
      : 'Origine des données inconnue';

  const handleReloadLive = async () => {
    const currentSymbol = useMarketStore.getState().currentSymbol;
    try {
      await deleteDataset(currentSymbol);
      const series = await fetchHistoricalSeries({ symbol: currentSymbol, interval: '1d', range: 'max' });
      if (series.candles.length) {
        useMarketStore.getState().setBaseCandles(series.candles);
        useMarketStore.getState().setDataSource(`Données réelles · ${PROVENANCE_LABELS[series.provenance]}`, series.isSimulated);
        const count = series.candles.length.toLocaleString('fr-FR');
        useUIStore.getState().showToast(`${currentSymbol} actualisé · ${count} bougies · ${PROVENANCE_LABELS[series.provenance]}`, 'success');
      }
    } catch (e) {
      console.warn('[StatusBar] reload failed:', e);
    }
  };

  return (
    <div id="statusbar">
      <div className="status-item" title={provenanceTitle}>
        <div
          className={`status-dot ${isSimulatedData ? 'simulated' : 'online'}`}
          id="status-dot"
        />
        <span id="status-text">{statusLabel}</span>
        {statusLabel === 'Sauvegarde locale' && (
          <button
            type="button"
            className="status-reload-action"
            onClick={handleReloadLive}
            title="Télécharger les dernières cotations en ligne avec mèches complètes"
          >
            Actualiser en ligne
          </button>
        )}
      </div>
      {displayCandles.length > 0 && (
        <>
          <div className="status-item" id="status-rows">
            <span><strong id="rows-count">{displayCandles.length.toLocaleString('fr-FR')}</strong> bougies</span>
          </div>
          <div className="status-item" id="status-range">
            <span id="range-text">{dateRangeStr}</span>
          </div>
        </>
      )}
      {isReplayActive && (
        <div className="status-item status-replay" id="status-replay">
          <span className="status-replay-icon status-replay-icon-layout">
            <Play size={11} strokeWidth={2.4} fill="currentColor" />
          </span>
          <span id="replay-status-text">Replay en cours</span>
        </div>
      )}
    </div>
  );
};
