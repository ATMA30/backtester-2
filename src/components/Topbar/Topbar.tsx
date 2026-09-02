import React from 'react';
import { useMarketStore, TIMEFRAME_DEFS } from '../../store/useMarketStore';
import { useReplayStore } from '../../store/useReplayStore';
import { useUIStore } from '../../store/useUIStore';

export const Topbar: React.FC = () => {
  const {
    currentSymbol,
    activeTF,
    baseTF,
    chartType,
    showVolume,
    showGrid,
    soundEnabled,
    separatorTF,
    forexSessions,
    activeIndicators,
    displayCandles,
    setTimeframe,
    setChartType,
    toggleVolume,
    toggleGrid,
    toggleSound,
    triggerFitContent,
    setSeparatorTF,
    toggleForexSession,
    toggleForexLocalTz,
    removeIndicator,
  } = useMarketStore();

  const { isActive: isReplayActive, isPicking, setIsActive, setIsPicking } = useReplayStore();
  const { activeDropdown, toggleDropdown, closeAllDropdowns, openModal, setSelectedIndicatorType, showToast } = useUIStore();

  const lastCandle = displayCandles[displayCandles.length - 1];
  const lastPrice = lastCandle ? lastCandle.close : 0;
  const firstCandle = displayCandles[0];
  const changePercent =
    firstCandle && firstCandle.open > 0 && lastCandle
      ? ((lastCandle.close - firstCandle.open) / firstCandle.open) * 100
      : 0;

  const currentTFDef = TIMEFRAME_DEFS.find((t) => t.s === activeTF) || { label: '1D' };
  const baseTFDef = TIMEFRAME_DEFS.find((t) => t.s === baseTF) || { label: '1D' };

  const exportCSV = () => {
    if (!displayCandles.length) return;
    const header = 'time,open,high,low,close,volume\n';
    const rows = displayCandles
      .map((c) => `${c.time},${c.open},${c.high},${c.low},${c.close},${c.volume}`)
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentSymbol}_${currentTFDef.label}_export.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Export CSV téléchargé !', 'success');
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      showToast('⛶ Mode Immersion plein écran activé', 'info', 2000);
    } else {
      document.exitFullscreen().catch(() => {});
      showToast('Sortie du mode immersion', 'info', 2000);
    }
  };

  const getMarketBadge = (symbol: string) => {
    const s = symbol.toUpperCase();
    if (s.startsWith('R_') || s.includes('VOLATILITY') || s.includes('BOOM') || s.includes('CRASH') || s.includes('STEP') || s.includes('JUMP') || s.includes('1HZ')) {
      return { label: 'SYNTH', type: 'synth' };
    }
    if (s.includes('BTC') || s.includes('ETH') || s.includes('SOL') || s.includes('XRP') || s.includes('BNB') || s.includes('DOGE') || s.includes('CRYPTO')) {
      return { label: 'CRYPTO', type: 'crypto' };
    }
    if (s.includes('SPX') || s.includes('NAS') || s.includes('US30') || s.includes('GER40') || s.includes('CAC40') || s.includes('INDEX')) {
      return { label: 'INDEX', type: 'index' };
    }
    if (s.includes('XAU') || s.includes('GOLD') || s.includes('OIL') || s.includes('XAG') || s.includes('BRENT')) {
      return { label: 'COMMO', type: 'commo' };
    }
    return { label: 'FX', type: 'fx' };
  };

  const marketBadge = getMarketBadge(currentSymbol);

  return (
    <div id="topbar">
      {/* Left group: asset selector + witnesses + segmented tools */}
      <div className="topbar-left">
        {/* 1. Interactive Asset Selector & Semantic Variation */}
        <div
          id="topbar-ticker"
          className="topbar-asset-selector"
          onClick={() => openModal('live')}
          title="Changer d'actif / Recherche de symboles"
        >
          <span className={`market-badge ${marketBadge.type}`}>{marketBadge.label}</span>
          <span id="ticker-symbol" className="ticker-symbol">{currentSymbol}</span>
          <svg className="ticker-chevron" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
          <div className="ticker-sep" />
          <span id="ticker-price" className="ticker-price">
            {lastPrice > 0 ? lastPrice.toFixed(lastPrice < 10 ? 5 : 2) : '—'}
          </span>
          <span
            id="ticker-change"
            className={`ticker-change-pill ${changePercent >= 0 ? 'bull' : 'bear'}`}
          >
            <span className="ticker-change-arrow">{changePercent >= 0 ? '▲' : '▼'}</span>
            <span>{changePercent >= 0 ? '+' : ''}{changePercent.toFixed(2)}%</span>
          </span>
        </div>

        {/* 2. Passive Technical Witnesses (Live Flux & Sync Status) */}
        <div
          className="topbar-witness-badge"
          onClick={() => openModal('live')}
          title="24 ms — Flux en direct connecté (Cliquez pour configurer)"
        >
          <span className="witness-dot live" />
          <span className="witness-label">24 ms</span>
        </div>

        <div
          className="topbar-witness-badge"
          onClick={() => openModal('datasets')}
          title="Base locale — Données synchronisées et sauvegardées"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 16.9A5 5 0 0 0 18 7h-1.26a8 8 0 1 0-11.62 9" />
            <polyline points="13 11 16 14 19 11" />
          </svg>
          <span className="witness-label">Sauvegardé</span>
        </div>

        <div className="topbar-divider" />

        {/* 3. BLOC VUES & OUTILS: Volumes, Grille, Séparateurs, Sessions Forex, Immersion, Capture, Sons */}
        <div className="topbar-icon-group">
          {/* Volume */}
          <button
            className={`tv-icon-btn ${showVolume ? 'active' : ''}`}
            id="btn-volume"
            onClick={toggleVolume}
            title={showVolume ? 'Volume histogramme (Activé)' : 'Volume histogramme (Désactivé)'}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="14" width="4" height="6" rx="1" />
              <rect x="9" y="9" width="4" height="11" rx="1" />
              <rect x="16" y="4" width="4" height="16" rx="1" />
            </svg>
          </button>

          {/* Grille */}
          <button
            className={`tv-icon-btn ${showGrid ? 'active' : ''}`}
            id="btn-grid"
            onClick={toggleGrid}
            title={showGrid ? 'Grille graphique (Activée)' : 'Grille graphique (Désactivée)'}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
              <line x1="3" y1="15" x2="21" y2="15" />
              <line x1="9" y1="3" x2="9" y2="21" />
              <line x1="15" y1="3" x2="15" y2="21" />
            </svg>
          </button>

          {/* Séparateurs de période & session */}
          <div className="tv-dropdown sep-dropdown">
            <button
              className={`tv-icon-btn ${separatorTF ? 'active' : ''}`}
              id="btn-sep"
              onClick={() => toggleDropdown('sep')}
              title="Séparateurs de session / période"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <line x1="8" y1="3" x2="8" y2="21" />
                <line x1="16" y1="3" x2="16" y2="21" />
                <line x1="3" y1="12" x2="5" y2="12" />
                <line x1="11" y1="12" x2="13" y2="12" />
                <line x1="19" y1="12" x2="21" y2="12" />
              </svg>
            </button>
            {activeDropdown === 'sep' && (
              <div className="tv-dropdown-menu sep-menu show" style={{ display: 'block' }}>
                <div className="sep-menu-title">Séparateurs de période</div>
                {[
                  { tf: null, label: 'Désactivé', icon: '✕' },
                  { tf: '1D', label: 'Journalier (1D)', icon: '│', cls: 'sep-color-day' },
                  { tf: '1W', label: 'Hebdomadaire (1W)', icon: '│', cls: 'sep-color-week' },
                  { tf: '1M', label: 'Mensuel (1M)', icon: '│', cls: 'sep-color-month' },
                  { tf: '1Y', label: 'Annuel (1Y)', icon: '│', cls: 'sep-color-year' },
                ].map((s) => (
                  <div
                    key={String(s.tf)}
                    className={`tv-dropdown-item ${separatorTF === s.tf ? 'active' : ''}`}
                    onClick={() => {
                      setSeparatorTF(s.tf as any);
                      closeAllDropdowns();
                      showToast(`Séparateurs : ${s.label}`, 'info', 2000);
                    }}
                  >
                    <span className={`sep-icon ${s.cls || ''}`}>{s.icon}</span> {s.label}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Sessions Forex */}
          <div className="tv-dropdown">
            <button
              className={`tv-icon-btn ${forexSessions.london || forexSessions.newyork || forexSessions.tokyo || forexSessions.sydney ? 'active' : ''}`}
              id="btn-forex"
              onClick={() => toggleDropdown('forex')}
              title="Sessions Forex & Fuseaux horaires (Londres, New York, Tokyo, Sydney)"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <polyline points="12 7 12 12 15.5 15.5" />
              </svg>
            </button>
            {activeDropdown === 'forex' && (
              <div className="tv-dropdown-menu forex-menu show" style={{ display: 'block', minWidth: '220px' }}>
                <div className="sep-menu-title">Sessions Forex (UTC)</div>
                <div className="forex-session-row" onClick={(e) => { e.stopPropagation(); toggleForexSession('all'); }}>
                  <span className="forex-dot" style={{ background: 'linear-gradient(90deg,#A78BFA,#FB923C,#60A5FA,#34D399)' }} />
                  <span style={{ fontWeight: 600 }}>Tout activer / désactiver</span>
                </div>
                <div className="dropdown-divider" />
                <div className="forex-session-row" onClick={(e) => { e.stopPropagation(); toggleForexSession('sydney'); }}>
                  <span className="forex-dot" style={{ background: '#A78BFA' }} />
                  <span className="forex-name">Sydney</span>
                  <span className="forex-hours">22h – 07h</span>
                  <input type="checkbox" checked={forexSessions.sydney} onChange={() => {}} />
                </div>
                <div className="forex-session-row" onClick={(e) => { e.stopPropagation(); toggleForexSession('tokyo'); }}>
                  <span className="forex-dot" style={{ background: '#FB923C' }} />
                  <span className="forex-name">Tokyo</span>
                  <span className="forex-hours">00h – 09h</span>
                  <input type="checkbox" checked={forexSessions.tokyo} onChange={() => {}} />
                </div>
                <div className="forex-session-row" onClick={(e) => { e.stopPropagation(); toggleForexSession('london'); }}>
                  <span className="forex-dot" style={{ background: '#60A5FA' }} />
                  <span className="forex-name">Londres</span>
                  <span className="forex-hours">08h – 17h</span>
                  <input type="checkbox" checked={forexSessions.london} onChange={() => {}} />
                </div>
                <div className="forex-session-row" onClick={(e) => { e.stopPropagation(); toggleForexSession('newyork'); }}>
                  <span className="forex-dot" style={{ background: '#34D399' }} />
                  <span className="forex-name">New York</span>
                  <span className="forex-hours">13h – 22h</span>
                  <input type="checkbox" checked={forexSessions.newyork} onChange={() => {}} />
                </div>
                <div className="dropdown-divider" />
                <div className="forex-session-row" onClick={(e) => { e.stopPropagation(); toggleForexLocalTz(); }}>
                  <span className="forex-dot" style={{ background: 'var(--gold)' }} />
                  <span className="forex-name">Mon fuseau horaire</span>
                  <input type="checkbox" checked={forexSessions.useLocalTz} onChange={() => {}} />
                </div>
              </div>
            )}
          </div>

          {/* Mode Immersion / Plein écran */}
          <button
            className="tv-icon-btn"
            id="btn-fullscreen"
            onClick={toggleFullscreen}
            title="Mode Immersion / Plein Écran (F)"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
            </svg>
          </button>

          {/* Capture d'écran HD */}
          <button
            className="tv-icon-btn"
            id="btn-snapshot"
            onClick={() => openModal('snapshot')}
            title="Capture d'écran HD (P)"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          </button>

          {/* Sons de trading */}
          <button
            className={`tv-icon-btn ${soundEnabled ? 'active' : ''}`}
            id="btn-sound"
            onClick={toggleSound}
            title={soundEnabled ? 'Effets sonores (Activés)' : 'Effets sonores (Désactivés / Muet)'}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
            </svg>
          </button>
        </div>

        {/* Séparateur large avant Replay */}
        <div className="topbar-divider topbar-divider-replay" />

        {/* 4. BLOC REPLAY TEMPOREL (Séparé et mis en valeur) */}
        <div className="topbar-icon-group topbar-replay-group">
          <button
            className={`tv-icon-btn replay-btn-prominent ${isReplayActive || isPicking ? 'active' : ''}`}
            id="btn-replay"
            onClick={() => {
              if (isReplayActive || isPicking) {
                setIsActive(false);
                setIsPicking(false);
                showToast('Mode Replay quitté', 'info');
              } else {
                setIsPicking(true);
                showToast('Cliquez sur une bougie pour lancer le replay', 'info');
              }
            }}
            title="Mode Replay temporel (Raccourci : Espace)"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none" />
            </svg>
          </button>
        </div>
      </div>

      {/* Right group: selectors + import */}
      <div className="topbar-right">
        {/* Timeframe picker */}
        <div className="tv-dropdown">
          <button
            className="tv-dropdown-btn"
            id="btn-active-tf"
            onClick={() => toggleDropdown('tf')}
          >
            <span>{currentTFDef.label}</span>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {activeDropdown === 'tf' && (
            <div className="tv-dropdown-menu show" style={{ display: 'block', minWidth: '170px' }}>
              <div id="tf-group">
                {TIMEFRAME_DEFS.map((t) => {
                  const isAvailable = t.s >= baseTF;
                  return (
                    <div
                      key={t.s}
                      className={`tv-dropdown-item ${t.s === activeTF ? 'active' : ''} ${!isAvailable ? 'disabled' : ''}`}
                      onClick={() => {
                        if (!isAvailable) {
                          showToast(`Timeframe ${t.label} indisponible (base du dataset : ${baseTFDef.label})`, 'warning', 2500);
                          return;
                        }
                        setTimeframe(t.s);
                        closeAllDropdowns();
                        showToast(`Timeframe : ${t.label}`, 'info', 1500);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        opacity: isAvailable ? 1 : 0.35,
                        cursor: isAvailable ? 'pointer' : 'not-allowed',
                      }}
                    >
                      <span>{t.label}</span>
                      {!isAvailable && (
                        <span style={{ fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                          indisponible
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Chart type */}
        <div className="tv-dropdown">
          <button
            className="tv-dropdown-btn"
            id="btn-active-ctype"
            onClick={() => toggleDropdown('ctype')}
          >
            <span>
              {chartType === 'Candlestick'
                ? 'Chandeliers'
                : chartType === 'Bar'
                ? 'Barres'
                : chartType === 'Line'
                ? 'Ligne'
                : 'Aire'}
            </span>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {activeDropdown === 'ctype' && (
            <div className="tv-dropdown-menu show" style={{ display: 'block' }}>
              {(['Candlestick', 'Bar', 'Line', 'Area'] as const).map((type) => (
                <div
                  key={type}
                  className={`tv-dropdown-item ${chartType === type ? 'active' : ''}`}
                  onClick={() => {
                    setChartType(type);
                    closeAllDropdowns();
                  }}
                >
                  {type === 'Candlestick'
                    ? 'Chandeliers'
                    : type === 'Bar'
                    ? 'Barres'
                    : type === 'Line'
                    ? 'Ligne'
                    : 'Aire'}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Indicators */}
        <div className="tv-dropdown">
          <button
            className="tv-dropdown-btn"
            id="btn-indicators"
            onClick={() => toggleDropdown('indicators')}
          >
            <span>ƒx Indicateurs</span>
          </button>
          {activeDropdown === 'indicators' && (
            <div className="tv-dropdown-menu show" style={{ minWidth: '230px', display: 'block', padding: '6px' }}>
              <div className="dropdown-section-label" style={{ color: '#3B82F6', fontWeight: 700, padding: '4px 8px', fontSize: '10.5px', letterSpacing: '0.8px' }}>
                TENDANCE
              </div>
              {[
                { type: 'EMA', label: 'EMA', desc: 'Moyenne Mobile Exponentielle' },
                { type: 'SMA', label: 'SMA', desc: 'Moyenne Mobile Simple' },
                { type: 'BB', label: 'Bandes de Bollinger', desc: 'Canal de volatilité (20, 2)' },
                { type: 'VWAP', label: 'VWAP', desc: 'Prix moyen pondéré par volume' },
              ].map((ind) => (
                <div
                  key={ind.type}
                  className="tv-dropdown-item"
                  onClick={() => {
                    setSelectedIndicatorType(ind.type as any);
                    closeAllDropdowns();
                    openModal('indicator-config');
                  }}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: '6px 8px' }}
                >
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{ind.label}</span>
                  <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>{ind.desc}</span>
                </div>
              ))}

              <div className="dropdown-divider" style={{ margin: '6px 0' }} />
              <div className="dropdown-section-label" style={{ color: '#A78BFA', fontWeight: 700, padding: '4px 8px', fontSize: '10.5px', letterSpacing: '0.8px' }}>
                OSCILLATEURS
              </div>
              {[
                { type: 'RSI', label: 'RSI', desc: 'Relative Strength Index (0-100)' },
                { type: 'MACD', label: 'MACD', desc: 'Convergence / Divergence (12, 26)' },
              ].map((ind) => (
                <div
                  key={ind.type}
                  className="tv-dropdown-item"
                  onClick={() => {
                    setSelectedIndicatorType(ind.type as any);
                    closeAllDropdowns();
                    openModal('indicator-config');
                  }}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: '6px 8px' }}
                >
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{ind.label}</span>
                  <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>{ind.desc}</span>
                </div>
              ))}

              <div className="dropdown-divider" style={{ margin: '6px 0' }} />
              <div className="dropdown-section-label" style={{ padding: '4px 8px', fontSize: '10px' }}>INDICATEURS ACTIFS</div>
              <div id="active-indicators-list">
                {activeIndicators.length === 0 ? (
                  <div style={{ padding: '6px 8px', fontSize: '11.5px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    Aucun indicateur actif
                  </div>
                ) : (
                  activeIndicators.map((i) => (
                    <div key={i.id} className="active-ind-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px', borderRadius: '4px', background: 'rgba(255,255,255,0.04)', marginBottom: '3px' }}>
                      <span style={{ fontSize: '11.5px', fontWeight: 600, color: i.color }}>{i.type} ({i.period})</span>
                      <button onClick={(e) => { e.stopPropagation(); removeIndicator(i.id); }} style={{ background: 'none', border: 'none', color: '#F43F5E', cursor: 'pointer', fontWeight: 700 }}>✕</button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Import button */}
        <button id="upload-btn" onClick={() => openModal('import')}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="18" x2="12" y2="12" />
            <polyline points="9 15 12 18 15 15" />
          </svg>
          Importer
        </button>
      </div>
    </div>
  );
};
