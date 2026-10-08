import React from 'react';
import { ChevronDown, Layers, PieChart, ShieldCheck, X } from 'lucide-react';
import { useTradeStore } from '../../store/useTradeStore';
import { useUIStore } from '../../store/useUIStore';
import { formatMoney, formatPrice, unitsToLots } from '../../domain/instruments';
import { netPnlAtMarket } from '../../domain/position-sizing';
import { resolveCosts } from '../../domain/trading-costs';
import { blockTradingInThePast } from './replayGuards';

interface OpenPositionsMenuProps {
  /** Instrument on screen, for positions saved without one. */
  readonly symbol: string;
  /** Bid of the replay candle: what a close at market would get. */
  readonly price: number;
  /** Time of the replay candle, stamped on every close. */
  readonly time?: number;
}

export const POSITIONS_MENU_ID = 'rp-positions';

/**
 * Every open position, each with its own actions.
 *
 * With a single position the replay bar keeps its direct buttons; this menu is
 * what those buttons become once several are open, since "stop at entry" or
 * "close half" no longer says which trade it applies to.
 */
export const OpenPositionsMenu: React.FC<OpenPositionsMenuProps> = ({ symbol, price, time }) => {
  const { openPositions, costs, setBreakeven, closePartial, closeAtMarket } = useTradeStore();
  const { activeDropdown, toggleDropdown } = useUIStore();
  const isOpen = activeDropdown === POSITIONS_MENU_ID;

  /** Every action on a position is refused while reviewing past candles. */
  const act = (action: () => void) => () => {
    if (!blockTradingInThePast()) action();
  };

  return (
    <div className="tv-dropdown rp-positions">
      <button
        type="button"
        className="rp-positions-btn"
        id="btn-positions"
        aria-expanded={isOpen}
        aria-haspopup="true"
        onClick={() => toggleDropdown(POSITIONS_MENU_ID)}
        title="Positions ouvertes"
      >
        <Layers size={11} strokeWidth={2} />
        <span>{openPositions.length} positions</span>
        <ChevronDown size={9} strokeWidth={2.5} />
      </button>

      {isOpen && (
        <div className="tv-dropdown-menu show rp-positions-menu" role="menu" aria-label="Positions ouvertes">
          {openPositions.map((position) => {
            const positionSymbol = position.symbol ?? symbol;
            const pnl = price > 0
              ? netPnlAtMarket(position, positionSymbol, price, resolveCosts(positionSymbol, price, costs))
              : null;
            const isLong = position.type === 'LONG';
            const lots = unitsToLots(positionSymbol, position.size).toFixed(2);
            return (
              <div key={position.id} className="rp-position-row" role="group" aria-label={`${isLong ? 'Achat' : 'Vente'} ${lots} lots à ${formatPrice(positionSymbol, position.entry)}`}>
                <div className="rp-position-info">
                  <span className={`rp-position-side ${isLong ? 'long' : 'short'}`}>
                    {isLong ? 'Achat' : 'Vente'} {lots} L à {formatPrice(positionSymbol, position.entry)}
                  </span>
                  <span className="rp-position-levels">
                    {position.sl !== null ? `SL ${formatPrice(positionSymbol, position.sl)}` : 'sans stop'}
                    {position.tp !== null ? ` · TP ${formatPrice(positionSymbol, position.tp)}` : ''}
                  </span>
                </div>
                <span className={`rp-position-pnl ${pnl === null ? '' : pnl >= 0 ? 'profit' : 'loss'}`}>
                  {pnl === null ? '—' : formatMoney(pnl, { signed: true })}
                </span>
                <div className="rp-position-actions">
                  <button type="button" title="Remonter le stop au prix d’entrée" aria-label="Stop à l’entrée" onClick={act(() => setBreakeven(position.id))}>
                    <ShieldCheck size={11} strokeWidth={2} />
                  </button>
                  <button type="button" title="Clôturer la moitié" aria-label="Clôturer 50 %" onClick={act(() => closePartial(position.id, 50, price, time))}>
                    <PieChart size={11} strokeWidth={2} />
                  </button>
                  <button type="button" className="danger" title="Fermer cette position" aria-label="Fermer" onClick={act(() => closeAtMarket(position.id, price, time))}>
                    <X size={11} strokeWidth={2.4} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
