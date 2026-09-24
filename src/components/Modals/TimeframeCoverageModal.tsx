import React from 'react';
import { CalendarRange, X } from 'lucide-react';
import { useUIStore } from '../../store/useUIStore';
import { daysBetween, suggestsAlternative, TimeframeCoverage } from '../../domain/timeframe-coverage';
import { TIMEFRAME_DEFS } from '../../domain/timeframes';
import { useTimeframeSwitch } from '../Topbar/useTimeframeSwitch';

/**
 * Explains, rather than refuses, when a finer timeframe cannot reach the replay.
 *
 * The four refusals used to be toasts: three seconds on screen, no numbers, no
 * way forward. What a backtester needs to know here is exactly three things —
 * where their cursor sits, what the requested granularity actually covers, and
 * which timeframe would still work — so the dialog shows the two periods on one
 * axis and offers the finest one that reaches the cursor.
 */

const formatDate = (epochSeconds: number): string =>
  new Date(epochSeconds * 1000).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

const formatDays = (days: number): string =>
  days >= 730
    ? `${(days / 365).toFixed(days % 365 === 0 ? 0 : 1)} ans`
    : days >= 60
      ? `${Math.round(days / 30)} mois`
      : `${days} jour${days > 1 ? 's' : ''}`;

/** One sentence naming the cause, in the user's terms rather than the code's. */
function leadFor(coverage: TimeframeCoverage): string {
  const { requestedLabel, currentLabel, symbol, availableDays, contextBars } = coverage;

  switch (coverage.cause) {
    case 'source-resolution':
      return `Vos bougies ${symbol} sont en ${currentLabel}. Une bougie ${currentLabel} ne se découpe pas en ${requestedLabel} : la donnée à cette finesse n’existe pas dans le fichier.`;
    case 'archive-depth':
      return `Le ${requestedLabel} n’est servi que sur les ${availableDays !== null ? formatDays(availableDays) : 'derniers jours'} les plus récents. Votre replay est parti bien avant.`;
    case 'not-enough-context':
      return `Le ${requestedLabel} atteint votre position, mais il n’y a que ${contextBars ?? 0} bougies devant elle — trop peu pour lire quoi que ce soit.`;
    case 'feed-window':
    default:
      return `Le flux ${requestedLabel} de ${symbol} ne couvre qu’une partie de votre historique, et votre replay se situe en dehors.`;
  }
}

/** The two periods drawn on one axis, so the gap is seen rather than computed. */
const CoverageAxis: React.FC<{ coverage: TimeframeCoverage }> = ({ coverage }) => {
  const { window, cutEpoch, requestedLabel, currentLabel } = coverage;
  if (!window) return null;

  const from = Math.min(cutEpoch, window.fromEpoch);
  const to = Math.max(window.toEpoch, cutEpoch);
  const span = to - from;
  // A zero span would divide by zero and collapse the drawing; with both marks
  // at the same instant there is no gap to show anyway.
  if (!(span > 0)) return null;

  const percent = (epoch: number): number => ((epoch - from) / span) * 100;
  const windowLeft = percent(window.fromEpoch);
  const cutLeft = percent(cutEpoch);

  return (
    <div className="tfc-axis" aria-hidden="true">
      <div className="tfc-axis-track">
        <div className="tfc-axis-full" />
        <div
          className="tfc-axis-window"
          style={{ left: `${windowLeft}%`, right: `${100 - percent(window.toEpoch)}%` }}
        />
        <div className="tfc-axis-cut" style={{ left: `${cutLeft}%` }} />
      </div>
      <div className="tfc-axis-legend">
        <span className="tfc-legend-item">
          <i className="tfc-swatch cut" />
          Replay · {formatDate(cutEpoch)}
        </span>
        <span className="tfc-legend-item">
          <i className="tfc-swatch window" />
          {requestedLabel} · {formatDate(window.fromEpoch)} → {formatDate(window.toEpoch)}
        </span>
        <span className="tfc-legend-item">
          <i className="tfc-swatch full" />
          {currentLabel} · période chargée
        </span>
      </div>
    </div>
  );
};

export const TimeframeCoverageModal: React.FC = () => {
  const coverage = useUIStore((state) => state.timeframeCoverage);
  const setTimeframeCoverage = useUIStore((state) => state.setTimeframeCoverage);
  const { selectTimeframe, downloadingTF } = useTimeframeSwitch();

  if (!coverage) return null;

  const close = () => setTimeframeCoverage(null);

  const alternative = suggestsAlternative(coverage) ? coverage.finestCovering : null;
  const alternativeDef = alternative
    ? TIMEFRAME_DEFS.find((d) => d.s === alternative.s) ?? null
    : null;

  const switchToAlternative = async () => {
    if (!alternativeDef) return;
    close();
    await selectTimeframe(alternativeDef);
  };

  return (
    <div
      className="modal-overlay open u-display-flex"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tfc-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      {/* Classes, pas identifiants : cette boîte peut coexister avec la modale
          d'import, qui portait les mêmes `id`. */}
      <div className="modal-box tfc-modal">
        <div className="modal-header">
          <div className="modal-title" id="tfc-title">
            <CalendarRange size={16} strokeWidth={2} />
            <span>
              Le {coverage.requestedLabel} ne couvre pas cette période
            </span>
          </div>
          <button className="modal-close" onClick={close} aria-label="Fermer">
            <X size={15} strokeWidth={2.4} />
          </button>
        </div>

        <p className="tfc-lead">{leadFor(coverage)}</p>

        <CoverageAxis coverage={coverage} />

        <dl className="tfc-facts">
          <div className="tfc-fact">
            <dt>Votre position</dt>
            <dd>
              {formatDate(coverage.cutEpoch)}
              <span className="tfc-fact-sub">il y a {formatDays(coverage.cutAgeDays)}</span>
            </dd>
          </div>
          {coverage.window && (
            <div className="tfc-fact">
              <dt>Disponible en {coverage.requestedLabel}</dt>
              <dd>
                depuis le {formatDate(coverage.window.fromEpoch)}
                <span className="tfc-fact-sub">
                  {/* `?? 0` affichait « 0 jour d’archive » dès que la règle
                      d’archive ne s’applique pas (cause `feed-window` sur une
                      granularité journalière ou plus large). L’étendue réelle de
                      la fenêtre est à la fois disponible et plus honnête. */}
                  {formatDays(
                    coverage.availableDays ??
                      daysBetween(coverage.window.fromEpoch, coverage.window.toEpoch)
                  )}{' '}
                  d’archive
                </span>
              </dd>
            </div>
          )}
          {coverage.shortfallDays !== null && coverage.shortfallDays > 0 && (
            <div className="tfc-fact">
              <dt>Il manque</dt>
              <dd className="tfc-fact-gap">
                {formatDays(coverage.shortfallDays)}
                <span className="tfc-fact-sub">entre les deux</span>
              </dd>
            </div>
          )}
        </dl>

        <div className="tfc-actions">
          <button className="btn-sm" onClick={close}>
            Rester en {coverage.currentLabel}
          </button>
          {alternativeDef && (
            <button
              className="btn-sm btn-primary"
              onClick={() => void switchToAlternative()}
              disabled={downloadingTF !== null}
            >
              {downloadingTF !== null
                ? `Chargement ${downloadingTF}…`
                : `Passer en ${alternativeDef.label}`}
            </button>
          )}
        </div>

        {alternativeDef && (
          <p className="tfc-note">
            Le {alternativeDef.label} est la granularité la plus fine dont l’archive
            atteint encore le {formatDate(coverage.cutEpoch)}. Votre position est conservée.
          </p>
        )}
      </div>
    </div>
  );
};
