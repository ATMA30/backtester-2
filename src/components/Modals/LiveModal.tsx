import React, { useEffect, useRef, useState } from 'react';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import { Search, Globe, X, AlertTriangle } from 'lucide-react';
import { useUIStore } from '../../store/useUIStore';
import { useMarketStore, ALL_MARKET_PAIRS, detectBaseTF } from '../../store/useMarketStore';
import { useReplayStore } from '../../store/useReplayStore';
import { fetchHistoricalSeries, PROVENANCE_LABELS, HistoricalSeries } from '../../services/historicalApi';
import { MarketPair } from '../../types/market';
import { MARKET_CATEGORIES } from '../../domain/instruments';
import { estimateCoverage } from '../../domain/archive-limits';
import { TIMEFRAME_DEFS, secondsForInterval } from '../../domain/timeframes';

/** Granularités proposées, de la plus large à la plus fine. */
const INTERVAL_OPTIONS = [
  { value: '1d', label: '1 jour — swing et macro' },
  { value: '1h', label: '1 heure — intraday' },
  { value: '15m', label: '15 min — day trading' },
  { value: '5m', label: '5 min — scalping' },
] as const;

/** « 1825 jours » ne parle à personne ; « 5 ans » si. */
function describeDays(days: number): string {
  if (days >= 3_650) return 'maximale';
  if (days >= 365) {
    const years = Math.round(days / 365);
    return `${years} an${years > 1 ? 's' : ''}`;
  }
  if (days >= 60) return `${Math.round(days / 30)} mois`;
  return `${days} jours`;
}

export const LiveModal: React.FC = () => {
  const { activeModal, closeModal, openModal, showToast } = useUIStore();
  const {
    currentSymbol,
    historyRange,
    activeTF,
    setSymbol,
    setBaseCandles,
    setHistoryRange,
    setTimeframe,
    setDataSource,
  } = useMarketStore();

  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Tous');
  const [isLoading, setIsLoading] = useState(false);
  const [baseInterval, setBaseInterval] = useState<'1d' | '1h' | '15m' | '5m'>(() => {
    return activeTF <= 300 ? '5m' : activeTF <= 900 ? '15m' : activeTF <= 3600 ? '1h' : '1d';
  });
  const [loadError, setLoadError] = useState<{
    symbol: string;
    isSynthetic: boolean;
    message: string;
  } | null>(null);

  /** In-flight request, so a newer selection can cancel an older one. */
  const requestRef = useRef<AbortController | null>(null);

  const granularitySeconds = secondsForInterval(baseInterval);
  const coverage = estimateCoverage(granularitySeconds, historyRange, TIMEFRAME_DEFS);
  const granularityName =
    INTERVAL_OPTIONS.find((o) => o.value === baseInterval)?.label.split(' — ')[0] ?? baseInterval;

  // Abort on unmount. `App` mounts this modal only while it is open, so closing
  // it unmounts it: a slow download can no longer land after « Annuler » and
  // silently replace the chart — and, since the symbol changes, the account.
  useEffect(() => () => requestRef.current?.abort(), []);

  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, activeModal === 'live');

  if (activeModal !== 'live') return null;

  const categories = ['Tous', ...MARKET_CATEGORIES.filter((c) => c !== 'Personnalisé')];

  const rangeOptions = [
    { value: '1y', label: '1 an' },
    { value: '2y', label: '2 ans' },
    { value: '5y', label: '5 ans · recommandé' },
    { value: '10y', label: '10 ans' },
    { value: 'max', label: 'Maximum disponible' },
  ];

  const filteredPairs = ALL_MARKET_PAIRS.filter((p) => {
    const matchCat = selectedCategory === 'Tous' || p.category === selectedCategory;
    const matchSearch =
      !search ||
      p.symbol.toUpperCase().includes(search.toUpperCase()) ||
      p.label.toUpperCase().includes(search.toUpperCase());
    return matchCat && matchSearch;
  });

  const handleSelectPair = async (pair: MarketPair) => {
    setLoadError(null);
    setIsLoading(true);
    showToast(`Chargement de ${pair.symbol} en ${baseInterval.toUpperCase()} (${historyRange})...`, 'info', 3000);

    // Cancel any request still in flight: without this, selecting a slow pair
    // then a fast one let the slow response land last and overwrite the newer
    // data — including data the user had just imported.
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;

    let series: HistoricalSeries | null = null;
    const isSynthetic = pair.category === 'Indices Synthétiques (Deriv)';

    try {
      series = await fetchHistoricalSeries({
        symbol: pair.symbol,
        interval: baseInterval,
        range: historyRange,
        signal: controller.signal,
        allowSimulated: false, // Jamais de fausses données sans accord explicite de l'utilisateur
      });

      // Fall back to daily when the requested intraday depth is unavailable.
      if (!series.candles.length && baseInterval !== '1d') {
        const daily = await fetchHistoricalSeries({
          symbol: pair.symbol,
          interval: '1d',
          range: historyRange,
          signal: controller.signal,
          allowSimulated: false,
        });
        if (daily.candles.length) series = daily;
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      console.warn('[LiveModal] fetch error:', err);
    }

    if (controller.signal.aborted) return;
    requestRef.current = null;
    setIsLoading(false);

    if (!series || series.candles.length === 0) {
      setLoadError({
        symbol: pair.symbol,
        isSynthetic,
        message: isSynthetic
          ? "La passerelle WebSocket de Deriv n'a pas répondu (restrictions géographiques Cloudflare / erreur 520). Afin de garantir l'intégrité de vos backtests, aucune fausse donnée n'a été injectée sur votre graphique."
          : `Aucune source de cotations réelles n'a pu fournir d'historique pour ${pair.symbol}. Aucune fausse donnée n'a été chargée.`,
      });
      showToast(
        isSynthetic
          ? `Cotations Deriv non reçues pour ${pair.symbol}. Aucune fausse donnée chargée.`
          : `${pair.symbol} indisponible auprès des fournisseurs réels.`,
        'warning',
        5000
      );
      return;
    }

    const { candles } = series;
    useReplayStore.getState().resetReplay();
    const detectedTF = detectBaseTF(candles);
    setSymbol(pair.symbol);
    setBaseCandles(candles, detectedTF);
    setTimeframe(detectedTF);
    setDataSource(`Données réelles · ${PROVENANCE_LABELS[series.provenance]}`, false);
    closeModal();

    const resolution = TIMEFRAME_DEFS.find((d) => d.s === detectedTF)?.label ?? `${Math.round(detectedTF / 60)} min`;
    const incomplete = series.partial
      ? ' · historique incomplet : la connexion a été interrompue en cours de chargement, rechargez pour remonter plus loin.'
      : '';
    showToast(
      `${pair.symbol} chargé · ${candles.length.toLocaleString('fr-FR')} bougies ${resolution} · ${PROVENANCE_LABELS[series.provenance]}${incomplete}`,
      series.partial ? 'warning' : 'success',
      series.partial ? 8000 : 4000
    );
  };

  const handleLoadDemo = async (symbol: string) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const demoSeries = await fetchHistoricalSeries({
        symbol,
        interval: '1d',
        range: 'max',
        allowSimulated: true, // Choix délibéré de l'utilisateur pour tester l'interface
      });
      if (demoSeries.candles.length > 0) {
        useReplayStore.getState().resetReplay();
        const detectedTF = detectBaseTF(demoSeries.candles);
        setSymbol(symbol);
        setBaseCandles(demoSeries.candles, detectedTF);
        setTimeframe(detectedTF);
        setDataSource('Données de test simulées', true);
        closeModal();
        showToast(
          `Mode démo activé pour ${symbol} : bougies générées localement (non exploitables en trading réel).`,
          'warning',
          7000
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div id="live-modal" className="custom-modal open modal-overlay-open" onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
      <div className="custom-modal-box lm-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-label="Choisir un instrument">
        <div className="custom-modal-header">
          <div className="custom-modal-title modal-title-row">
            <Globe size={16} strokeWidth={2} className="lm-title-icon" />
            <span>Choisir un instrument</span>
          </div>
          <button className="custom-modal-close modal-close-btn" onClick={closeModal}>
            <X size={15} strokeWidth={2.4} />
          </button>
        </div>

        <div className="custom-modal-body">
          {/* Controls: Search + Base TF + Range */}
          <div className="lm-filters">
            <div className="lm-search">
              <Search size={13} strokeWidth={2} className="lm-search-icon" />
              <input
                type="text"
                placeholder="EURUSD, or, SPX500, BTC…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  if (loadError) setLoadError(null);
                }}
                className="lm-search-input"
              />
            </div>
            <label className="lm-field">
              <span className="lm-field-label">Granularité</span>
              <select
                className="lm-select accent"
                value={baseInterval}
                onChange={(e) => setBaseInterval(e.target.value as typeof baseInterval)}
              >
                {INTERVAL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <label className="lm-field">
              <span className="lm-field-label">Profondeur</span>
              <select
                className="lm-select"
                value={historyRange}
                onChange={(e) => setHistoryRange(e.target.value)}
              >
                {rangeOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
          </div>

          {/* Ce que la combinaison va réellement donner. Les deux menus étaient
              indépendants et muets : demander « 10 ans » en 5 min affichait
              « 10 ans » alors que la source s'arrête à 60 jours. */}
          <div className={`lm-coverage ${coverage.cappedByProvider ? 'is-capped' : ''}`}>
            <p className="lm-coverage-main">
              Bougies de <strong>{granularityName}</strong>, profondeur{' '}
              <strong>{describeDays(coverage.effectiveDays)}</strong>.
              {coverage.cappedByProvider && (
                <span className="lm-coverage-cap">
                  {' '}La source ne remonte pas plus loin à cette granularité : la profondeur
                  demandée est réduite d’office.
                </span>
              )}
            </p>
            <p className="lm-coverage-sub">
              C’est la précision la plus fine que vous aurez. Vous pourrez passer à{' '}
              {coverage.upgradableTo.length > 0 ? (
                <strong>{coverage.upgradableTo.slice(0, 5).join(', ')}</strong>
              ) : (
                <strong>une unité supérieure</strong>
              )}{' '}
              sans recharger ; descendre plus fin demandera un nouveau téléchargement.
            </p>
          </div>

          {/* Categories */}
          <div className="lm-categories">
            {categories.map((c) => (
              <button
                key={c}
                className={`cat-tab ${selectedCategory === c ? 'active' : ''}`}
                style={{
                  background: selectedCategory === c ? 'var(--accent)' : 'var(--bg-elevated)',
                  color: selectedCategory === c ? '#FFF' : 'var(--text-secondary)',
                  border: '1px solid var(--border)',
                  borderRadius: '20px',
                  padding: '4px 10px',
                  fontSize: '11px',
                  cursor: 'pointer',
                }}
                onClick={() => {
                  setSelectedCategory(c);
                  if (loadError) setLoadError(null);
                }}
              >
                {c}
              </button>
            ))}
          </div>

          {selectedCategory === 'Indices Synthétiques (Deriv)' && (
            <div className="lm-synthetic-hint">
              <span className="lm-synthetic-hint-icon">💡</span>
              <div>
                <strong>Accès Deriv en France / UE :</strong> Les passerelles publiques de Deriv sont souvent bloquées par Cloudflare depuis l’Europe. Pour des bougies réelles sans VPN, importez directement un export CSV depuis MT5 ou Deriv Bot via <em>Données &gt; Importer un fichier</em>.
              </div>
            </div>
          )}

          {loadError && (
            <div className="lm-error-box" role="alert">
              <div className="lm-error-head">
                <AlertTriangle size={16} className="lm-error-icon" />
                <strong>Données réelles non reçues pour {loadError.symbol}</strong>
              </div>
              <p className="lm-error-text">
                {loadError.message}
              </p>
              <div className="lm-error-actions">
                <button
                  type="button"
                  className="btn-sm btn-primary"
                  onClick={() => {
                    closeModal();
                    openModal('import');
                  }}
                >
                  📂 Importer un fichier CSV réel (Recommandé)
                </button>
                <button
                  type="button"
                  className="btn-sm"
                  onClick={() => {
                    const p = ALL_MARKET_PAIRS.find((item) => item.symbol === loadError.symbol);
                    if (p) void handleSelectPair(p);
                  }}
                >
                  🔄 Réessayer
                </button>
                <button
                  type="button"
                  className="lm-demo-btn"
                  onClick={() => void handleLoadDemo(loadError.symbol)}
                  title="Générer un mouvement brownien local pour tester l'interface graphique"
                >
                  🧪 Démo simulée (test uniquement)
                </button>
              </div>
            </div>
          )}

          {/* List */}
          <div className="lm-grid">
            {filteredPairs.map((p) => {
              const isSelected = p.symbol === currentSymbol;
              return (
                <button
                  type="button"
                  key={p.symbol}
                  className={`pair-card ${isSelected ? 'selected' : ''}`}
                  onClick={() => void handleSelectPair(p)}
                  disabled={isLoading}
                  aria-pressed={isSelected}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    font: 'inherit',
                    color: 'inherit',
                    background: isSelected ? 'rgba(59, 130, 246, 0.15)' : 'var(--bg-elevated)',
                    border: isSelected ? '1px solid var(--accent)' : '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '8px 10px',
                    cursor: isLoading ? 'wait' : 'pointer',
                    opacity: isLoading ? 0.6 : 1,
                  }}
                >
                  <div className="lm-pair-head">
                    <strong className="lm-pair-symbol">{p.symbol}</strong>
                    <span className="lm-pair-category">{p.category}</span>
                  </div>
                  <div className="lm-pair-label">
                    {p.label}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="custom-modal-actions">
          <button className="btn-sm" onClick={closeModal}>Annuler</button>
        </div>
      </div>
    </div>
  );
};
