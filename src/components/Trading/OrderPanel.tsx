import React, { useState } from 'react';
import { TrendingUp, TrendingDown, X, ShieldCheck } from 'lucide-react';
import { useTradeStore } from '../../store/useTradeStore';
import { useMarketStore } from '../../store/useMarketStore';
import { useUIStore } from '../../store/useUIStore';
import { sound } from '../../services/audio';

export const OrderPanel: React.FC = () => {
  const {
    balance,
    positions,
    riskPercent,
    openPosition,
    closePosition,
  } = useTradeStore();

  const { displayCandles, currentSymbol } = useMarketStore();
  const { showToast } = useUIStore();

  const [tpPips, setTpPips] = useState(40);
  const [slPips, setSlPips] = useState(20);

  const lastCandle = displayCandles[displayCandles.length - 1];
  const currentPrice = lastCandle ? lastCandle.close : 0;
  const pip = currentSymbol.includes('JPY') ? 0.01 : 0.0001;

  const handleBuy = () => {
    if (!currentPrice || !lastCandle) return;
    const tp = tpPips > 0 ? currentPrice + tpPips * pip : null;
    const sl = slPips > 0 ? currentPrice - slPips * pip : null;
    openPosition('LONG', currentPrice, sl, tp, lastCandle.time);
    sound.playClick();
    showToast(`🟢 Ordre ACHAT ouvert à ${currentPrice.toFixed(5)}`, 'success');
  };

  const handleSell = () => {
    if (!currentPrice || !lastCandle) return;
    const tp = tpPips > 0 ? currentPrice - tpPips * pip : null;
    const sl = slPips > 0 ? currentPrice + slPips * pip : null;
    openPosition('SHORT', currentPrice, sl, tp, lastCandle.time);
    sound.playClick();
    showToast(`🔴 Ordre VENTE ouvert à ${currentPrice.toFixed(5)}`, 'success');
  };

  return (
    <div className="order-panel">
      {/* Account Info */}
      <div className="account-summary">
        <div>
          <span className="text-muted text-xs">Capital Virtuel</span>
          <div className="balance-val">${balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
        </div>
        <div className="risk-tag">Risque : {riskPercent}%</div>
      </div>

      {/* Action Buttons */}
      <div className="order-actions">
        <button className="btn-buy" onClick={handleBuy}>
          <TrendingUp size={16} />
          <div>
            <div className="btn-label">ACHAT (LONG)</div>
            <div className="btn-sub">{currentPrice ? currentPrice.toFixed(currentPrice < 10 ? 5 : 2) : '---'}</div>
          </div>
        </button>

        <button className="btn-sell" onClick={handleSell}>
          <TrendingDown size={16} />
          <div>
            <div className="btn-label">VENTE (SHORT)</div>
            <div className="btn-sub">{currentPrice ? currentPrice.toFixed(currentPrice < 10 ? 5 : 2) : '---'}</div>
          </div>
        </button>
      </div>

      {/* Risk Params */}
      <div className="order-inputs">
        <div className="input-group">
          <label>TP (Pips) :</label>
          <input
            type="number"
            value={tpPips}
            onChange={(e) => setTpPips(parseInt(e.target.value) || 0)}
          />
        </div>
        <div className="input-group">
          <label>SL (Pips) :</label>
          <input
            type="number"
            value={slPips}
            onChange={(e) => setSlPips(parseInt(e.target.value) || 0)}
          />
        </div>
      </div>

      {/* Active Positions */}
      {positions.length > 0 && (
        <div className="positions-list">
          <div className="pos-header">Positions en cours ({positions.length})</div>
          {positions.map((p) => {
            const currentPnL =
              p.type === 'LONG'
                ? (currentPrice - p.entry) * p.size
                : (p.entry - currentPrice) * p.size;
            const isWin = currentPnL >= 0;

            return (
              <div key={p.id} className={`pos-row ${p.type.toLowerCase()}`}>
                <div className="pos-info">
                  <span className={`badge-type ${p.type.toLowerCase()}`}>{p.type}</span>
                  <span className="entry-price">{p.entry.toFixed(p.entry < 10 ? 5 : 2)}</span>
                </div>

                <div className={`pos-pnl ${isWin ? 'text-green' : 'text-red'}`}>
                  {isWin ? '+' : ''}${currentPnL.toFixed(2)}
                </div>

                <button
                  className="close-pos-btn"
                  onClick={() => {
                    closePosition(p.id, currentPrice, lastCandle.time, 'MANUAL');
                    showToast('Position clôturée', 'info');
                  }}
                  title="Clôturer la position"
                >
                  <X size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
