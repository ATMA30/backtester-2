import React from 'react';
import { ChevronDown, Clock, Loader2 } from 'lucide-react';
import { useMarketStore, TIMEFRAME_DEFS } from '../../store/useMarketStore';
import { useReplayStore } from '../../store/useReplayStore';
import { useUIStore } from '../../store/useUIStore';
import { useTimeframeSwitch } from './useTimeframeSwitch';
import { archiveLimitFor, checkArchiveDepth } from '../../domain/archive-limits';

/** « 30 j » ne dit rien à personne ; « 30 derniers jours » si. */
function formatArchiveDepth(days: number): string {
  if (days >= 365) {
    const years = Math.round(days / 365);
    return `${years} an${years > 1 ? 's' : ''}`;
  }
  if (days >= 60) return `${Math.round(days / 30)} mois`;
  return `${days} jours`;
}

/** Every timeframe, with how far back its source reaches. */
export const TimeframeMenu: React.FC = () => {
  const { downloadingTF, selectTimeframe } = useTimeframeSwitch();
  const activeTF = useMarketStore((m) => m.activeTF);
  const baseTF = useMarketStore((m) => m.baseTF);
  const baseCandles = useMarketStore((m) => m.baseCandles);
  const { isActive: isReplayActive, currentIndex } = useReplayStore();
  const { activeDropdown, toggleDropdown } = useUIStore();

  /** Instant sur lequel le replay est arrêté — ce que chaque flux doit pouvoir atteindre. */
  const replayCutEpoch =
    isReplayActive && baseCandles[currentIndex] ? baseCandles[currentIndex].time : null;
  const currentTFDef = TIMEFRAME_DEFS.find((t) => t.s === activeTF) || { label: '1D' };

  return (
  <div className="tv-dropdown tf-picker">
    <button
      className="tv-dropdown-btn tf-trigger"
      id="btn-active-tf"
      onClick={() => toggleDropdown('tf')}
    >
      {downloadingTF ? (
        <Loader2 size={12} className="tf-loading-icon" />
      ) : (
        <Clock size={12} strokeWidth={2} className="tf-trigger-icon" />
      )}
      <span>{currentTFDef.label}</span>
      <ChevronDown size={11} strokeWidth={2.5} />
    </button>

    {downloadingTF && (
      <div className="tf-loading-badge"
      >
        <Loader2 size={11} className="tf-loading-badge-icon" />
        <span>Chargement {downloadingTF}...</span>
      </div>
    )}
    {activeDropdown === 'tf' && (
      <div className="tv-dropdown-menu show tf-menu">
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
              <button type="button"
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
              </button>
            );
          })}
        </div>
      </div>
    )}
  </div>
  );
};
