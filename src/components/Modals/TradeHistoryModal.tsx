import React from 'react';
import { Download, X, BookOpen } from 'lucide-react';
import { useUIStore } from '../../store/useUIStore';
import { useTradeStore } from '../../store/useTradeStore';

export const TradeHistoryModal: React.FC = () => {
  const { activeModal, closeModal, showToast } = useUIStore();
  const { closedPositions, getMetrics } = useTradeStore();

  if (activeModal !== 'trade-history') return null;

  const m = getMetrics();

  const exportTradeHistory = () => {
    if (!closedPositions.length) return;
    const header = 'id,type,entry,exitPrice,size,time,closeTime,pnl,closeReason\n';
    const rows = closedPositions
      .map((p) => `${p.id},${p.type},${p.entry},${p.exitPrice},${p.size},${p.time},${p.closeTime},${p.pnl},${p.closeReason}`)
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trades_history_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Journal de trades exporté en CSV !', 'success');
  };

  // Generate SVG Equity Curve Points
  let runningBalance = m.initialBalance;
  const balancePoints: number[] = [runningBalance];
  [...closedPositions].reverse().forEach((p) => {
    runningBalance += p.pnl || 0;
    balancePoints.push(runningBalance);
  });

  const minB = Math.min(...balancePoints);
  const maxB = Math.max(...balancePoints);
  const rangeB = maxB - minB || 1;

  const svgW = 320;
  const svgH = 60;
  const polylinePts = balancePoints
    .map((b, i) => {
      const x = (i / (balancePoints.length - 1 || 1)) * svgW;
      const y = svgH - ((b - minB) / rangeB) * (svgH - 10) - 5;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <div id="trade-history-panel" className="open" style={{ display: 'flex' }}>
      <div className="th-header">
        <div className="th-title" style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
          <BookOpen size={15} strokeWidth={2} style={{ color: '#38BDF8' }} />
          <span>Journal de trades</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            className="th-export"
            onClick={exportTradeHistory}
            title="Exporter CSV"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <Download size={13} strokeWidth={2} />
          </button>
          <button
            className="th-close"
            onClick={closeModal}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <X size={14} strokeWidth={2.4} />
          </button>
        </div>
      </div>

      <div className="th-stats">
        <div className="th-stat">
          <div className="th-stat-label">Trades</div>
          <div className="th-stat-val" id="th-count">{m.totalTrades}</div>
        </div>
        <div className="th-stat">
          <div className="th-stat-label">Win rate</div>
          <div className="th-stat-val" id="th-winrate">{m.winRate.toFixed(1)}%</div>
        </div>
        <div className="th-stat">
          <div className="th-stat-label">P&amp;L total</div>
          <div className={`th-stat-val ${m.totalPnL >= 0 ? 'text-green' : 'text-red'}`} id="th-total-pnl">
            {(m.totalPnL >= 0 ? '+$' : '-$') + Math.abs(m.totalPnL).toFixed(2)}
          </div>
        </div>
        <div className="th-stat">
          <div className="th-stat-label">Solde</div>
          <div className="th-stat-val">${m.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        </div>
        <div className="th-stat">
          <div className="th-stat-label">Profit Factor</div>
          <div className="th-stat-val" id="th-profit-factor">{m.profitFactor.toFixed(2)}</div>
        </div>
        <div className="th-stat">
          <div className="th-stat-label">Gagnants</div>
          <div className="th-stat-val text-green">{m.winningTrades}</div>
        </div>
      </div>

      {/* Equity Curve */}
      <div id="equity-curve-container" style={{ margin: '8px 0', height: '60px' }}>
        <svg id="equity-curve" style={{ width: '100%', height: '100%' }} viewBox={`0 0 ${svgW} ${svgH}`}>
          <polyline
            fill="none"
            stroke="#00D26A"
            strokeWidth="2"
            points={polylinePts}
          />
        </svg>
      </div>

      <div className="th-list" id="th-list">
        {closedPositions.length === 0 ? (
          <div className="th-empty">Aucun trade fermé</div>
        ) : (
          closedPositions.map((p) => {
            const isWin = (p.pnl || 0) >= 0;
            return (
              <div key={p.id} className="th-row" style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <span className={`badge-type ${p.type.toLowerCase()}`}>{p.type}</span>
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                    {p.entry.toFixed(p.entry < 10 ? 5 : 2)} → {p.exitPrice?.toFixed(p.entry < 10 ? 5 : 2)} ({p.closeReason})
                  </span>
                </div>
                <div style={{ fontWeight: 700, color: isWin ? 'var(--bull)' : 'var(--bear)' }}>
                  {isWin ? '+' : ''}${p.pnl?.toFixed(2)}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
