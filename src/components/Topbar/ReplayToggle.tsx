import React from 'react';
import { History } from 'lucide-react';
import { useReplayStore } from '../../store/useReplayStore';
import { useUIStore } from '../../store/useUIStore';
import { blockRelocationWhileTrading } from '../Replay/replayGuards';

/** Start a replay (then pick its first candle), or leave it. */
export const ReplayToggle: React.FC = () => {
  const { isActive: isReplayActive, isPicking, setIsActive, setIsPicking } = useReplayStore();
  const showToast = useUIStore((s) => s.showToast);

  return (
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
  );
};
