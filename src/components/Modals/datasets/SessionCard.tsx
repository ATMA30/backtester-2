import React from 'react';
import { Download, Play, Trash2 } from 'lucide-react';
import { formatMoney } from '../../../domain/instruments';
import { BacktestSession } from '../../../types/market';
import { SessionLibrary } from './useSessionLibrary';

/** A saved session: its name, instrument, date, figures, and what can be done with it. */
export const SessionCard: React.FC<{ session: BacktestSession; library: SessionLibrary }> = ({ session: s, library }) => {
  const { handleLoadSession, handleExportSession, handleDeleteSession } = library;
    const pnl = (s.totalPnL !== undefined ? s.totalPnL : s.balance - s.initialBalance) || 0;
    const isProfitable = pnl >= 0;
    const tradeCount = s.closedPositions?.length || s.totalTrades || 0;
    const drawingsCount = s.drawings?.length || 0;

  return (
  <div
    key={s.id} className="ds-session-card"
  >
    <div className="ds-session-head">
      <div>
        <div className="ds-session-title">
          <strong className="ds-session-name">{s.name}</strong>
          <span className="badge-type long ds-session-symbol">
            {s.symbol}
          </span>
          {s.replayActive && (
            <span className="ds-session-replay"
            >
              <Play size={9} fill="currentColor" /> Replay #{s.replayIndex}
            </span>
          )}
        </div>
        <div className="ds-session-date">
          Sauvegardé le {new Date(s.updatedAt || s.createdAt).toLocaleDateString('fr-FR')} à {new Date(s.updatedAt || s.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="ds-session-actions">
        <button
          className="btn-sm btn-primary ds-session-resume"
          onClick={() => handleLoadSession(s)}
          title="Reprendre ce backtest"
        >
          <Play size={11} fill="currentColor" />
          <span>Reprendre</span>
        </button>
        <button
          className="tv-icon-btn ds-session-icon-btn"
          onClick={(e) => handleExportSession(e, s)}
          title="Exporter cette sauvegarde"
        >
          <Download size={13} />
        </button>
        <button
          className="tv-icon-btn danger ds-session-delete"
          onClick={(e) => handleDeleteSession(e, s.id, s.name)}
          title="Supprimer cette sauvegarde"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>

    {/* Session Metrics Bar */}
    <div className="ds-session-stats"
    >
      <div>
        <span className="ds-stat-label">Solde </span>
        {/* In the session's own currency: "$" was written for every account. */}
        <strong className="ds-stat-value">{formatMoney(s.balance, { currency: s.accountCurrency ?? 'USD' })}</strong>
      </div>
      <div>
        <span className="ds-stat-label">Résultat </span>
        <strong
          style={{
            color: isProfitable ? 'var(--green)' : 'var(--red)',
            fontFamily: 'var(--mono)',
          }}
        >
          {formatMoney(pnl, { signed: true, currency: s.accountCurrency ?? 'USD' })}
        </strong>
      </div>
      <div>
        <span className="ds-stat-label">Trades </span>
        <strong className="ds-stat-value">{tradeCount}</strong>
      </div>
      {s.winRate !== undefined && tradeCount > 0 && (
        <div>
          <span className="ds-stat-label">Réussite </span>
          <strong className="ds-stat-value-gold">{s.winRate.toFixed(1)}%</strong>
        </div>
      )}
      <div>
        <span className="ds-stat-label">Tracés </span>
        <strong className="ds-stat-value">{drawingsCount}</strong>
      </div>
    </div>
  </div>
  );
};
