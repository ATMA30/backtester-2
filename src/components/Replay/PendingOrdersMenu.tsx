import React from 'react';
import { ChevronDown, Hourglass, Trash2, X } from 'lucide-react';
import { useMarketStore } from '../../store/useMarketStore';
import { useTradeStore } from '../../store/useTradeStore';
import { useUIStore } from '../../store/useUIStore';
import { formatPrice, unitsToLots } from '../../domain/instruments';

export const PENDING_MENU_ID = 'rp-orders';

/** The orders waiting for their price, each cancellable, or all at once. */
export const PendingOrdersMenu: React.FC = () => {
  const currentSymbol = useMarketStore((m) => m.currentSymbol);
  const { pendingOrders, cancelPendingOrder } = useTradeStore();
  const { activeDropdown, toggleDropdown, closeAllDropdowns } = useUIStore();
  const showOrdersMenu = activeDropdown === PENDING_MENU_ID;
  if (pendingOrders.length === 0) return null;

  return (
    <div className="tv-dropdown rp-orders-dropdown rp-pending">
      <button
        className="rp-pending-orders-btn rp-icon-label"
        onClick={() => toggleDropdown('rp-orders')}
        title="Ordres en attente"
      >
        <Hourglass size={11} strokeWidth={2} className="rp-pending-icon" />
        <span>{pendingOrders.length} en attente</span>
        <ChevronDown size={9} strokeWidth={2.5} />
      </button>
      {showOrdersMenu && (
        <div
          className="tv-dropdown-menu show rp-pending-menu"
        >
          <div className="rp-pending-head">
            <span className="rp-pending-title">Ordres en attente</span>
            {pendingOrders.length > 1 && (
              <button
                onClick={() => {
                  pendingOrders.forEach((o) => cancelPendingOrder(o.id));
                  closeAllDropdowns();
                }} className="rp-pending-cancel-all"
              >
                <Trash2 size={10} strokeWidth={2} />
                <span>Tout annuler</span>
              </button>
            )}
          </div>
          {pendingOrders.map((o) => (
            <div
              key={o.id} className="rp-pending-row"
            >
              <div className="rp-pending-info">
                <span style={{ fontSize: '11px', fontWeight: 700, color: o.type === 'LONG' ? '#34D399' : '#FB7185' }}>
                  {o.type === 'LONG' ? 'Achat' : 'Vente'} {o.orderType === 'LIMIT' ? 'limite' : 'stop'} à {formatPrice(currentSymbol, o.targetPrice)}
                </span>
                <span className="rp-pending-levels">
                  {o.sl ? `SL: ${formatPrice(currentSymbol, o.sl)} ` : ''}
                  {o.tp ? `TP: ${formatPrice(currentSymbol, o.tp)} ` : ''}
                  {`(${unitsToLots(o.symbol ?? currentSymbol, o.size).toFixed(2)} lots)`}
                </span>
              </div>
              <button
                onClick={() => cancelPendingOrder(o.id)}
                title="Annuler cet ordre" className="rp-pending-cancel"
              >
                <X size={11} strokeWidth={2.4} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
