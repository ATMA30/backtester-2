import React from 'react';
import {
  Activity,
  Play,
  RotateCcw,
  BarChart2,
  Grid,
  Camera,
  Volume2,
  TrendingUp,
  Layers,
  Sparkles,
} from 'lucide-react';
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
    displayCandles,
    setTimeframe,
    setChartType,
    toggleVolume,
    toggleGrid,
  } = useMarketStore();

  const { isActive: isReplayActive, setIsActive, setIsPicking } = useReplayStore();
  const { openModal, showToast } = useUIStore();

  const lastCandle = displayCandles[displayCandles.length - 1];
  const lastPrice = lastCandle ? lastCandle.close : 0;
  const changePercent =
    lastCandle && lastCandle.open > 0
      ? ((lastCandle.close - lastCandle.open) / lastCandle.open) * 100
      : 0;

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="brand-logo">
          <Sparkles size={18} className="brand-icon" />
          <span>TradeView <span className="pro-badge">TS Pro</span></span>
        </div>

        {/* Symbol Button */}
        <button
          className="btn-pill"
          onClick={() => openModal('live')}
          title="Sélectionner un marché"
        >
          <span className="symbol-label">{currentSymbol}</span>
          <span className={`price-badge ${changePercent >= 0 ? 'up' : 'down'}`}>
            {lastPrice > 0 ? lastPrice.toFixed(lastPrice < 10 ? 5 : 2) : '---'}
            <span className="change-pct">
              ({changePercent >= 0 ? '+' : ''}{changePercent.toFixed(2)}%)
            </span>
          </span>
        </button>

        {/* Timeframe Selector */}
        <div className="timeframe-group">
          {TIMEFRAME_DEFS.slice(0, 9).map((tf) => (
            <button
              key={tf.s}
              className={`tf-btn ${tf.s === activeTF ? 'active' : ''}`}
              onClick={() => setTimeframe(tf.s)}
            >
              {tf.label}
            </button>
          ))}
        </div>

        {/* Chart Type */}
        <div className="chart-type-group">
          {(['Candlestick', 'Bar', 'Line', 'Area'] as const).map((type) => (
            <button
              key={type}
              className={`ctype-btn ${chartType === type ? 'active' : ''}`}
              onClick={() => setChartType(type)}
            >
              {type === 'Candlestick' ? '🕯️' : type === 'Bar' ? '📊' : type === 'Line' ? '📈' : '🌊'}
            </button>
          ))}
        </div>
      </div>

      <div className="topbar-right">
        {/* Replay Button */}
        <button
          className={`btn-action ${isReplayActive ? 'btn-active' : ''}`}
          onClick={() => {
            if (isReplayActive) {
              setIsActive(false);
              setIsPicking(false);
              showToast('Replay terminé', 'info');
            } else {
              setIsPicking(true);
              showToast('Cliquez sur une bougie pour démarrer le Replay', 'info');
            }
          }}
        >
          <RotateCcw size={15} />
          <span>{isReplayActive ? 'Quitter Replay' : 'Replay Barres'}</span>
        </button>

        {/* Live Market Button */}
        <button className="btn-action" onClick={() => openModal('live')}>
          <Activity size={15} />
          <span>Marché Live</span>
        </button>

        {/* Performance Metrics */}
        <button className="btn-action" onClick={() => openModal('metrics')}>
          <TrendingUp size={15} />
          <span>Performances</span>
        </button>

        <div className="topbar-divider" />

        {/* Volume Toggle */}
        <button
          className={`btn-icon ${showVolume ? 'active' : ''}`}
          onClick={toggleVolume}
          title="Afficher/Masquer le Volume"
        >
          <Volume2 size={16} />
        </button>

        {/* Grid Toggle */}
        <button
          className={`btn-icon ${showGrid ? 'active' : ''}`}
          onClick={toggleGrid}
          title="Afficher/Masquer la Grille"
        >
          <Grid size={16} />
        </button>
      </div>
    </header>
  );
};
