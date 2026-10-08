import React, { useState } from 'react';
import { X, Target, ChevronDown, Shuffle, Clock, Calendar, SkipBack, Play, Pause, SkipForward, Gauge } from 'lucide-react';
import { useReplayStore } from '../../store/useReplayStore';
import { useMarketStore } from '../../store/useMarketStore';
import { useUIStore } from '../../store/useUIStore';
import { indexAtOrAfter } from '../../domain/candles';
import { archiveLimitFor } from '../../domain/archive-limits';
import { blockRelocationWhileTrading } from './replayGuards';

export const ANCHOR_MENU_ID = 'rp-anchor';
export const SPEED_MENU_ID = 'rp-speed';

const SPEEDS = [
  { label: '¼×', ms: 1200 },
  { label: '½×', ms: 800 },
  { label: '1×', ms: 500 },
  { label: '2×', ms: 250 },
  { label: '4×', ms: 120 },
  { label: '8×', ms: 60 },
  { label: '32×', ms: 20 },
];

/**
 * How deep the current granularity actually reaches, phrased for a prompt.
 *
 * These sentences used to be written by hand, and had drifted from
 * `domain/archive-limits`: the dialog claimed 7 days at 1 minute where the rule
 * says 30, and offered "1H (2 ans)" where the table says 5 years. One rule, one
 * source.
 */
function archiveNotice(timeframeSeconds: number): { suffix: string; hint: string } {
  const limit = archiveLimitFor(timeframeSeconds);
  if (!limit) return { suffix: '', hint: '' };
  return {
    suffix: ` (${limit.label} : archive ${limit.maxAgeDays} jours max)`,
    hint: limit.fallbackHint,
  };
}

/** Leave the replay, choose where it starts, step, play, and set the speed. */
export const ReplayTransport: React.FC = () => {
  const {
    isPlaying,
    currentIndex,
    speedMs,
    setIsPlaying,
    setIsActive,
    setCurrentIndex,
    setStartIndex,
    setSpeedMs,
    stepForward,
    stepBackward,
  } = useReplayStore();
  const { baseCandles, setDisplayCandles, activeTF, triggerFitContent } = useMarketStore();
  const { showToast, activeDropdown, toggleDropdown, closeAllDropdowns } = useUIStore();
  const [dateDraft, setDateDraft] = useState('');
  const showAnchorMenu = activeDropdown === ANCHOR_MENU_ID;
  const showSpeedMenu = activeDropdown === SPEED_MENU_ID;
  const currentCandle = baseCandles[currentIndex];

  const timeCurStr = currentCandle
    ? new Date(currentCandle.time * 1000).toLocaleString('fr-FR', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

  const currentSpeed = SPEEDS.find((s) => s.ms === speedMs) || SPEEDS[2];

  const dataBounds = {
    min: baseCandles.length ? new Date(baseCandles[0].time * 1000).toISOString().slice(0, 10) : undefined,
    max: baseCandles.length
      ? new Date(baseCandles[baseCandles.length - 1].time * 1000).toISOString().slice(0, 10)
      : undefined,
  };

  const startRandom = () => {
    if (baseCandles.length < 50) return;
    if (blockRelocationWhileTrading('Changer de point de départ')) return;
    const randIdx = Math.floor(Math.random() * (baseCandles.length - 40)) + 20;
    setStartIndex(randIdx);
    setCurrentIndex(randIdx);
    setIsPlaying(false);
    closeAllDropdowns();
    showToast('Départ tiré au hasard.', 'info');
  };

  const startAtSession = (hour: number, name: string) => {
    if (baseCandles.length < 50) return;
    if (blockRelocationWhileTrading('Changer de point de départ')) return;
    for (let i = baseCandles.length - 100; i >= 10; i--) {
      const d = new Date(baseCandles[i].time * 1000);
      if (d.getUTCHours() === hour) {
        setStartIndex(i);
        setCurrentIndex(i);
        setIsPlaying(false);
        closeAllDropdowns();
        showToast(`Départ calé sur ${name}`, 'success');
        return;
      }
    }
    startRandom();
  };

  /**
   * Start the replay at a typed date.
   *
   * A native `prompt()` used to ask for « AAAA-MM-JJ » in a blocking,
   * unstyled box with no calendar and no bounds; the menu now holds a
   * `<input type="date">` limited to the loaded range.
   */
  const goToDate = (userInput: string) => {
    if (!baseCandles.length || !userInput) return;
    if (blockRelocationWhileTrading('Changer de point de départ')) return;
    const minD = new Date(baseCandles[0].time * 1000).toISOString().slice(0, 10);
    const { hint: tfHint } = archiveNotice(activeTF);

    // `new Date('oops').getTime()` is NaN, and every comparison against NaN is
    // false — the old code therefore fell through every guard and silently did
    // nothing, leaving the user with no feedback at all.
    const parsedMs = Date.parse(`${userInput.trim()}T00:00:00Z`);
    if (Number.isNaN(parsedMs)) {
      showToast(`Date illisible : « ${userInput} ». Format attendu AAAA-MM-JJ.`, 'error', 4000);
      return;
    }
    const target = parsedMs / 1000;

    if (target < baseCandles[0].time) {
      showToast(
        `⚠️ Les données chargées ne remontent pas avant le ${minD}. ${tfHint}`.trim(),
        'warning',
        6000
      );
      return;
    }

    // `baseCandles` is sorted, so a binary search replaces the linear scan.
    const idx = indexAtOrAfter(baseCandles, target);
    if (idx === -1) {
      showToast(`Aucune bougie au-delà du ${userInput} dans ce jeu de données.`, 'warning', 4000);
      return;
    }

    // Clamp into range: `Math.max(20, idx)` alone could exceed the series on a
    // dataset shorter than 20 candles.
    const safeIdx = Math.min(Math.max(20, idx), baseCandles.length - 1);
    setStartIndex(safeIdx);
    setCurrentIndex(safeIdx);
    setIsPlaying(false);
    closeAllDropdowns();
    showToast(`Replay démarré au ${userInput}`, 'success');
  };

  return (
    <div className="rp-left">
      {/* 1. Bouton Quitter discret */}
      <button
        id="rp-exit"
        className="rp-exit-btn rp-icon-label-tight"
        title="Quitter le replay · Échap"
        onClick={() => {
          if (blockRelocationWhileTrading('Quitter le replay')) return;
          setIsPlaying(false);
          setIsActive(false);
          setDisplayCandles(baseCandles);
          triggerFitContent();
        }}
      >
        <X size={12} strokeWidth={2.4} />
        <span>Quitter</span>
      </button>

      {/* Anchor strategy dropdown */}
      <div className="tv-dropdown rp-anchor">
        <button
          className="rp-strategy-btn rp-icon-label"
          onClick={() => toggleDropdown('rp-anchor')}
          title="Choisir le point de départ"
        >
          <Target size={13} strokeWidth={2} className="rp-anchor-icon" />
          <span>Point de départ</span>
          <ChevronDown size={10} strokeWidth={2.2} />
        </button>
        {showAnchorMenu && (
          <div className="tv-dropdown-menu show rp-anchor-menu">
            <div className="dropdown-section-label">Point de départ</div>
            <button type="button" className="tv-dropdown-item rp-menu-option" onClick={startRandom}>
              <Shuffle size={13} strokeWidth={2} className="rp-anchor-icon-random" />
              <span>Date au hasard — test à l’aveugle</span>
            </button>
            <button type="button" className="tv-dropdown-item rp-menu-option" onClick={() => startAtSession(8, 'Londres (08h UTC)')}>
              <Clock size={13} strokeWidth={2} className="rp-anchor-icon-london" />
              <span>Ouverture de Londres · 08:00 UTC</span>
            </button>
            <button type="button" className="tv-dropdown-item rp-menu-option" onClick={() => startAtSession(13, 'New York (13h UTC)')}>
              <Clock size={13} strokeWidth={2} className="rp-anchor-icon-newyork" />
              <span>Ouverture de New York · 13:00 UTC</span>
            </button>
            <button type="button" className="tv-dropdown-item rp-menu-option" onClick={() => startAtSession(0, 'Tokyo (00h UTC)')}>
              <Clock size={13} strokeWidth={2} className="rp-anchor-icon-tokyo" />
              <span>Ouverture de Tokyo · 00:00 UTC</span>
            </button>
            <div className="dropdown-divider" />
            <form
              className="rp-date-form"
              onSubmit={(e) => {
                e.preventDefault();
                goToDate(dateDraft);
              }}
            >
              <Calendar size={13} strokeWidth={2} className="rp-anchor-icon-date" aria-hidden />
              <input
                type="date"
                aria-label={`Date de départ${archiveNotice(activeTF).suffix}`}
                min={dataBounds.min}
                max={dataBounds.max}
                value={dateDraft}
                onChange={(e) => setDateDraft(e.target.value)}
              />
              <button type="submit" className="btn-sm" disabled={!dateDraft}>
                Aller
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Step controls */}
      <div className="rp-controls">
        <button id="rp-step-back" title="Bougie précédente · ←" onClick={stepBackward}>
          <SkipBack size={13} strokeWidth={2} />
        </button>
        <button id="rp-play" className={isPlaying ? 'playing' : ''} title="Lecture ou pause · Espace" onClick={() => setIsPlaying(!isPlaying)}>
          {isPlaying ? (
            <Pause size={14} strokeWidth={2.4} />
          ) : (
            <Play size={14} strokeWidth={2.4} fill="currentColor" />
          )}
        </button>
        <button id="rp-step-fwd" title="Bougie suivante · →" onClick={() => stepForward(baseCandles.length)}>
          <SkipForward size={13} strokeWidth={2} />
        </button>
      </div>

      {/* 1. Date compacte précise (Intraday) */}
      <div className="rp-date-badge rp-icon-label" title="Date de la bougie affichée">
        <Calendar size={11} strokeWidth={2} className="rp-date-icon" />
        <span>{timeCurStr}</span>
      </div>

      {/* 1. Sélecteur de vitesse compact (Dropdown 1× ▾) */}
      <div className="tv-dropdown rp-speed-dropdown rp-speed">
        <button
          className="rp-speed-btn-compact rp-icon-label-tight"
          onClick={() => toggleDropdown('rp-speed')}
          title="Vitesse de lecture"
        >
          <Gauge size={11} strokeWidth={2} />
          <span>{currentSpeed.label}</span>
          <ChevronDown size={9} strokeWidth={2.5} />
        </button>
        {showSpeedMenu && (
          <div className="tv-dropdown-menu show rp-speed-menu">
            <div className="dropdown-section-label">Vitesse</div>
            {SPEEDS.map((s) => (
              <button type="button"
                key={s.label}
                className={`tv-dropdown-item ${speedMs === s.ms ? 'active' : ''} rp-speed-option`}
                onClick={() => {
                  setSpeedMs(s.ms);
                  closeAllDropdowns();
                }}
              >
                <span>{s.label}</span>
                {s.label === '1×' && <span className="rp-speed-option-hint">1× (normal)</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
