import React, { useState } from 'react';
import { Search, Globe, X } from 'lucide-react';
import { useUIStore } from '../../store/useUIStore';
import { useMarketStore, ALL_MARKET_PAIRS, detectBaseTF } from '../../store/useMarketStore';
import { useReplayStore } from '../../store/useReplayStore';
import { fetchHistoricalData } from '../../services/historicalApi';
import { MarketPair } from '../../types/market';

export const LiveModal: React.FC = () => {
  const { activeModal, closeModal, showToast } = useUIStore();
  const {
    currentSymbol,
    historyRange,
    activeTF,
    setSymbol,
    setBaseCandles,
    setHistoryRange,
    setLiveConnected,
    setTimeframe,
  } = useMarketStore();

  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Tous');
  const [isLoading, setIsLoading] = useState(false);
  const [baseInterval, setBaseInterval] = useState<'1d' | '1h' | '15m' | '5m'>(() => {
    return activeTF <= 300 ? '5m' : activeTF <= 900 ? '15m' : activeTF <= 3600 ? '1h' : '1d';
  });

  if (activeModal !== 'live') return null;

  const categories = [
    'Tous',
    'Forex Majors',
    'Forex Minors',
    'Métaux & Matières',
    'Indices Mondiaux',
    'Indices Synthétiques (Deriv)',
    'Crypto',
  ];

  const intervalOptions = [
    { value: '1d', label: '📅 1 Jour (27 Ans - Replay Macro / Swing)' },
    { value: '1h', label: '⏱️ 1 Heure (10 000 barres / 2 Ans - Replay Intraday)' },
    { value: '15m', label: '⚡ 15 Min (10 000 barres - Replay Day Trading)' },
    { value: '5m', label: '🔬 5 Min (10 000 barres - Replay Scalping)' },
  ];

  const rangeOptions = [
    { value: '1y', label: '1 An (~260 barres D1 / 6 000 H1)' },
    { value: '2y', label: '2 Ans (12 350 barres H1)' },
    { value: '5y', label: '5 Ans (Recommandé)' },
    { value: '10y', label: '10 Ans (2 600 barres D1)' },
    { value: 'max', label: 'Historique Complet Max (Jusqu\'à 12 000 barres)' },
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
    setIsLoading(true);
    showToast(`Chargement de ${pair.symbol} en ${baseInterval.toUpperCase()} (${historyRange})...`, 'info', 3000);

    let candles: any = null;

    try {
      candles = await fetchHistoricalData(pair.symbol, baseInterval, historyRange);
    } catch (err) {
      console.warn('Fetch error:', err);
    }

    // Fallback if intraday not available for that specific pair
    if (!candles || !candles.length) {
      try {
        candles = await fetchHistoricalData(pair.symbol, '1d', historyRange);
      } catch {}
    }

    setIsLoading(false);

    if (candles && candles.length > 0) {
      useReplayStore.getState().resetReplay();
      const detectedTF = detectBaseTF(candles);
      setSymbol(pair.symbol);
      setBaseCandles(candles, detectedTF);
      setLiveConnected(true);
      setTimeframe(detectedTF);
      closeModal();
      showToast(
        `🟢 ${pair.symbol} : ${candles.length.toLocaleString()} bougies chargées (${detectedTF <= 3600 ? detectedTF / 60 + ' min' : '1 jour'}) — Prêt pour le Replay !`,
        'success',
        4000
      );
    } else {
      showToast(`Impossible de charger ${pair.symbol}. Réessayez avec une autre période.`, 'error', 3000);
    }
  };

  return (
    <div id="live-modal" className="custom-modal open" style={{ display: 'flex', opacity: 1 }} onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
      <div className="custom-modal-box" style={{ maxWidth: '720px' }}>
        <div className="custom-modal-header">
          <div className="custom-modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Globe size={16} strokeWidth={2} style={{ color: '#10B981' }} />
            <span>Marchés en Direct &amp; Backtest Replay (Profondeur Maximale)</span>
          </div>
          <button className="custom-modal-close" onClick={closeModal} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={15} strokeWidth={2.4} />
          </button>
        </div>

        <div className="custom-modal-body">
          {/* Controls: Search + Base TF + Range */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: '8px', marginBottom: '8px' }}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search size={13} strokeWidth={2} style={{ position: 'absolute', left: '10px', color: 'var(--text-muted)', pointerEvents: 'none' }} />
              <input
                type="text"
                placeholder="Rechercher (EURUSD, Gold, SPX500, BTC)..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  width: '100%',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '7px 10px 7px 30px',
                  color: 'var(--text-primary)',
                  fontSize: '11px',
                  outline: 'none',
                }}
              />
            </div>
            <select
              value={baseInterval}
              onChange={(e) => setBaseInterval(e.target.value as any)}
              title="Précision de base pour le Replay"
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid rgba(59, 130, 246, 0.4)',
                borderRadius: 'var(--radius-sm)',
                color: '#60A5FA',
                padding: '7px 8px',
                fontSize: '11px',
                fontWeight: 600,
                outline: 'none',
              }}
            >
              {intervalOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <select
              value={historyRange}
              onChange={(e) => setHistoryRange(e.target.value)}
              title="Profondeur d'historique à télécharger"
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
                padding: '7px 8px',
                fontSize: '11px',
                outline: 'none',
              }}
            >
              {rangeOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Replay Notice */}
          <div
            style={{
              background: 'rgba(59, 130, 246, 0.08)',
              border: '1px solid rgba(59, 130, 246, 0.22)',
              borderRadius: 'var(--radius-sm)',
              padding: '6px 10px',
              fontSize: '10.5px',
              color: '#93C5FD',
              marginBottom: '10px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>💡 <b>Replay Idéal</b> : En choisissant <b>1 Heure</b> ou <b>15 Min</b>, vous pouvez démarrer le Replay barre par barre et basculer vers 1H, 4H et 1J sans recharger !</span>
          </div>

          {/* Categories */}
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
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
                onClick={() => setSelectedCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>

          {/* List */}
          <div style={{ maxHeight: '48vh', overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '8px' }}>
            {filteredPairs.map((p) => {
              const isSelected = p.symbol === currentSymbol;
              return (
                <div
                  key={p.symbol}
                  className={`pair-card ${isSelected ? 'selected' : ''}`}
                  onClick={() => !isLoading && handleSelectPair(p)}
                  style={{
                    background: isSelected ? 'rgba(59, 130, 246, 0.15)' : 'var(--bg-elevated)',
                    border: isSelected ? '1px solid var(--accent)' : '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '8px 10px',
                    cursor: isLoading ? 'wait' : 'pointer',
                    opacity: isLoading ? 0.6 : 1,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                    <strong style={{ fontFamily: 'var(--mono)', fontSize: '13px' }}>{p.symbol}</strong>
                    <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>{p.category}</span>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {p.label}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="custom-modal-actions">
          <button className="btn-sm btn-danger" onClick={() => { setLiveConnected(false); closeModal(); }}>
            Déconnecter le flux
          </button>
          <button className="btn-sm" onClick={closeModal}>Fermer</button>
        </div>
      </div>
    </div>
  );
};
