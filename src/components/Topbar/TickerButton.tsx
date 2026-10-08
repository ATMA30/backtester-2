import React from 'react';
import { ChevronDown, TrendingDown, TrendingUp } from 'lucide-react';
import { useMarketStore } from '../../store/useMarketStore';
import { useUIStore } from '../../store/useUIStore';
import { AssetClass, formatPrice, getInstrument } from '../../domain/instruments';

/**
 * Badge per asset class.
 *
 * The badge was previously guessed from substrings of the symbol — a fifth
 * classifier, alongside `classifyUnknown` and three others the codebase had
 * already consolidated into `domain/instruments`. It disagreed with them: any
 * ticker containing "SOL" (SOLUSDT, but also a hypothetical SOLAR index) was
 * labelled CRYPTO, and XAGUSD fell through to FX because no rule matched
 * "XAG" before the metals branch. One catalogue, one answer.
 */
const MARKET_BADGES: Readonly<Record<AssetClass, { label: string; type: string }>> = {
  forex: { label: 'FX', type: 'fx' },
  metal: { label: 'COMMO', type: 'commo' },
  energy: { label: 'COMMO', type: 'commo' },
  index: { label: 'INDEX', type: 'index' },
  crypto: { label: 'CRYPTO', type: 'crypto' },
  synthetic: { label: 'SYNTH', type: 'synth' },
};

/** The instrument on screen, its last price and its change over the loaded history. */
export const TickerButton: React.FC = () => {
  const currentSymbol = useMarketStore((m) => m.currentSymbol);
  const displayCandles = useMarketStore((m) => m.displayCandles);
  const baseCandles = useMarketStore((m) => m.baseCandles);
  const openModal = useUIStore((s) => s.openModal);

  const lastCandle = displayCandles[displayCandles.length - 1];
  const lastPrice = lastCandle ? lastCandle.close : 0;
  const instrument = getInstrument(currentSymbol, lastPrice);
  // Its open is the first bucket's open at any timeframe, and unlike
  // `displayCandles[0]` it does not move when the replay window slides.
  const firstCandle = baseCandles[0];
  const changePercent =
    firstCandle && firstCandle.open > 0 && lastCandle
      ? ((lastCandle.close - firstCandle.open) / firstCandle.open) * 100
      : 0;
  const marketBadge = MARKET_BADGES[instrument.assetClass];

  return (
    <button type="button"
      id="topbar-ticker"
      className="topbar-asset-selector"
      onClick={() => openModal('live')}
      title="Changer d'instrument"
    >
      <span className={`market-badge ${marketBadge.type}`}>{marketBadge.label}</span>
      <span id="ticker-symbol" className="ticker-symbol">{currentSymbol}</span>
      <ChevronDown size={12} strokeWidth={2.2} className="ticker-chevron" />
      <div className="ticker-sep" />
      <span id="ticker-price" className="ticker-price">
        {/* `toFixed(price < 10 ? 5 : 2)` was the last magnitude-based
            precision heuristic left in the UI: it printed gold at 2 digits
            and DOGE at 5 regardless of their catalogue entries. */}
        {lastPrice > 0 ? formatPrice(currentSymbol, lastPrice) : '—'}
      </span>
      <span
        id="ticker-change"
        className={`ticker-change-pill ${changePercent >= 0 ? 'bull' : 'bear'}`}
      >
        <span className="ticker-change-arrow">
          {changePercent >= 0 ? (
            <TrendingUp size={11} strokeWidth={2.4} />
          ) : (
            <TrendingDown size={11} strokeWidth={2.4} />
          )}
        </span>
        <span>{changePercent >= 0 ? '+' : ''}{changePercent.toFixed(2)}%</span>
      </span>
    </button>
  );
};
