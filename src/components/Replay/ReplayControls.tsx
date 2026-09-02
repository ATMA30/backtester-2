import React, { useEffect } from 'react';
import { Play, Pause, SkipForward, SkipBack, X, FastForward } from 'lucide-react';
import { useReplayStore } from '../../store/useReplayStore';
import { useMarketStore } from '../../store/useMarketStore';
import { useTradeStore } from '../../store/useTradeStore';

export const ReplayControls: React.FC = () => {
  const {
    isActive,
    isPlaying,
    currentIndex,
    startIndex,
    speedMs,
    setIsPlaying,
    setIsActive,
    stepForward,
    stepBackward,
    setSpeedMs,
    setCurrentIndex,
  } = useReplayStore();

  const { baseCandles, setDisplayCandles } = useMarketStore();
  const { updatePositionsOnPrice } = useTradeStore();

  // ── REPLAY TICK LOOP ──────────────────────────────────────
  useEffect(() => {
    if (!isActive || !isPlaying) return;

    const interval = setInterval(() => {
      if (currentIndex >= baseCandles.length - 1) {
        setIsPlaying(false);
        return;
      }
      const nextIdx = currentIndex + 1;
      setCurrentIndex(nextIdx);

      const nextCandle = baseCandles[nextIdx];
      if (nextCandle) {
        updatePositionsOnPrice(nextCandle.close, nextCandle.time);
      }
    }, speedMs);

    return () => clearInterval(interval);
  }, [isActive, isPlaying, currentIndex, speedMs, baseCandles, setCurrentIndex, setIsPlaying, updatePositionsOnPrice]);

  // ── SYNC DISPLAY CANDLES ON SLICE ─────────────────────────
  useEffect(() => {
    if (!isActive || !baseCandles.length) return;
    const sliced = baseCandles.slice(0, currentIndex + 1);
    setDisplayCandles(sliced);
  }, [isActive, currentIndex, baseCandles, setDisplayCandles]);

  if (!isActive) return null;

  const currentCandle = baseCandles[currentIndex];
  const currentDateStr = currentCandle
    ? new Date(currentCandle.time * 1000).toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

  return (
    <div className="replay-bar">
      <div className="replay-date-badge">
        <span>⏱️ Replay :</span>
        <strong>{currentDateStr}</strong>
        <span className="replay-progress">
          ({currentIndex - startIndex + 1} / {baseCandles.length - startIndex})
        </span>
      </div>

      <div className="replay-buttons">
        <button className="replay-btn" onClick={stepBackward} title="Reculer d'une bougie">
          <SkipBack size={15} />
        </button>

        <button
          className={`replay-btn play-btn ${isPlaying ? 'active' : ''}`}
          onClick={() => setIsPlaying(!isPlaying)}
        >
          {isPlaying ? <Pause size={16} /> : <Play size={16} />}
        </button>

        <button className="replay-btn" onClick={stepForward} title="Avancer d'une bougie">
          <SkipForward size={15} />
        </button>
      </div>

      <div className="replay-speed-group">
        {[
          { label: '0.5x', ms: 1000 },
          { label: '1x', ms: 500 },
          { label: '3x', ms: 200 },
          { label: '10x', ms: 60 },
        ].map((s) => (
          <button
            key={s.ms}
            className={`speed-btn ${speedMs === s.ms ? 'active' : ''}`}
            onClick={() => setSpeedMs(s.ms)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <button
        className="replay-close-btn"
        onClick={() => {
          setIsPlaying(false);
          setIsActive(false);
          setDisplayCandles(baseCandles);
        }}
        title="Fermer le Replay"
      >
        <X size={16} />
      </button>
    </div>
  );
};
