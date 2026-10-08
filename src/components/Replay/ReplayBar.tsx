import React, { useEffect, useRef } from 'react';
import { useReplayStore } from '../../store/useReplayStore';
import { useMarketStore } from '../../store/useMarketStore';
import { useTradeStore } from '../../store/useTradeStore';
import { useUIStore } from '../../store/useUIStore';
import { formatMoney } from '../../domain/instruments';
import { netPnlAtMarket } from '../../domain/position-sizing';
import { resolveCosts } from '../../domain/trading-costs';
import { CostsMenu } from './CostsMenu';
import { POSITIONS_MENU_ID } from './OpenPositionsMenu';
import { AccountMenu, ACCOUNT_MENU_ID } from './AccountMenu';
import { ReplayTransport, ANCHOR_MENU_ID, SPEED_MENU_ID } from './ReplayTransport';
import { PendingOrdersMenu, PENDING_MENU_ID } from './PendingOrdersMenu';
import { OrderTicketFields } from './OrderTicketFields';
import { ExecutionActions } from './ExecutionActions';
import { useReplayPlayback } from './useReplayPlayback';
import { useOrderTicket } from './useOrderTicket';

/** Menus of the bar; while one is open, the bar stops clipping (`has-open-menu`). */
const BAR_MENUS = new Set([ANCHOR_MENU_ID, SPEED_MENU_ID, PENDING_MENU_ID, POSITIONS_MENU_ID, ACCOUNT_MENU_ID]);

/**
 * The replay bar: transport on the left, the account in the middle, the order
 * ticket and its execution below.
 */
export const ReplayBar: React.FC = () => {
  const { isActive, currentIndex } = useReplayStore();
  const { baseCandles, currentSymbol } = useMarketStore();
  const { openPositions, costs } = useTradeStore();
  const activeDropdown = useUIStore((s) => s.activeDropdown);
  const barRef = useRef<HTMLDivElement>(null);
  useReplayPlayback();
  const ticket = useOrderTicket();
  const { rrRatio, rrRatioStr } = ticket;

  /** Un menu ouvert doit pouvoir déborder de la barre — voir `has-open-menu`. */
  const isMenuOpen = activeDropdown !== null && BAR_MENUS.has(activeDropdown);
  const currentCandle = baseCandles[currentIndex];
  const currentPrice = currentCandle ? currentCandle.close : 0;

  /**
   * Publish the bar's real height so the layout can clear it.
   *
   * The chart used to be shrunk by a hardcoded 70px. The bar is taller than
   * that as soon as the order-hint line wraps — on a wide screen it reached
   * ~100px — and the overflow landed on the status bar, hiding the data
   * source, the candle count and the date range behind the trading controls.
   * A measured value cannot drift away from the markup.
   */
  useEffect(() => {
    const node = barRef.current;
    if (!node || !isActive) return;

    // `offsetHeight`, pas `getBoundingClientRect` : l'animation d'entrée de la
    // barre contient un `scale(0.98)`, et le rectangle mesuré inclut la
    // transformation — la hauteur publiée était celle d'une image intermédiaire.
    const publish = () => {
      document.documentElement.style.setProperty('--replay-bar-h', `${node.offsetHeight}px`);
    };
    publish();

    const observer = new ResizeObserver(publish);
    // border-box : la mesure doit inclure bordure et remplissage, comme
    // `getBoundingClientRect`, sinon la valeur publiée sous-estime la barre.
    observer.observe(node, { box: 'border-box' });
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--replay-bar-h');
    };
  }, [isActive]);

  if (!isActive) return null;

  // Calculate live PnL & RR
  let currentPnL;
  let pnlStr = '—';
  let pnlCls = 'idle';
  if (openPositions.length > 0 && currentPrice) {
    // Net : sortie du bon côté du spread, commissions déduites — ce que la
    // clôture créditerait vraiment. Toutes positions confondues.
    currentPnL = 0;
    for (const position of openPositions) {
      const symbol = position.symbol ?? currentSymbol;
      currentPnL += netPnlAtMarket(position, symbol, currentPrice, resolveCosts(symbol, currentPrice, costs));
    }
    pnlStr = formatMoney(currentPnL, { signed: true });
    pnlCls = currentPnL >= 0 ? 'profit' : 'loss';
  }

  return (
    <div
      id="replay-bar"
      ref={barRef}
      // `#replay-bar` défile (`overflow: auto`) pour ne jamais rogner un bouton
      // d'exécution sur une fenêtre courte. Mais un conteneur en `overflow`
      // rogne aussi ses descendants `position: absolute` : les trois menus
      // s'ouvrent vers le haut et se faisaient couper au ras de la barre, seule
      // leur dernière ligne dépassant. On ne peut pas à la fois faire défiler
      // un conteneur et laisser un enfant s'en échapper — alors on tranche au
      // moment près : tant qu'un menu est ouvert, la barre ne défile pas.
      className={isMenuOpen ? 'has-open-menu' : undefined}
    >
      <ReplayTransport />

      <div className="replay-bar-separator" />

      {/* ── BLOCK 2: INDICATEURS DE COMPTE & STATS (AU CENTRE) ── */}
      <div className="rp-metrics-group">
        <AccountMenu />

        <CostsMenu symbol={currentSymbol} price={currentPrice} />

        {/* 2. P&L Ouvert passif sans faux cadre de saisie */}
        <div className="rp-stat-group">
          <span className="rp-stat-label">Résultat latent</span>
          <span id="rp-pnl" className={`rp-pnl-passive ${pnlCls}`}>
            {pnlStr}
          </span>
        </div>

        {/* `#rr-badge` est déclaré `display: none` et seule `.visible` le
            révèle — une classe que ce composant n'a jamais posée. Le badge de
            ratio risque/récompense était donc invisible en permanence, alors
            que le calcul tournait à chaque frappe. `.good` / `.bad` existaient
            aussi sans être utilisées : le ratio se lit d'un coup d'œil quand il
            est coloré, et c'est tout l'intérêt d'un badge. */}
        {rrRatio !== null && (
          <div
            id="rr-badge"
            className={`visible ${rrRatio >= 2 ? 'good' : rrRatio < 1 ? 'bad' : ''}`}
            title={`Ratio risque / récompense — ${
              rrRatio >= 2
                ? 'favorable'
                : rrRatio < 1
                  ? 'défavorable : le risque dépasse l’objectif'
                  : 'correct'
            }`}
          >
            R:R <span id="rr-val">{rrRatioStr}</span>
          </div>
        )}


        <PendingOrdersMenu />
      </div>

      <div className="replay-bar-separator" />

      <OrderTicketFields ticket={ticket} />

      <ExecutionActions ticket={ticket} />
    </div>
  );
};
