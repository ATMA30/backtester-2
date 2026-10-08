import React from 'react';
import { Scissors } from 'lucide-react';
import { useMarketStore } from '../../store/useMarketStore';
import { formatPrice } from '../../domain/instruments';
import { HoverCandle } from './useReplayPicking';

/** The candle a click would start the replay on: a cut line, the future shaded, its date and price. */
export const ReplayCutLine: React.FC<{ hoverCandleInfo: HoverCandle }> = ({ hoverCandleInfo }) => {
  const currentSymbol = useMarketStore((m) => m.currentSymbol);
  return (
    <div
      className="replay-cut-container chart-hover-layer"
    >
      {/* Future area shadow on right */}
      <div
        className="replay-future-shade"
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: `${hoverCandleInfo.x}px`,
          right: 0,
          background: 'rgba(10, 15, 30, 0.45)',
          backdropFilter: 'blur(0.5px)',
          borderLeft: '2px dashed #38BDF8',
        }}
      />

      {/* Glowing Vertical Cut Line */}
      <div
        className="replay-cut-bar"
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: `${hoverCandleInfo.x - 1}px`,
          width: '2px',
          background: '#38BDF8',
          boxShadow: '0 0 10px rgba(56, 189, 248, 0.8), 0 0 20px rgba(56, 189, 248, 0.4)',
        }}
      />

      {/* Floating Top Badge with Date & Time */}
      <div
        className="replay-cut-badge"
        style={{
          position: 'absolute',
          top: '16px',
          left: `${hoverCandleInfo.x}px`,
          transform: 'translateX(-50%)',
          background: 'rgba(15, 23, 42, 0.95)',
          border: '1px solid rgba(56, 189, 248, 0.6)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.6), 0 0 12px rgba(56, 189, 248, 0.25)',
          borderRadius: '6px',
          padding: '5px 12px',
          color: '#F8FAFC',
          fontSize: '11px',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: '7px',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
        }}
      >
        <span className="chart-hover-start">
          <Scissors size={12} strokeWidth={2.4} />
          Démarrer ici :
        </span>
        <span className="chart-hover-time">
          {new Date(hoverCandleInfo.candle.time * 1000).toLocaleString('fr-FR', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
        <span className="chart-hover-price">
          {/* Precision from the catalogue, not from the price's magnitude. */}
          ({formatPrice(currentSymbol, hoverCandleInfo.candle.close)})
        </span>
      </div>
    </div>
  );
};
