import React from 'react';
import { Activity, BarChart2, Database, Grid } from 'lucide-react';
import { useMarketStore } from '../../store/useMarketStore';
import { useUIStore } from '../../store/useUIStore';
import { TickerButton } from './TickerButton';
import { SeparatorMenu } from './SeparatorMenu';
import { SessionsMenu } from './SessionsMenu';
import { MoreMenu } from './MoreMenu';
import { ReplayToggle } from './ReplayToggle';
import { TimeframeMenu } from './TimeframeMenu';
import { ChartTypeMenu } from './ChartTypeMenu';
import { IndicatorsMenu } from './IndicatorsMenu';
import { DataMenu } from './DataMenu';

/** Instrument, view toggles and replay on the left; timeframe, chart and data on the right. */
export const Topbar: React.FC = () => {
  const { currentSymbol, showVolume, showGrid, hasVolumeData, toggleVolume, toggleGrid } = useMarketStore();
  const openModal = useUIStore((s) => s.openModal);

  return (
    <div id="topbar">
      {/* Left group: asset selector + witnesses + segmented tools */}
      <div className="topbar-left">
        <TickerButton />

        {/* Le badge affichait « 24 ms » — un nombre littéral, jamais mesuré,
            présenté comme une latence réelle. Le même écran prend soin de
            distinguer bougies réelles et bougies simulées ; afficher une mesure
            inventée juste à côté annule cette précaution. Le bouton reste, il
            dit maintenant ce qu'il fait. */}
        <button type="button"
          className="topbar-witness-badge"
          onClick={() => openModal('live')}
          title="Choisir l’instrument et la source de données"
        >
          <Activity size={12} strokeWidth={2} className="witness-icon-source" />
          <span className="witness-label">Source</span>
        </button>

        <button type="button"
          className="topbar-witness-badge"
          onClick={() => openModal('datasets')}
          title="Sauvegardes et jeux de données"
        >
          <Database size={12} strokeWidth={2} className="witness-icon-saves" />
          <span className="witness-label">Sauvegardes</span>
        </button>

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

          <SeparatorMenu />
          <SessionsMenu />
          <MoreMenu />
        </div>

        {/* Séparateur large avant Replay */}
        <div className="topbar-divider topbar-divider-replay" />

        {/* 4. BLOC REPLAY TEMPOREL (Séparé et mis en valeur) */}
        <div className="topbar-icon-group topbar-replay-group">
          <ReplayToggle />
        </div>
      </div>
      {/* Right group: selectors + import */}
      <div className="topbar-right">
        <TimeframeMenu />
        <ChartTypeMenu />
        <IndicatorsMenu />
        <DataMenu />
      </div>
    </div>
  );
};
