import React, { useState } from 'react';
import { X, Search, Globe, Zap, Check } from 'lucide-react';
import { useMarketStore, ALL_MARKET_PAIRS } from '../../store/useMarketStore';
import { useUIStore } from '../../store/useUIStore';
import { fetchHistoricalData } from '../../services/historicalApi';
import { fetchDerivMultiYear } from '../../services/derivWs';
import { MarketPair } from '../../types/market';

export const LiveMarketModal: React.FC = () => {
  const { activeModal, closeModal, showToast } = useUIStore();
  const {
    currentSymbol,
    historyRange,
    activeTF,
    setSymbol,
    setBaseCandles,
    setHistoryRange,
    setLiveConnected,
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
    showToast(`Chargement de ${pair.symbol} (${historyRange})...`, 'info', 3000);

    let candles: any = null;

    // 1. Try Historical API (BCE 27y / Yahoo 10y)
    try {
      const interval = activeTF <= 3600 ? '1h' : '1d';
      candles = await fetchHistoricalData(pair.symbol, interval, historyRange);
    } catch (e) {}

    // 2. Try Deriv WebSocket for Synthetics or if empty
    if ((!candles || !candles.length) && pair.derivSymbol) {
      try {
        const gran = activeTF <= 60 ? 60 : activeTF <= 3600 ? 3600 : 86400;
        candles = await fetchDerivMultiYear(pair.derivSymbol, gran, 10000);
      } catch (e) {}
    }

    setIsLoading(false);

    if (candles && candles.length > 0) {
      setSymbol(pair.symbol);
      setBaseCandles(candles);
      setLiveConnected(true);
      closeModal();
      showToast(`🟢 ${pair.symbol} : ${candles.length.toLocaleString()} bougies réelles chargées !`, 'success', 3000);
    } else {
      showToast(`Erreur de connexion pour ${pair.symbol}`, 'error');
    }
  };

  return (
    <div className="modal-backdrop" onClick={closeModal}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <Globe size={18} className="text-primary" />
            <span>Marchés & Historique Multi-Années</span>
          </div>
          <button className="modal-close" onClick={closeModal}>
            <X size={18} />
          </button>
        </div>

        {/* Controls */}
        <div className="modal-controls">
          <div className="search-bar">
            <Search size={16} className="search-icon" />
            <input
              type="text"
              placeholder="Rechercher une paire (ex: EURUSD, XAUUSD, SPX500, BTC...)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="range-picker">
            <label>📅 Période :</label>
            <select
              value={historyRange}
              onChange={(e) => setHistoryRange(e.target.value)}
            >
              {rangeOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Category Tabs */}
        <div className="category-tabs">
          {categories.map((c) => (
            <button
              key={c}
              className={`cat-tab ${selectedCategory === c ? 'active' : ''}`}
              onClick={() => setSelectedCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>

        {/* Pairs Grid */}
        <div className="pairs-grid">
          {filteredPairs.map((p) => {
            const isSelected = p.symbol === currentSymbol;
            return (
              <div
                key={p.symbol}
                className={`pair-card ${isSelected ? 'selected' : ''}`}
                onClick={() => handleSelectPair(p)}
              >
                <div className="pair-card-header">
                  <span className="pair-sym">{p.symbol}</span>
                  <span className="pair-cat">{p.category}</span>
                </div>
                <div className="pair-name">{p.label}</div>
                {isSelected && <Check size={16} className="pair-check" />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
