import React from 'react';
import { ArrowUp, ArrowDown, ShieldCheck, PieChart, XCircle, BookOpen } from 'lucide-react';
import { useReplayStore } from '../../store/useReplayStore';
import { useMarketStore } from '../../store/useMarketStore';
import { useTradeStore } from '../../store/useTradeStore';
import { useUIStore } from '../../store/useUIStore';
import { OpenPositionsMenu } from './OpenPositionsMenu';
import { blockTradingInThePast } from './replayGuards';
import { OrderTicket } from './useOrderTicket';

/** Buy, sell, manage what is open, and open the journal. */
export const ExecutionActions: React.FC<{ ticket: OrderTicket }> = ({ ticket }) => {
  const currentIndex = useReplayStore((r) => r.currentIndex);
  const { baseCandles, currentSymbol } = useMarketStore();
  const { openPositions, closeAtMarket, closeAllAtMarket, closePartial, setBreakeven } = useTradeStore();
  const openModal = useUIStore((s) => s.openModal);
  const currentCandle = baseCandles[currentIndex];
  const currentPrice = currentCandle ? currentCandle.close : 0;
  /** With one position the bar acts on it directly; with several, the menu does. */
  const singlePosition = openPositions.length === 1 ? openPositions[0] : null;
  const handleBuy = () => ticket.submitOrder('LONG');
  const handleSell = () => ticket.submitOrder('SHORT');

  return (
    <div className="rp-actions">
      {/* 4. Boutons BUY / SELL épurés et alignés en hauteur */}
      <button className="trade-btn buy rp-icon-label" id="btn-buy" onClick={handleBuy} title="Acheter — au marché ou en attente selon le prix saisi">
        <ArrowUp size={12} strokeWidth={2.8} />
        <span>Acheter</span>
      </button>
      <button className="trade-btn sell rp-icon-label" id="btn-sell" onClick={handleSell} title="Vendre — au marché ou en attente selon le prix saisi">
        <ArrowDown size={12} strokeWidth={2.8} />
        <span>Vendre</span>
      </button>

      {/* Gestion de position : ces trois actions n'ont de sens qu'avec une
          position ouverte. Les afficher grisées en permanence occupait un
          tiers de la barre et poussait « Fermer » hors de l'écran. */}
      {singlePosition && (
        <>
          <button
            className="trade-btn be rp-icon-label-tight"
            id="btn-be"
            onClick={() => {
              if (!blockTradingInThePast()) setBreakeven(singlePosition.id);
            }}
            title="Remonter le stop au prix d’entrée"
          >
            <ShieldCheck size={12} strokeWidth={2} />
            <span>Stop à l’entrée</span>
          </button>
          <button
            className="trade-btn scale rp-icon-label-tight"
            id="btn-scale-50"
            onClick={() => {
              if (!blockTradingInThePast()) closePartial(singlePosition.id, 50, currentPrice, currentCandle?.time);
            }}
            title="Clôturer la moitié de la position"
          >
            <PieChart size={12} strokeWidth={2} />
            <span>Clôturer 50 %</span>
          </button>
        </>
      )}

      {openPositions.length > 1 && (
        <OpenPositionsMenu symbol={currentSymbol} price={currentPrice} time={currentCandle?.time} />
      )}

      {openPositions.length > 0 && (
        <button
          className="trade-btn close rp-icon-label-tight"
          id="btn-close-pos"
          onClick={() => {
            if (blockTradingInThePast()) return;
            if (singlePosition) closeAtMarket(singlePosition.id, currentPrice, currentCandle?.time);
            else closeAllAtMarket(currentPrice, currentCandle?.time);
          }}
          title={singlePosition ? 'Fermer la position totale' : 'Fermer toutes les positions'}
        >
          <XCircle size={12} strokeWidth={2} />
          <span>{singlePosition ? 'Fermer' : 'Tout fermer'}</span>
        </button>
      )}

      {/* 4. Bouton Journal explicite */}
      <button
        className="trade-btn journal-btn rp-journal-btn"
        id="btn-history"
        onClick={() => openModal('trade-history')}
        title="Journal des trades & Historique des ordres"
      >
        <BookOpen size={14} strokeWidth={2} />
      </button>
    </div>
  );
};
