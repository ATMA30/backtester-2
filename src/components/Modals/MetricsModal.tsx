import React from 'react';
import { X, TrendingUp, Award, Percent, DollarSign } from 'lucide-react';
import { useTradeStore } from '../../store/useTradeStore';
import { useUIStore } from '../../store/useUIStore';

export const MetricsModal: React.FC = () => {
  const { activeModal, closeModal } = useUIStore();
  const { getMetrics, closedPositions, resetAccount } = useTradeStore();

  if (activeModal !== 'metrics') return null;

  const m = getMetrics();

  return (
    <div className="modal-backdrop" onClick={closeModal}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <TrendingUp size={18} className="text-primary" />
            <span>Statistiques & Performances Backtest</span>
          </div>
          <button className="modal-close" onClick={closeModal}>
            <X size={18} />
          </button>
        </div>

        {/* Metrics Grid */}
        <div className="metrics-grid">
          <div className="metric-box">
            <span className="metric-label">Capital Final</span>
            <div className={`metric-val ${m.totalPnL >= 0 ? 'text-green' : 'text-red'}`}>
              ${m.balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </div>
            <span className="metric-sub">Capital Initial : ${m.initialBalance}</span>
          </div>

          <div className="metric-box">
            <span className="metric-label">Taux de Réussite (Winrate)</span>
            <div className="metric-val text-primary">{m.winRate.toFixed(1)}%</div>
            <span className="metric-sub">{m.winningTrades} Gagnants / {m.losingTrades} Perdants</span>
          </div>

          <div className="metric-box">
            <span className="metric-label">Profit Factor</span>
            <div className="metric-val text-yellow">{m.profitFactor.toFixed(2)}</div>
            <span className="metric-sub">Ratio Gains / Pertes</span>
          </div>

          <div className="metric-box">
            <span className="metric-label">Total Trades</span>
            <div className="metric-val">{m.totalTrades}</div>
            <span className="metric-sub">Positions exécutées</span>
          </div>
        </div>

        {/* Closed Positions History */}
        <div className="trade-history-section">
          <div className="section-title">Historique des Ordres Clôturés</div>
          {closedPositions.length === 0 ? (
            <div className="text-muted text-center py-6">Aucun trade clôturé pour le moment.</div>
          ) : (
            <div className="table-wrapper">
              <table className="trades-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Entrée</th>
                    <th>Sortie</th>
                    <th>Raison</th>
                    <th>PnL ($)</th>
                  </tr>
                </thead>
                <tbody>
                  {closedPositions.map((p) => {
                    const isWin = (p.pnl || 0) >= 0;
                    return (
                      <tr key={p.id}>
                        <td><span className={`badge-type ${p.type.toLowerCase()}`}>{p.type}</span></td>
                        <td>{p.entry.toFixed(5)}</td>
                        <td>{p.exitPrice?.toFixed(5)}</td>
                        <td>{p.closeReason}</td>
                        <td className={isWin ? 'text-green font-bold' : 'text-red font-bold'}>
                          {isWin ? '+' : ''}${p.pnl?.toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={resetAccount}>
            Réinitialiser le compte ($10,000)
          </button>
        </div>
      </div>
    </div>
  );
};
