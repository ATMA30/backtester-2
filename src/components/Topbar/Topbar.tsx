import React from 'react';
import { useMarketStore, TIMEFRAME_DEFS } from '../../store/useMarketStore';
import { useReplayStore } from '../../store/useReplayStore';
import { useUIStore } from '../../store/useUIStore';

export const Topbar: React.FC = () => {
  const {
    currentSymbol,
    activeTF,
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

  return (
    <div id="topbar">
      {/* Left group: logo + tools */}
      <div className="topbar-left">
        {/* Logo */}
        <div className="logo">
          <svg className="logo-mark" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="26" height="26" rx="7" fill="url(#logo-g2)" />
            <polyline
              points="5 19 10 12 15 15.5 21 7"
              stroke="white"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <defs>
              <linearGradient id="logo-g2" x1="0" y1="0" x2="26" y2="26" gradientUnits="userSpaceOnUse">
                <stop stopColor="#1D4ED8" />
                <stop offset="0.5" stopColor="#4F46E5" />
                <stop offset="1" stopColor="#7C3AED" />
              </linearGradient>
            </defs>
          </svg>
          <span className="logo-text">Trade<strong>View Pro</strong></span>
        </div>

        {/* Live price ticker */}
        <div id="topbar-ticker" onClick={() => openModal('live')} style={{ cursor: 'pointer' }} title="Changer de marché">
          <span id="ticker-symbol" className="ticker-symbol">{currentSymbol}</span>
          <span id="ticker-price" className="ticker-price">
            {lastPrice > 0 ? lastPrice.toFixed(lastPrice < 10 ? 5 : 2) : '—'}
          </span>
          <span
            id="ticker-change"
            className={`ticker-change ${changePercent >= 0 ? 'up' : 'down'}`}
          >
            {changePercent >= 0 ? '+' : ''}{changePercent.toFixed(2)}%
          </span>
        </div>

        {/* Icon tools */}
        <div className="topbar-icon-group">
          <button
            className={`tv-icon-btn ${showVolume ? 'active' : ''}`}
            id="btn-volume"
            onClick={toggleVolume}
            title="Volume"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="14" width="4" height="6" rx="1" />
              <rect x="9" y="9" width="4" height="11" rx="1" />
              <rect x="16" y="4" width="4" height="16" rx="1" />
            </svg>
          </button>

          <button
            className={`tv-icon-btn ${showGrid ? 'active' : ''}`}
            id="btn-grid"
            onClick={toggleGrid}
            title="Grille"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
              <line x1="3" y1="15" x2="21" y2="15" />
              <line x1="9" y1="3" x2="9" y2="21" />
              <line x1="15" y1="3" x2="15" y2="21" />
            </svg>
          </button>

          <button
            className="tv-icon-btn"
            onClick={triggerFitContent}
            title="Ajuster la vue"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 3h6v6" />
              <path d="M9 21H3v-6" />
              <path d="M21 3l-7 7" />
              <path d="M3 21l7-7" />
            </svg>
          </button>

          <button
            className="tv-icon-btn"
            onClick={exportCSV}
            title="Exporter CSV"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="18" x2="12" y2="12" />
              <polyline points="9 15 12 18 15 15" />
            </svg>
          </button>

          <button
            className={`tv-icon-btn ${isReplayActive || isPicking ? 'active' : ''}`}
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
            title="Mode Replay"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none" />
            </svg>
          </button>

          <button
            className="tv-icon-btn"
            id="btn-live"
            onClick={() => openModal('live')}
            title="Marché en direct (Forex, Crypto, Synthetics)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.55a11 11 0 0 1 14.08 0" />
              <path d="M1.42 9a16 16 0 0 1 21.16 0" />
              <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
              <line x1="12" y1="20" x2="12.01" y2="20" strokeWidth="3" />
            </svg>
            <span className="live-dot-indicator online" />
          </button>

          <button
            className="tv-icon-btn"
            id="btn-datasets"
            onClick={() => openModal('datasets')}
            title="Mes Datasets & Sessions"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <ellipse cx="12" cy="5" rx="9" ry="3" />
              <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
            </svg>
          </button>

          <button
            className="tv-icon-btn"
            id="btn-snapshot"
            onClick={() => openModal('snapshot')}
            title="Capture HD (P)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          </button>

          <button
            className={`tv-icon-btn ${soundEnabled ? 'active' : ''}`}
            id="btn-sound"
            onClick={toggleSound}
            title="Sons trading"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
            </svg>
          </button>

          {/* Separateurs de session */}
          <div className="tv-dropdown sep-dropdown">
            <button
              className="tv-icon-btn"
              id="btn-sep"
              onClick={() => toggleDropdown('sep')}
              title="Séparateurs de session"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <line x1="8" y1="3" x2="8" y2="21" />
                <line x1="16" y1="3" x2="16" y2="21" />
                <line x1="3" y1="12" x2="5" y2="12" />
                <line x1="11" y1="12" x2="13" y2="12" />
                <line x1="19" y1="12" x2="21" y2="12" />
              </svg>
            </button>
            {activeDropdown === 'sep' && (
              <div className="tv-dropdown-menu sep-menu show" style={{ display: 'block' }}>
                <div className="sep-menu-title">Séparateurs de session</div>
                {[
                  { tf: null, label: 'Désactivé', icon: '✕' },
                  { tf: '1D', label: 'Journalier', icon: '│', cls: 'sep-color-day' },
                  { tf: '1W', label: 'Hebdomadaire', icon: '│', cls: 'sep-color-week' },
                  { tf: '1M', label: 'Mensuel', icon: '│', cls: 'sep-color-month' },
                  { tf: '3M', label: 'Trimestriel', icon: '│', cls: 'sep-color-quarter' },
                  { tf: '1Y', label: 'Annuel', icon: '│', cls: 'sep-color-year' },
                ].map((s) => (
                  <div
                    key={String(s.tf)}
                    className={`tv-dropdown-item ${separatorTF === s.tf ? 'active' : ''}`}
                    onClick={() => {
                      setSeparatorTF(s.tf as any);
                      closeAllDropdowns();
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
              className="tv-icon-btn"
              id="btn-forex"
              onClick={() => toggleDropdown('forex')}
              title="Sessions Forex"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <polyline points="12 7 12 12 15.5 15.5" />
              </svg>
            </button>
            {activeDropdown === 'forex' && (
              <div className="tv-dropdown-menu forex-menu show" style={{ display: 'block' }}>
                <div className="sep-menu-title">Sessions Forex (UTC)</div>
                <div className="forex-session-row" onClick={() => toggleForexSession('all')}>
                  <span className="forex-dot" style={{ background: 'linear-gradient(90deg,#A78BFA,#FB923C,#60A5FA,#34D399)' }} />
                  <span>Tout activer / désactiver</span>
                </div>
                <div className="forex-divider" />
                <div className="forex-session-row" onClick={() => toggleForexSession('sydney')}>
                  <span className="forex-dot" style={{ background: '#A78BFA' }} />
                  <span className="forex-name">Sydney</span>
                  <span className="forex-hours">22h – 07h</span>
                  <input type="checkbox" checked={forexSessions.sydney} readOnly />
                </div>
                <div className="forex-session-row" onClick={() => toggleForexSession('tokyo')}>
                  <span className="forex-dot" style={{ background: '#FB923C' }} />
                  <span className="forex-name">Tokyo</span>
                  <span className="forex-hours">00h – 09h</span>
                  <input type="checkbox" checked={forexSessions.tokyo} readOnly />
                </div>
                <div className="forex-session-row" onClick={() => toggleForexSession('london')}>
                  <span className="forex-dot" style={{ background: '#60A5FA' }} />
                  <span className="forex-name">Londres</span>
                  <span className="forex-hours">08h – 17h</span>
                  <input type="checkbox" checked={forexSessions.london} readOnly />
                </div>
                <div className="forex-session-row" onClick={() => toggleForexSession('newyork')}>
                  <span className="forex-dot" style={{ background: '#34D399' }} />
                  <span className="forex-name">New York</span>
                  <span className="forex-hours">13h – 22h</span>
                  <input type="checkbox" checked={forexSessions.newyork} readOnly />
                </div>
                <div className="forex-divider" />
                <div className="forex-session-row" onClick={toggleForexLocalTz}>
                  <span className="forex-dot" style={{ background: 'var(--gold)' }} />
                  <span className="forex-name">Mon fuseau horaire</span>
                  <input type="checkbox" checked={forexSessions.useLocalTz} readOnly />
                </div>
              </div>
            )}
          </div>
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
            <div className="tv-dropdown-menu show" style={{ display: 'block' }}>
              <div id="tf-group">
                {TIMEFRAME_DEFS.map((t) => (
                  <div
                    key={t.s}
                    className={`tv-dropdown-item ${t.s === activeTF ? 'active' : ''}`}
                    onClick={() => {
                      setTimeframe(t.s);
                      closeAllDropdowns();
                    }}
                  >
                    {t.label}
                  </div>
                ))}
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
            <div className="tv-dropdown-menu show" style={{ minWidth: '210px', display: 'block' }}>
              <div className="dropdown-section-label">Ajouter</div>
              {(['SMA', 'EMA', 'RSI', 'MACD', 'BB', 'VWAP'] as const).map((ind) => (
                <div
                  key={ind}
                  className="tv-dropdown-item"
                  onClick={() => {
                    setSelectedIndicatorType(ind);
                    openModal('indicator-config');
                  }}
                >
                  {ind}
                </div>
              ))}
              <div className="dropdown-divider" />
              <div className="dropdown-section-label">Actifs</div>
              <div id="active-indicators-list">
                {activeIndicators.length === 0 ? (
                  <div style={{ padding: '8px 10px', fontSize: '11.5px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    Aucun indicateur
                  </div>
                ) : (
                  activeIndicators.map((i) => (
                    <div key={i.id} className="active-ind-item" style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 10px' }}>
                      <span>{i.type} ({i.period})</span>
                      <button onClick={() => removeIndicator(i.id)} style={{ background: 'none', border: 'none', color: 'var(--bear)', cursor: 'pointer' }}>✕</button>
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
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          Importer
        </button>
      </div>
    </div>
  );
};
