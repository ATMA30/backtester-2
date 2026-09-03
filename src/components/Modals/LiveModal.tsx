import React, { useState } from 'react';
import { Search, Globe, X } from 'lucide-react';
import { useUIStore } from '../../store/useUIStore';
import { useMarketStore, ALL_MARKET_PAIRS, detectBaseTF } from '../../store/useMarketStore';
import { fetchHistoricalData } from '../../services/historicalApi';
import { fetchDerivMultiYear } from '../../services/derivWs';
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

  const rangeOptions = [
    { value: '1y', label: '1 An (~260 barres D1 / 6 000 H1)' },
    { value: '2y', label: '2 Ans (12 350 barres H1)' },
    { value: '5y', label: '5 Ans (Recommandé)' },
    { value: '10y', label: '10 Ans (2 600 barres D1)' },
    { value: 'max', label: 'Historique Complet Max (27 Ans - 1999 → 2026)' },
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
    showToast(`Chargement de ${pair.symbol} (${historyRange})...`, 'info', 2500);

    let candles: any = null;

    // 1. Try with user's desired interval
    try {
      const interval = activeTF <= 3600 ? '1h' : '1d';
      candles = await fetchHistoricalData(pair.symbol, interval, historyRange);
    } catch {}

    // 2. If null, fallback to 1d daily data
    if (!candles || !candles.length) {
      try {
        candles = await fetchHistoricalData(pair.symbol, '1d', historyRange);
      } catch {}
    }

    // 3. If still null and has derivSymbol, try Deriv WebSocket
    if ((!candles || !candles.length) && pair.derivSymbol) {
      try {
        const gran = activeTF <= 60 ? 60 : activeTF <= 3600 ? 3600 : 86400;
        candles = await fetchDerivMultiYear(pair.derivSymbol, gran, 10000);
      } catch {}
    }

    setIsLoading(false);

    if (candles && candles.length > 0) {
      const detectedTF = detectBaseTF(candles);
      setSymbol(pair.symbol);
      setBaseCandles(candles, detectedTF);
      setLiveConnected(true);
      if (activeTF < detectedTF) {
        setTimeframe(detectedTF);
      }
      closeModal();
      showToast(`${pair.symbol} : ${candles.length.toLocaleString()} bougies chargées (${historyRange})`, 'success', 3500);
    } else {
      showToast(`Impossible de charger ${pair.symbol}. Réessayez avec une autre période.`, 'error', 3000);
    }
  };

  return (
    <div id="live-modal" className="custom-modal open" style={{ display: 'flex', opacity: 1 }} onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
      <div className="custom-modal-box" style={{ maxWidth: '680px' }}>
        <div className="custom-modal-header">
          <div className="custom-modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Globe size={16} strokeWidth={2} style={{ color: '#10B981' }} />
            <span>Paires Forex &amp; Marchés en Direct (27 Ans d'historique)</span>
          </div>
          <button className="custom-modal-close" onClick={closeModal} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={15} strokeWidth={2.4} />
          </button>
        </div>

        <div className="custom-modal-body">
          {/* Controls */}
          <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
            <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center' }}>
              <Search size={13} strokeWidth={2} style={{ position: 'absolute', left: '10px', color: 'var(--text-muted)', pointerEvents: 'none' }} />
              <input
                type="text"
                placeholder="Rechercher (ex: EURUSD, Gold, SPX500, BTC)..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  width: '100%',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '8px 12px 8px 30px',
                  color: 'var(--text-primary)',
                  fontSize: '12px',
                  outline: 'none',
                }}
              />
            </div>
            <select
              value={historyRange}
              onChange={(e) => setHistoryRange(e.target.value)}
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
                padding: '8px 10px',
                fontSize: '11px',
                outline: 'none',
              }}
            >
              {rangeOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
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
