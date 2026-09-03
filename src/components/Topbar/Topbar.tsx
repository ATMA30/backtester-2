import React from 'react';
import {
  ChevronDown,
  TrendingUp,
  TrendingDown,
  Activity,
  Database,
  BarChart2,
  Grid,
  Columns,
  Globe,
  Maximize2,
  Minimize2,
  Camera,
  Volume2,
  VolumeX,
  History,
  Clock,
  CandlestickChart,
  LineChart,
  AreaChart,
  SlidersHorizontal,
  UploadCloud,
  Trash2,
  Calendar,
  CalendarDays,
  CalendarRange,
  Slash,
} from 'lucide-react';
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

  const isFullscreen = typeof document !== 'undefined' && Boolean(document.fullscreenElement);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      showToast('Mode Immersion plein écran activé', 'info', 2000);
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
          <ChevronDown size={12} strokeWidth={2.2} className="ticker-chevron" />
          <div className="ticker-sep" />
          <span id="ticker-price" className="ticker-price">
            {lastPrice > 0 ? lastPrice.toFixed(lastPrice < 10 ? 5 : 2) : '—'}
          </span>
          <span
            id="ticker-change"
            className={`ticker-change-pill ${changePercent >= 0 ? 'bull' : 'bear'}`}
          >
            <span className="ticker-change-arrow">
              {changePercent >= 0 ? (
                <TrendingUp size={11} strokeWidth={2.4} />
              ) : (
                <TrendingDown size={11} strokeWidth={2.4} />
              )}
            </span>
            <span>{changePercent >= 0 ? '+' : ''}{changePercent.toFixed(2)}%</span>
          </span>
        </div>

        {/* 2. Passive Technical Witnesses (Live Flux & Sync Status) */}
        <div
          className="topbar-witness-badge"
          onClick={() => openModal('live')}
          title="24 ms — Flux en direct connecté (Cliquez pour configurer)"
        >
          <Activity size={12} strokeWidth={2} style={{ color: '#10B981' }} />
          <span className="witness-label">24 ms</span>
        </div>

        <div
          className="topbar-witness-badge"
          onClick={() => openModal('datasets')}
          title="Gestionnaire de Sessions de Backtest & Datasets"
        >
          <Database size={12} strokeWidth={2} style={{ color: '#38BDF8' }} />
          <span className="witness-label">Sessions</span>
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
            <BarChart2 size={16} strokeWidth={showVolume ? 2.2 : 1.8} />
          </button>

          {/* Grille */}
          <button
            className={`tv-icon-btn ${showGrid ? 'active' : ''}`}
            id="btn-grid"
            onClick={toggleGrid}
            title={showGrid ? 'Grille graphique (Activée)' : 'Grille graphique (Désactivée)'}
          >
            <Grid size={16} strokeWidth={showGrid ? 2.2 : 1.8} />
          </button>

          {/* Séparateurs de période & session */}
          <div className="tv-dropdown sep-dropdown">
            <button
              className={`tv-icon-btn ${separatorTF ? 'active' : ''}`}
              id="btn-sep"
              onClick={() => toggleDropdown('sep')}
              title="Séparateurs de session / période"
            >
              <Columns size={16} strokeWidth={separatorTF ? 2.2 : 1.8} />
            </button>
            {activeDropdown === 'sep' && (
              <div className="tv-dropdown-menu sep-menu show" style={{ display: 'block' }}>
                <div className="sep-menu-title">Séparateurs de période</div>
                {[
                  { tf: null, label: 'Désactivé', icon: <Slash size={12} strokeWidth={2} /> },
                  { tf: '1D', label: 'Journalier (1D)', icon: <Calendar size={12} strokeWidth={2} />, cls: 'sep-color-day' },
                  { tf: '1W', label: 'Hebdomadaire (1W)', icon: <CalendarRange size={12} strokeWidth={2} />, cls: 'sep-color-week' },
                  { tf: '1M', label: 'Mensuel (1M)', icon: <CalendarDays size={12} strokeWidth={2} />, cls: 'sep-color-month' },
                  { tf: '1Y', label: 'Annuel (1Y)', icon: <Clock size={12} strokeWidth={2} />, cls: 'sep-color-year' },
                ].map((s) => (
                  <div
                    key={String(s.tf)}
                    className={`tv-dropdown-item ${separatorTF === s.tf ? 'active' : ''}`}
                    onClick={() => {
                      setSeparatorTF(s.tf as any);
                      closeAllDropdowns();
                      showToast(`Séparateurs : ${s.label}`, 'info', 2000);
                    }}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                  >
                    <span className={`sep-icon ${s.cls || ''}`} style={{ display: 'inline-flex', alignItems: 'center' }}>
                      {s.icon}
                    </span>
                    <span>{s.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Sessions Forex & Killzones ICT */}
          <div className="tv-dropdown">
            <button
              className={`tv-icon-btn ${
                forexSessions.london ||
                forexSessions.newyork ||
                forexSessions.tokyo ||
                forexSessions.sydney ||
                forexSessions.asianRange ||
                forexSessions.londonOpenKZ ||
                forexSessions.nyOpenKZ ||
                forexSessions.londonCloseKZ
                  ? 'active'
                  : ''
              }`}
              id="btn-forex"
              onClick={() => toggleDropdown('forex')}
              title="Sessions de Marché Forex & Killzones ICT / SMC"
            >
              <Globe size={16} strokeWidth={1.8} />
            </button>
            {activeDropdown === 'forex' && (
              <div
                className="tv-dropdown-menu forex-menu show"
                style={{
                  display: 'block',
                  minWidth: '260px',
                  maxHeight: '440px',
                  overflowY: 'auto',
                  padding: '8px',
                }}
              >
                {/* Intraday Notice if on 1D or higher */}
                {activeTF > 3600 && (
                  <div
                    style={{
                      background: 'rgba(56, 189, 248, 0.1)',
                      border: '1px solid rgba(56, 189, 248, 0.25)',
                      borderRadius: '4px',
                      padding: '8px 10px',
                      marginBottom: '10px',
                      fontSize: '11px',
                      color: '#38BDF8',
                      lineHeight: '1.4',
                    }}
                  >
                    ℹ️ Les sessions s'affichent sur les unités intraday (≤ 1h). Passez en 1h ou moins pour voir les boîtes de trading.
                  </div>
                )}

                {/* 1. Sessions Majeures */}
                <div className="sep-menu-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Sessions Majeures</span>
                  <span
                    style={{ fontSize: '10px', color: 'var(--accent)', cursor: 'pointer' }}
                    onClick={(e) => { e.stopPropagation(); toggleForexSession('all'); }}
                  >
                    Tout basculer
                  </span>
                </div>
                <div className="forex-session-row" onClick={(e) => { e.stopPropagation(); toggleForexSession('sydney'); }}>
                  <span className="forex-dot" style={{ background: '#A78BFA' }} />
                  <span className="forex-name">Sydney</span>
                  <span className="forex-hours">22h – 07h</span>
                  <input type="checkbox" checked={forexSessions.sydney} onChange={() => {}} />
                </div>
                <div className="forex-session-row" onClick={(e) => { e.stopPropagation(); toggleForexSession('tokyo'); }}>
                  <span className="forex-dot" style={{ background: '#FB923C' }} />
                  <span className="forex-name">Tokyo / Asie</span>
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

                {/* 2. Killzones ICT */}
                <div className="sep-menu-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Killzones ICT / SMC</span>
                  <span
                    style={{ fontSize: '10px', color: 'var(--accent)', cursor: 'pointer' }}
                    onClick={(e) => { e.stopPropagation(); toggleForexSession('all_kz'); }}
                  >
                    Tout basculer
                  </span>
                </div>
                <div className="forex-session-row" onClick={(e) => { e.stopPropagation(); toggleForexSession('asianRange'); }}>
                  <span className="forex-dot" style={{ background: '#F472B6' }} />
                  <span className="forex-name">Asian Range</span>
                  <span className="forex-hours">00h – 06h</span>
                  <input type="checkbox" checked={forexSessions.asianRange} onChange={() => {}} />
                </div>
                <div className="forex-session-row" onClick={(e) => { e.stopPropagation(); toggleForexSession('londonOpenKZ'); }}>
                  <span className="forex-dot" style={{ background: '#38BDF8' }} />
                  <span className="forex-name">London Open KZ</span>
                  <span className="forex-hours">07h – 10h</span>
                  <input type="checkbox" checked={forexSessions.londonOpenKZ} onChange={() => {}} />
                </div>
                <div className="forex-session-row" onClick={(e) => { e.stopPropagation(); toggleForexSession('nyOpenKZ'); }}>
                  <span className="forex-dot" style={{ background: '#4ADE80' }} />
                  <span className="forex-name">NY Open KZ</span>
                  <span className="forex-hours">12h – 15h</span>
                  <input type="checkbox" checked={forexSessions.nyOpenKZ} onChange={() => {}} />
                </div>
                <div className="forex-session-row" onClick={(e) => { e.stopPropagation(); toggleForexSession('londonCloseKZ'); }}>
                  <span className="forex-dot" style={{ background: '#FBBF24' }} />
                  <span className="forex-name">London Close KZ</span>
                  <span className="forex-hours">15h – 17h</span>
                  <input type="checkbox" checked={forexSessions.londonCloseKZ} onChange={() => {}} />
                </div>

                <div className="dropdown-divider" />

                {/* 3. Options d'affichage & Fuseaux */}
                <div className="sep-menu-title">Options d'Affichage</div>
                <div className="forex-session-row" onClick={(e) => { e.stopPropagation(); toggleForexSession('showHighLow'); }}>
                  <span className="forex-name">Niveaux High & Low</span>
                  <input type="checkbox" checked={forexSessions.showHighLow !== false} onChange={() => {}} />
                </div>
                <div className="forex-session-row" onClick={(e) => { e.stopPropagation(); toggleForexSession('showLabels'); }}>
                  <span className="forex-name">Badges de Session</span>
                  <input type="checkbox" checked={forexSessions.showLabels !== false} onChange={() => {}} />
                </div>
                <div className="forex-session-row" onClick={(e) => { e.stopPropagation(); toggleForexLocalTz(); }}>
                  <span className="forex-name">Mon fuseau horaire ({Intl.DateTimeFormat().resolvedOptions().timeZone})</span>
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
            {isFullscreen ? <Minimize2 size={16} strokeWidth={1.8} /> : <Maximize2 size={16} strokeWidth={1.8} />}
          </button>

          {/* Capture d'écran HD */}
          <button
            className="tv-icon-btn"
            id="btn-snapshot"
            onClick={() => openModal('snapshot')}
            title="Capture d'écran HD (P)"
          >
            <Camera size={16} strokeWidth={1.8} />
          </button>

          {/* Sons de trading */}
          <button
            className={`tv-icon-btn ${soundEnabled ? 'active' : ''}`}
            id="btn-sound"
            onClick={toggleSound}
            title={soundEnabled ? 'Effets sonores (Activés)' : 'Effets sonores (Désactivés / Muet)'}
          >
            {soundEnabled ? <Volume2 size={16} strokeWidth={1.8} /> : <VolumeX size={16} strokeWidth={1.8} />}
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
            <History size={16} strokeWidth={2.2} />
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
            style={{ display: 'flex', alignItems: 'center', gap: '5px' }}
          >
            <Clock size={12} strokeWidth={2} style={{ color: 'var(--text-secondary)' }} />
            <span>{currentTFDef.label}</span>
            <ChevronDown size={11} strokeWidth={2.5} />
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
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            {chartType === 'Candlestick' && <CandlestickChart size={13} strokeWidth={2} style={{ color: '#3B82F6' }} />}
            {chartType === 'Bar' && <BarChart2 size={13} strokeWidth={2} style={{ color: '#3B82F6' }} />}
            {chartType === 'Line' && <LineChart size={13} strokeWidth={2} style={{ color: '#3B82F6' }} />}
            {chartType === 'Area' && <AreaChart size={13} strokeWidth={2} style={{ color: '#3B82F6' }} />}
            <span>
              {chartType === 'Candlestick'
                ? 'Chandeliers'
                : chartType === 'Bar'
                ? 'Barres'
                : chartType === 'Line'
                ? 'Ligne'
                : 'Aire'}
            </span>
            <ChevronDown size={11} strokeWidth={2.5} />
          </button>
          {activeDropdown === 'ctype' && (
            <div className="tv-dropdown-menu show" style={{ display: 'block', minWidth: '150px' }}>
              {[
                { type: 'Candlestick' as const, label: 'Chandeliers', icon: <CandlestickChart size={13} strokeWidth={2} /> },
                { type: 'Bar' as const, label: 'Barres', icon: <BarChart2 size={13} strokeWidth={2} /> },
                { type: 'Line' as const, label: 'Ligne', icon: <LineChart size={13} strokeWidth={2} /> },
                { type: 'Area' as const, label: 'Aire', icon: <AreaChart size={13} strokeWidth={2} /> },
              ].map((item) => (
                <div
                  key={item.type}
                  className={`tv-dropdown-item ${chartType === item.type ? 'active' : ''}`}
                  onClick={() => {
                    setChartType(item.type);
                    closeAllDropdowns();
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', color: chartType === item.type ? '#3B82F6' : 'inherit' }}>
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
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
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <SlidersHorizontal size={13} strokeWidth={2} style={{ color: activeIndicators.length > 0 ? '#3B82F6' : 'inherit' }} />
            <span>Indicateurs</span>
            {activeIndicators.length > 0 && (
              <span style={{
                background: 'rgba(59, 130, 246, 0.2)',
                color: '#60A5FA',
                fontSize: '10px',
                fontWeight: 700,
                padding: '1px 5px',
                borderRadius: '10px',
                border: '1px solid rgba(59, 130, 246, 0.35)',
              }}>
                {activeIndicators.length}
              </span>
            )}
            <ChevronDown size={11} strokeWidth={2.5} />
          </button>
          {activeDropdown === 'indicators' && (
            <div className="tv-dropdown-menu show" style={{ minWidth: '240px', display: 'block', padding: '6px' }}>
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
                      <button
                        onClick={(e) => { e.stopPropagation(); removeIndicator(i.id); }}
                        title="Supprimer cet indicateur"
                        style={{ background: 'none', border: 'none', color: '#F43F5E', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                      >
                        <Trash2 size={12} strokeWidth={2} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Import button */}
        <button id="upload-btn" onClick={() => openModal('import')} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <UploadCloud size={14} strokeWidth={2.2} />
          <span>Importer</span>
        </button>
      </div>
    </div>
  );
};
