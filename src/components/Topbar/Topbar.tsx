import React from 'react';
import {
  BookOpen,
  Keyboard,
  MoreHorizontal,
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
  Loader2,
} from 'lucide-react';
import { useMarketStore, TIMEFRAME_DEFS } from '../../store/useMarketStore';
import { useReplayStore } from '../../store/useReplayStore';
import { useUIStore } from '../../store/useUIStore';
import { useTimeframeSwitch } from './useTimeframeSwitch';
import { archiveLimitFor, checkArchiveDepth } from '../../domain/archive-limits';
import { supportsSessions } from '../../domain/timeframes';
import { AssetClass, formatPrice, getInstrument } from '../../domain/instruments';
import { useIsFullscreen, toggleFullscreen } from '../../hooks/useFullscreen';
import { blockRelocationWhileTrading } from '../Replay/replayGuards';

/**
 * Badge per asset class.
 *
 * The badge was previously guessed from substrings of the symbol — a fifth
 * classifier, alongside `classifyUnknown` and three others the codebase had
 * already consolidated into `domain/instruments`. It disagreed with them: any
 * ticker containing "SOL" (SOLUSDT, but also a hypothetical SOLAR index) was
 * labelled CRYPTO, and XAGUSD fell through to FX because no rule matched
 * "XAG" before the metals branch. One catalogue, one answer.
 */
const MARKET_BADGES: Readonly<Record<AssetClass, { label: string; type: string }>> = {
  forex: { label: 'FX', type: 'fx' },
  metal: { label: 'COMMO', type: 'commo' },
  energy: { label: 'COMMO', type: 'commo' },
  index: { label: 'INDEX', type: 'index' },
  crypto: { label: 'CRYPTO', type: 'crypto' },
  synthetic: { label: 'SYNTH', type: 'synth' },
};

/** « 30 j » ne dit rien à personne ; « 30 derniers jours » si. */
function formatArchiveDepth(days: number): string {
  if (days >= 365) {
    const years = Math.round(days / 365);
    return `${years} an${years > 1 ? 's' : ''}`;
  }
  if (days >= 60) return `${Math.round(days / 30)} mois`;
  return `${days} jours`;
}

export const Topbar: React.FC = () => {
  const { downloadingTF, selectTimeframe } = useTimeframeSwitch();
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
    hasVolumeData,
    setChartType,
    toggleVolume,
    toggleGrid,
    toggleSound,
    setSeparatorTF,
    toggleForexSession,
    toggleForexLocalTz,
    removeIndicator,
  } = useMarketStore();

  const { isActive: isReplayActive, isPicking, currentIndex, setIsActive, setIsPicking } = useReplayStore();
  const baseCandles = useMarketStore((m) => m.baseCandles);

  /** Les séances de marché exigent une résolution intraday. */
  const sessionsAvailable = supportsSessions(activeTF);

  /** Au moins une séance ou killzone cochée. */
  const anySessionOn =
    forexSessions.sydney ||
    forexSessions.tokyo ||
    forexSessions.london ||
    forexSessions.newyork ||
    forexSessions.asianRange ||
    forexSessions.londonOpenKZ ||
    forexSessions.nyOpenKZ ||
    forexSessions.londonCloseKZ;

  /** Instant sur lequel le replay est arrêté — ce que chaque flux doit pouvoir atteindre. */
  const replayCutEpoch =
    isReplayActive && baseCandles[currentIndex] ? baseCandles[currentIndex].time : null;
  const { activeDropdown, toggleDropdown, closeAllDropdowns, openModal, setSelectedIndicatorType, showToast } = useUIStore();

  const lastCandle = displayCandles[displayCandles.length - 1];
  const lastPrice = lastCandle ? lastCandle.close : 0;
  const instrument = getInstrument(currentSymbol, lastPrice);
  const firstCandle = displayCandles[0];
  const changePercent =
    firstCandle && firstCandle.open > 0 && lastCandle
      ? ((lastCandle.close - firstCandle.open) / firstCandle.open) * 100
      : 0;

  const currentTFDef = TIMEFRAME_DEFS.find((t) => t.s === activeTF) || { label: '1D' };

  // Subscribed rather than read once per render: leaving fullscreen with F11 or
  // Escape used to leave the menu entry stuck on "Quitter le plein écran".
  const isFullscreen = useIsFullscreen();

  const handleToggleFullscreen = async () => {
    const entered = await toggleFullscreen();
    showToast(entered ? 'Plein écran activé' : 'Plein écran quitté', 'info', 2000);
  };

  const marketBadge = MARKET_BADGES[instrument.assetClass];

  return (
    <div id="topbar">
      {/* Left group: asset selector + witnesses + segmented tools */}
      <div className="topbar-left">
        {/* 1. Interactive Asset Selector & Semantic Variation */}
        <div
          id="topbar-ticker"
          className="topbar-asset-selector"
          onClick={() => openModal('live')}
          title="Changer d'instrument"
        >
          <span className={`market-badge ${marketBadge.type}`}>{marketBadge.label}</span>
          <span id="ticker-symbol" className="ticker-symbol">{currentSymbol}</span>
          <ChevronDown size={12} strokeWidth={2.2} className="ticker-chevron" />
          <div className="ticker-sep" />
          <span id="ticker-price" className="ticker-price">
            {/* `toFixed(price < 10 ? 5 : 2)` was the last magnitude-based
                precision heuristic left in the UI: it printed gold at 2 digits
                and DOGE at 5 regardless of their catalogue entries. */}
            {lastPrice > 0 ? formatPrice(currentSymbol, lastPrice) : '—'}
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

        {/* Le badge affichait « 24 ms » — un nombre littéral, jamais mesuré,
            présenté comme une latence réelle. Le même écran prend soin de
            distinguer bougies réelles et bougies simulées ; afficher une mesure
            inventée juste à côté annule cette précaution. Le bouton reste, il
            dit maintenant ce qu'il fait. */}
        <div
          className="topbar-witness-badge"
          onClick={() => openModal('live')}
          title="Choisir l’instrument et la source de données"
        >
          <Activity size={12} strokeWidth={2} className="u-color-10b981" />
          <span className="witness-label">Source</span>
        </div>

        <div
          className="topbar-witness-badge"
          onClick={() => openModal('datasets')}
          title="Sauvegardes et jeux de données"
        >
          <Database size={12} strokeWidth={2} className="u-color-38bdf8" />
          <span className="witness-label">Sauvegardes</span>
        </div>

        <div className="topbar-divider" />

        {/* 3. BLOC VUES & OUTILS: Volumes, Grille, Séparateurs, Sessions Forex, Immersion, Capture, Sons */}
        <div className="topbar-icon-group">
          {/* Volume — inactif quand la source n'en publie pas, plutôt qu'une
              bascule sans effet visible. */}
          <button
            className={`tv-icon-btn ${showVolume && hasVolumeData ? 'active' : ''} ${!hasVolumeData ? 'unavailable' : ''}`}
            id="btn-volume"
            onClick={toggleVolume}
            disabled={!hasVolumeData}
            title={
              !hasVolumeData
                ? `Aucun volume publié pour ${currentSymbol} à cette source`
                : showVolume
                  ? 'Masquer le volume'
                  : 'Afficher le volume'
            }
          >
            <BarChart2 size={16} strokeWidth={showVolume && hasVolumeData ? 2.2 : 1.8} />
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
              title="Séparateurs de période"
            >
              <Columns size={16} strokeWidth={separatorTF ? 2.2 : 1.8} />
            </button>
            {activeDropdown === 'sep' && (
              <div className="tv-dropdown-menu sep-menu show u-display-block">
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
                    className={`tv-dropdown-item ${separatorTF === s.tf ? 'active' : ''} u-display-flex u-align-items-center u-gap-8px`}
                    onClick={() => {
                      setSeparatorTF(s.tf as any);
                      closeAllDropdowns();
                      showToast(`Séparateurs : ${s.label}`, 'info', 2000);
                    }}
                  >
                    <span className={`sep-icon ${s.cls || ''} u-display-inline-flex u-align-items-center`}>
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
              title="Séances de marché"
            >
              <Globe size={16} strokeWidth={1.8} />
            </button>
            {activeDropdown === 'forex' && (
              <div
                className={`tv-dropdown-menu forex-menu show ${sessionsAvailable ? '' : 'sessions-unavailable'} u-display-block u-min-width-260px u-max-height-440px u-overflow-y-auto u-padding-8px`}
              >
                {/* Une bougie journalière couvre Tokyo, Londres et New York à la
                    fois : les séances n'ont alors aucun sens. Les cases étaient
                    malgré tout cochables et ne produisaient rien. */}
                {!sessionsAvailable && (
                  <div className="sessions-notice">
                    Les séances demandent une unité de temps de <strong>1 h ou moins</strong>.
                    En {currentTFDef.label}, une bougie couvre toutes les séances à la fois.
                  </div>
                )}

                {/* 1. Sessions Majeures */}
                <div className="sep-menu-title u-display-flex u-justify-content-space-between u-align-items-center">
                  <span>Séances principales</span>
                  <span className="u-font-size-10px u-color-accent u-cursor-pointer"
                    onClick={(e) => { e.stopPropagation(); toggleForexSession('all'); }}
                  >
                    Tout basculer
                  </span>
                </div>
                <div className="forex-session-row" onClick={(e) => { e.stopPropagation(); toggleForexSession('sydney'); }}>
                  <span className="forex-dot u-background-a78bfa" />
                  <span className="forex-name">Sydney</span>
                  <span className="forex-hours">22h – 07h</span>
                  <input type="checkbox" checked={forexSessions.sydney} onChange={() => {}} />
                </div>
                <div className="forex-session-row" onClick={(e) => { e.stopPropagation(); toggleForexSession('tokyo'); }}>
                  <span className="forex-dot u-background-fb923c" />
                  <span className="forex-name">Tokyo</span>
                  <span className="forex-hours">00h – 09h</span>
                  <input type="checkbox" checked={forexSessions.tokyo} onChange={() => {}} />
                </div>
                <div className="forex-session-row" onClick={(e) => { e.stopPropagation(); toggleForexSession('london'); }}>
                  <span className="forex-dot u-background-60a5fa" />
                  <span className="forex-name">Londres</span>
                  <span className="forex-hours">08h – 17h</span>
                  <input type="checkbox" checked={forexSessions.london} onChange={() => {}} />
                </div>
                <div className="forex-session-row" onClick={(e) => { e.stopPropagation(); toggleForexSession('newyork'); }}>
                  <span className="forex-dot u-background-34d399" />
                  <span className="forex-name">New York</span>
                  <span className="forex-hours">13h – 22h</span>
                  <input type="checkbox" checked={forexSessions.newyork} onChange={() => {}} />
                </div>

                <div className="dropdown-divider" />

                {/* 2. Killzones ICT */}
                <div className="sep-menu-title u-display-flex u-justify-content-space-between u-align-items-center">
                  <span>Killzones ICT / SMC</span>
                  <span className="u-font-size-10px u-color-accent u-cursor-pointer"
                    onClick={(e) => { e.stopPropagation(); toggleForexSession('all_kz'); }}
                  >
                    Tout basculer
                  </span>
                </div>
                <div className="forex-session-row" onClick={(e) => { e.stopPropagation(); toggleForexSession('asianRange'); }}>
                  <span className="forex-dot u-background-f472b6" />
                  <span className="forex-name">Asian Range</span>
                  <span className="forex-hours">00h – 06h</span>
                  <input type="checkbox" checked={forexSessions.asianRange} onChange={() => {}} />
                </div>
                <div className="forex-session-row" onClick={(e) => { e.stopPropagation(); toggleForexSession('londonOpenKZ'); }}>
                  <span className="forex-dot u-background-38bdf8" />
                  <span className="forex-name">London Open KZ</span>
                  <span className="forex-hours">07h – 10h</span>
                  <input type="checkbox" checked={forexSessions.londonOpenKZ} onChange={() => {}} />
                </div>
                <div className="forex-session-row" onClick={(e) => { e.stopPropagation(); toggleForexSession('nyOpenKZ'); }}>
                  <span className="forex-dot u-background-4ade80" />
                  <span className="forex-name">NY Open KZ</span>
                  <span className="forex-hours">12h – 15h</span>
                  <input type="checkbox" checked={forexSessions.nyOpenKZ} onChange={() => {}} />
                </div>
                <div className="forex-session-row" onClick={(e) => { e.stopPropagation(); toggleForexSession('londonCloseKZ'); }}>
                  <span className="forex-dot u-background-fbbf24" />
                  <span className="forex-name">London Close KZ</span>
                  <span className="forex-hours">15h – 17h</span>
                  <input type="checkbox" checked={forexSessions.londonCloseKZ} onChange={() => {}} />
                </div>

                <div className="dropdown-divider" />

                {/* Séance active mais rien à voir : sans ces deux options, seul
                    l'ombrage subsiste et rien n'explique la disparition des
                    boîtes et des étiquettes. */}
                {sessionsAvailable && anySessionOn && !forexSessions.showHighLow && !forexSessions.showLabels && (
                  <div className="sessions-notice">
                    Séance active, mais ni extrêmes ni étiquettes : seul l’ombrage s’affiche.
                    Cochez une option ci-dessous.
                  </div>
                )}

                {/* 3. Options d'affichage & Fuseaux */}
                <div className="sep-menu-title">Affichage</div>
                <div className="forex-session-row" onClick={(e) => { e.stopPropagation(); toggleForexSession('showHighLow'); }}>
                  <span className="forex-name">Extrêmes de séance</span>
                  <input type="checkbox" checked={forexSessions.showHighLow !== false} onChange={() => {}} />
                </div>
                <div className="forex-session-row" onClick={(e) => { e.stopPropagation(); toggleForexSession('showLabels'); }}>
                  <span className="forex-name">Étiquettes de séance</span>
                  <input type="checkbox" checked={forexSessions.showLabels !== false} onChange={() => {}} />
                </div>
                <div className="forex-session-row" onClick={(e) => { e.stopPropagation(); toggleForexLocalTz(); }}>
                  <span className="forex-name">Mon fuseau horaire ({Intl.DateTimeFormat().resolvedOptions().timeZone})</span>
                  <input type="checkbox" checked={forexSessions.useLocalTz} onChange={() => {}} />
                </div>
              </div>
            )}
          </div>

          {/* Actions applicatives, hors du flux d'analyse : trois icônes de
              moins dans une rangée qui en comptait huit de poids identique. */}
          <div className="tv-dropdown u-position-relative">
            <button
              className="tv-icon-btn"
              id="btn-more"
              onClick={() => toggleDropdown('more')}
              title="Plus d’actions"
              aria-haspopup="menu"
              aria-expanded={activeDropdown === 'more'}
            >
              <MoreHorizontal size={16} strokeWidth={2} />
            </button>
            {activeDropdown === 'more' && (
              <div className="tv-dropdown-menu show u-display-block u-min-width-210px" role="menu">
                <div className="tv-dropdown-item" id="btn-snapshot" role="menuitem" onClick={() => openModal('snapshot')}>
                  <Camera size={13} strokeWidth={2} />
                  <span>Capturer le graphique</span>
                  <span className="shortcut-hint">P</span>
                </div>
                <div className="tv-dropdown-item" id="btn-fullscreen" role="menuitem" onClick={() => void handleToggleFullscreen()}>
                  {isFullscreen ? <Minimize2 size={13} strokeWidth={2} /> : <Maximize2 size={13} strokeWidth={2} />}
                  <span>{isFullscreen ? 'Quitter le plein écran' : 'Plein écran'}</span>
                  <span className="shortcut-hint">F</span>
                </div>
                <div className="tv-dropdown-item" id="btn-sound" role="menuitem" onClick={toggleSound}>
                  {soundEnabled ? <Volume2 size={13} strokeWidth={2} /> : <VolumeX size={13} strokeWidth={2} />}
                  <span>{soundEnabled ? 'Couper les sons' : 'Activer les sons'}</span>
                </div>
                <div className="dropdown-divider" />
                <div className="tv-dropdown-item" role="menuitem" onClick={() => openModal('shortcuts')}>
                  <Keyboard size={13} strokeWidth={2} />
                  <span>Raccourcis clavier</span>
                  <span className="shortcut-hint">?</span>
                </div>
              </div>
            )}
          </div>
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
                if (isReplayActive && blockRelocationWhileTrading('Quitter le replay')) return;
                setIsActive(false);
                setIsPicking(false);
                showToast('Replay quitté', 'info');
              } else {
                if (blockRelocationWhileTrading('Démarrer un replay')) return;
                setIsPicking(true);
                showToast('Cliquez sur la bougie où démarrer.', 'info');
              }
            }}
            title="Rejouer l’historique · Espace"
          >
            <History size={16} strokeWidth={2.2} />
            <span className="replay-btn-label">{isReplayActive || isPicking ? 'Replay' : 'Rejouer'}</span>
          </button>
        </div>
      </div>
      {/* Right group: selectors + import */}
      <div className="topbar-right">
        {/* Timeframe picker */}
        <div className="tv-dropdown u-display-flex u-align-items-center u-gap-6px">
          <button
            className="tv-dropdown-btn u-display-flex u-align-items-center u-gap-5px"
            id="btn-active-tf"
            onClick={() => toggleDropdown('tf')}
          >
            {downloadingTF ? (
              <Loader2 size={12} className="u-color-38bdf8 u-animation-spin-1s-linear-infinite" />
            ) : (
              <Clock size={12} strokeWidth={2} className="u-color-text-secondary" />
            )}
            <span>{currentTFDef.label}</span>
            <ChevronDown size={11} strokeWidth={2.5} />
          </button>

          {downloadingTF && (
            <div className="u-display-inline-flex u-align-items-center u-gap-5px u-padding-3px-8px u-border-radius-4px u-background-rgba-56-189-248-0_15 u-border-b057bc u-color-38bdf8 u-font-size-11px u-font-weight-600 u-animation-pulse-1_5s-infinite"
            >
              <Loader2 size={11} className="u-animation-spin-1s-linear-infinite" />
              <span>Chargement {downloadingTF}...</span>
            </div>
          )}
          {activeDropdown === 'tf' && (
            <div className="tv-dropdown-menu show u-display-block u-min-width-170px">
              <div id="tf-group">
                {TIMEFRAME_DEFS.map((t) => {
                  // Deux questions différentes, et c'est la seconde qui décide :
                  //  · « puis-je l'obtenir depuis les bougies chargées ? »
                  //  · « ce flux remonte-t-il jusqu'à ma date de replay ? »
                  const isLocal = t.s >= baseTF;
                  const limit = archiveLimitFor(t.s);
                  const reach = checkArchiveDepth(t.s, replayCutEpoch);
                  const outOfReach = !reach.allowed;

                  const hint = outOfReach
                    ? 'Trop ancien'
                    : limit
                      ? `${formatArchiveDepth(limit.maxAgeDays)} d’historique`
                      : 'Historique complet';

                  return (
                    <div
                      key={t.s}
                      className={`tv-dropdown-item tf-option ${t.s === activeTF ? 'active' : ''} ${outOfReach ? 'unreachable' : ''}`}
                      onClick={() => void selectTimeframe(t)}
                      title={
                        outOfReach
                          ? `Ce flux ne remonte pas jusqu’au ${new Date((replayCutEpoch ?? 0) * 1000).toLocaleDateString('fr-FR')}.`
                          : isLocal
                            ? 'Calculé depuis les bougies déjà chargées'
                            : 'Nécessite un téléchargement'
                      }
                    >
                      <span className="tf-option-label">{t.label}</span>
                      <span className={`tf-option-hint ${outOfReach ? 'is-blocked' : ''}`}>{hint}</span>
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
            className="tv-dropdown-btn u-display-flex u-align-items-center u-gap-6px"
            id="btn-active-ctype"
            onClick={() => toggleDropdown('ctype')}
          >
            {chartType === 'Candlestick' && <CandlestickChart size={13} strokeWidth={2} className="u-color-3b82f6" />}
            {chartType === 'Bar' && <BarChart2 size={13} strokeWidth={2} className="u-color-3b82f6" />}
            {chartType === 'Line' && <LineChart size={13} strokeWidth={2} className="u-color-3b82f6" />}
            {chartType === 'Area' && <AreaChart size={13} strokeWidth={2} className="u-color-3b82f6" />}
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
            <div className="tv-dropdown-menu show u-display-block u-min-width-150px">
              {[
                { type: 'Candlestick' as const, label: 'Chandeliers', icon: <CandlestickChart size={13} strokeWidth={2} /> },
                { type: 'Bar' as const, label: 'Barres', icon: <BarChart2 size={13} strokeWidth={2} /> },
                { type: 'Line' as const, label: 'Ligne', icon: <LineChart size={13} strokeWidth={2} /> },
                { type: 'Area' as const, label: 'Aire', icon: <AreaChart size={13} strokeWidth={2} /> },
              ].map((item) => (
                <div
                  key={item.type}
                  className={`tv-dropdown-item ${chartType === item.type ? 'active' : ''} u-display-flex u-align-items-center u-gap-8px`}
                  onClick={() => {
                    setChartType(item.type);
                    closeAllDropdowns();
                  }}
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
            className="tv-dropdown-btn u-display-flex u-align-items-center u-gap-6px"
            id="btn-indicators"
            onClick={() => toggleDropdown('indicators')}
          >
            <SlidersHorizontal size={13} strokeWidth={2} style={{ color: activeIndicators.length > 0 ? '#3B82F6' : 'inherit' }} />
            <span>Indicateurs</span>
            {activeIndicators.length > 0 && (
              <span className="u-background-rgba-59-130-246-0_2 u-color-60a5fa u-font-size-10px u-font-weight-700 u-padding-1px-5px u-border-radius-10px u-border-39cd06">
                {activeIndicators.length}
              </span>
            )}
            <ChevronDown size={11} strokeWidth={2.5} />
          </button>
          {activeDropdown === 'indicators' && (
            <div className="tv-dropdown-menu show u-min-width-240px u-display-block u-padding-6px">
              <div className="dropdown-section-label u-color-3b82f6 u-font-weight-700 u-padding-4px-8px u-font-size-10_5px u-letter-spacing-0_8px">
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
                  className="tv-dropdown-item u-display-flex u-flex-direction-column u-align-items-flex-start u-padding-6px-8px"
                  onClick={() => {
                    setSelectedIndicatorType(ind.type as any);
                    closeAllDropdowns();
                    openModal('indicator-config');
                  }}
                >
                  <span className="u-font-weight-600 u-color-text-primary">{ind.label}</span>
                  <span className="u-font-size-10_5px u-color-text-muted">{ind.desc}</span>
                </div>
              ))}

              <div className="dropdown-divider u-margin-6px-0" />
              <div className="dropdown-section-label u-color-a78bfa u-font-weight-700 u-padding-4px-8px u-font-size-10_5px u-letter-spacing-0_8px">
                OSCILLATEURS
              </div>
              {[
                { type: 'RSI', label: 'RSI', desc: 'Relative Strength Index (0-100)' },
                { type: 'MACD', label: 'MACD', desc: 'Convergence / Divergence (12, 26)' },
              ].map((ind) => (
                <div
                  key={ind.type}
                  className="tv-dropdown-item u-display-flex u-flex-direction-column u-align-items-flex-start u-padding-6px-8px"
                  onClick={() => {
                    setSelectedIndicatorType(ind.type as any);
                    closeAllDropdowns();
                    openModal('indicator-config');
                  }}
                >
                  <span className="u-font-weight-600 u-color-text-primary">{ind.label}</span>
                  <span className="u-font-size-10_5px u-color-text-muted">{ind.desc}</span>
                </div>
              ))}

              <div className="dropdown-divider u-margin-6px-0" />
              <div className="dropdown-section-label u-padding-4px-8px u-font-size-10px">Indicateurs actifs</div>
              <div id="active-indicators-list">
                {activeIndicators.length === 0 ? (
                  <div className="u-padding-6px-8px u-font-size-11_5px u-color-text-muted u-font-style-italic">
                    Aucun indicateur actif
                  </div>
                ) : (
                  activeIndicators.map((i) => (
                    <div key={i.id} className="active-ind-item u-display-flex u-justify-content-space-between u-align-items-center u-padding-4px-8px u-border-radius-4px u-background-rgba-255-255-255-0_04 u-margin-bottom-3px">
                      <span style={{ fontSize: '11.5px', fontWeight: 600, color: i.color }}>{i.type} ({i.period})</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeIndicator(i.id); }}
                        title="Retirer cet indicateur" className="u-background-none u-border-none u-color-f43f5e u-cursor-pointer u-display-flex u-align-items-center"
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
        {/* Porte unique : les quatre entrées concurrentes (fichier, marchés,
            sauvegardes, démo) partagent enfin un seul point de départ. */}
        <div className="tv-dropdown u-position-relative">
          <button
            id="upload-btn"
            onClick={() => toggleDropdown('data')}
            aria-haspopup="menu"
            aria-expanded={activeDropdown === 'data'} className="u-display-flex u-align-items-center u-gap-6px"
          >
            <Database size={14} strokeWidth={2.2} />
            <span>Données</span>
            <ChevronDown size={11} strokeWidth={2.4} />
          </button>
          {activeDropdown === 'data' && (
            <div
              className="tv-dropdown-menu show u-display-block u-min-width-250px u-right-0 u-left-auto"
              role="menu"
            >
              <div className="dropdown-section-label">Charger</div>
              <div className="tv-dropdown-item" role="menuitem" onClick={() => openModal('live')}>
                <Globe size={13} strokeWidth={2} className="u-color-34d399" />
                <span>Choisir un instrument</span>
              </div>
              <div className="tv-dropdown-item" role="menuitem" onClick={() => openModal('import')}>
                <UploadCloud size={13} strokeWidth={2} className="u-color-38bdf8" />
                <span>Importer un fichier</span>
              </div>
              <div className="dropdown-divider" />
              <div className="dropdown-section-label">Reprendre</div>
              <div className="tv-dropdown-item" role="menuitem" onClick={() => openModal('datasets')}>
                <Database size={13} strokeWidth={2} className="u-color-a78bfa" />
                <span>Sauvegardes et jeux de données</span>
              </div>
              <div className="tv-dropdown-item" role="menuitem" onClick={() => openModal('trade-history')}>
                <BookOpen size={13} strokeWidth={2} className="u-color-fbbf24" />
                <span>Journal de trades</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
