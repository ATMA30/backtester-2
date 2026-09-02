import React, { useEffect, useState } from 'react';
import { useReplayStore } from '../../store/useReplayStore';
import { useMarketStore, aggregateCandles } from '../../store/useMarketStore';
import { useTradeStore } from '../../store/useTradeStore';
import { useUIStore } from '../../store/useUIStore';

export const ReplayBar: React.FC = () => {
  const {
    isActive,
    isPlaying,
    currentIndex,
    startIndex,
    speedMs,
    setIsPlaying,
    setIsActive,
    setCurrentIndex,
    setStartIndex,
    setSpeedMs,
    stepForward,
    stepBackward,
  } = useReplayStore();

  const { baseCandles, setDisplayCandles, currentSymbol, activeTF, baseTF } = useMarketStore();
  const {
    balance,
    activePosition,
    riskPercent,
    quantity,
    setRiskPercent,
    setQuantity,
    openTrade,
    closePosition,
    closePartial,
    setBreakeven,
    updatePrice,
  } = useTradeStore();

  const { openModal, showToast } = useUIStore();

  const [entryInput, setEntryInput] = useState('');
  const [slInput, setSlInput] = useState('');
  const [tpInput, setTpInput] = useState('');
  const [showAnchorMenu, setShowAnchorMenu] = useState(false);

  const pip = currentSymbol.includes('JPY') ? 0.01 : 0.0001;

  // ── REPLAY LOOP ───────────────────────────────────────────
  useEffect(() => {
    if (!isActive || !isPlaying) return;
    const interval = setInterval(() => {
      if (currentIndex >= baseCandles.length - 1) {
        setIsPlaying(false);
        return;
      }
      const nextIdx = currentIndex + 1;
      setCurrentIndex(nextIdx);

      const nextCandle = baseCandles[nextIdx];
      if (nextCandle) {
        updatePrice(nextCandle.close, nextCandle.time);
      }
    }, speedMs);
    return () => clearInterval(interval);
  }, [isActive, isPlaying, currentIndex, speedMs, baseCandles, setCurrentIndex, setIsPlaying, updatePrice]);

  // ── SLICE SYNC WITH TIMEFRAME AGGREGATION ─────────────────
  useEffect(() => {
    if (!isActive || !baseCandles.length) return;
    const sliced = baseCandles.slice(0, currentIndex + 1);
    const aggregated = aggregateCandles(sliced, activeTF, baseTF);
    setDisplayCandles(aggregated);
  }, [isActive, currentIndex, baseCandles, activeTF, baseTF, setDisplayCandles]);

  if (!isActive) return null;

  const currentCandle = baseCandles[currentIndex];
  const lastCandle = baseCandles[baseCandles.length - 1];
  const currentPrice = currentCandle ? currentCandle.close : 0;

  const timeCurStr = currentCandle
    ? new Date(currentCandle.time * 1000).toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'short',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

  const timeEndStr = lastCandle
    ? new Date(lastCandle.time * 1000).toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'short',
        year: '2-digit',
      })
    : '—';

  // Calculate live PnL & RR
  let currentPnL;
  let pnlStr = '--';
  let pnlCls = '';
  if (activePosition && currentPrice) {
    currentPnL =
      activePosition.type === 'LONG'
        ? (currentPrice - activePosition.entry) * activePosition.size
        : (activePosition.entry - currentPrice) * activePosition.size;
    pnlStr = (currentPnL >= 0 ? '+$' : '-$') + Math.abs(currentPnL).toFixed(2);
    pnlCls = currentPnL >= 0 ? 'profit' : 'loss';
  }

  // Calculate RR Ratio
  let rrRatioStr = '—';
  if (slInput && tpInput && currentPrice) {
    const slVal = parseFloat(slInput);
    const tpVal = parseFloat(tpInput);
    const risk = Math.abs(currentPrice - slVal);
    const reward = Math.abs(tpVal - currentPrice);
    if (risk > 0 && reward > 0) {
      rrRatioStr = '1 : ' + (reward / risk).toFixed(2);
    }
  }

  const startRandom = () => {
    if (baseCandles.length < 50) return;
    const randIdx = Math.floor(Math.random() * (baseCandles.length - 40)) + 20;
    setStartIndex(randIdx);
    setCurrentIndex(randIdx);
    setIsPlaying(false);
    setShowAnchorMenu(false);
    showToast('🎲 Départ aléatoire blind test lancé !', 'info');
  };

  const startAtSession = (hour: number, name: string) => {
    if (baseCandles.length < 50) return;
    for (let i = baseCandles.length - 100; i >= 10; i--) {
      const d = new Date(baseCandles[i].time * 1000);
      if (d.getUTCHours() === hour) {
        setStartIndex(i);
        setCurrentIndex(i);
        setIsPlaying(false);
        setShowAnchorMenu(false);
        showToast(`🎯 Départ calé sur la session ${name}`, 'success');
        return;
      }
    }
    startRandom();
  };

  const promptDate = () => {
    if (!baseCandles.length) return;
    const minD = new Date(baseCandles[0].time * 1000).toISOString().slice(0, 10);
    const maxD = new Date(baseCandles[baseCandles.length - 1].time * 1000).toISOString().slice(0, 10);
    const userInput = prompt(`Date de départ (${minD} → ${maxD}) — format AAAA-MM-JJ :`, minD);
    if (!userInput) return;
    const target = new Date(userInput).getTime() / 1000;
    const idx = baseCandles.findIndex((c) => c.time >= target);
    if (idx !== -1) {
      setStartIndex(idx);
      setCurrentIndex(idx);
      setIsPlaying(false);
      setShowAnchorMenu(false);
      showToast(`🎯 Replay ancré au ${userInput}`, 'success');
    }
  };

  const handleBuy = () => {
    if (!currentPrice || !currentCandle) return;
    const entryParsed = entryInput ? parseFloat(entryInput.replace(',', '.')) : NaN;
    const entry = !isNaN(entryParsed) && entryParsed > 0 ? entryParsed : currentPrice;

    const slParsed = slInput ? parseFloat(slInput.replace(',', '.')) : NaN;
    const sl = !isNaN(slParsed) && slParsed > 0 ? slParsed : entry - 20 * pip;

    const tpParsed = tpInput ? parseFloat(tpInput.replace(',', '.')) : NaN;
    const tp = !isNaN(tpParsed) && tpParsed > 0 ? tpParsed : entry + 40 * pip;

    openTrade('LONG', entry, sl, tp, currentCandle.time);
    showToast(`🟢 Position ACHAT ouverte @ ${entry.toFixed(5)}`, 'success', 2500);
  };

  const handleSell = () => {
    if (!currentPrice || !currentCandle) return;
    const entryParsed = entryInput ? parseFloat(entryInput.replace(',', '.')) : NaN;
    const entry = !isNaN(entryParsed) && entryParsed > 0 ? entryParsed : currentPrice;

    const slParsed = slInput ? parseFloat(slInput.replace(',', '.')) : NaN;
    const sl = !isNaN(slParsed) && slParsed > 0 ? slParsed : entry + 20 * pip;

    const tpParsed = tpInput ? parseFloat(tpInput.replace(',', '.')) : NaN;
    const tp = !isNaN(tpParsed) && tpParsed > 0 ? tpParsed : entry - 40 * pip;

    openTrade('SHORT', entry, sl, tp, currentCandle.time);
    showToast(`🔴 Position VENTE ouverte @ ${entry.toFixed(5)}`, 'success', 2500);
  };

  return (
    <div id="replay-bar" style={{ display: 'flex' }}>
      {/* ── BLOCK 1: REPLAY TIMELINE & ANCHOR ── */}
      <div className="rp-left">
        <button
          id="rp-exit"
          title="Quitter le replay (Échap)"
          onClick={() => {
            setIsPlaying(false);
            setIsActive(false);
            setDisplayCandles(baseCandles);
          }}
        >
          ✕ Quitter
        </button>

        {/* Anchor strategy dropdown */}
        <div className="tv-dropdown" style={{ position: 'relative' }}>
          <button
            className="rp-strategy-btn"
            onClick={() => setShowAnchorMenu(!showAnchorMenu)}
            title="Point d'ancrage & Stratégie"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" />
            </svg>
            Ancrage ▾
          </button>
          {showAnchorMenu && (
            <div className="tv-dropdown-menu show" style={{ bottom: 'calc(100% + 8px)', top: 'auto', minWidth: '210px', display: 'block' }}>
              <div className="dropdown-section-label">Point de départ</div>
              <div className="tv-dropdown-item" onClick={startRandom}>🎲 Session Aléatoire (Blind Test)</div>
              <div className="tv-dropdown-item" onClick={() => startAtSession(8, 'Londres (08h UTC)')}>🇬🇧 Session Londres (08h UTC)</div>
              <div className="tv-dropdown-item" onClick={() => startAtSession(13, 'New York (13h UTC)')}>🇺🇸 Session New York (13h UTC)</div>
              <div className="tv-dropdown-item" onClick={() => startAtSession(0, 'Tokyo (00h UTC)')}>🇯🇵 Session Tokyo (00h UTC)</div>
              <div className="dropdown-divider" />
              <div className="tv-dropdown-item" onClick={promptDate}>📅 Saisir une date précise…</div>
            </div>
          )}
        </div>

        <div className="rp-controls">
          <button id="rp-step-back" title="Bougie précédente (←)" onClick={stepBackward}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="19 20 9 12 19 4 19 20" />
              <line x1="5" y1="19" x2="5" y2="5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <button id="rp-play" className={isPlaying ? 'playing' : ''} title="Lecture / Pause (Espace)" onClick={() => setIsPlaying(!isPlaying)}>
            {isPlaying ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            )}
          </button>
          <button id="rp-step-fwd" title="Bougie suivante (→)" onClick={stepForward}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 4 15 12 5 20 5 4" />
              <line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── BLOCK 2: SCRUBBER & SPEED (CENTER) ── */}
      <div className="rp-center">
        <div className="rp-scrubber-wrap">
          <span id="rp-time-cur" className="rp-time">{timeCurStr}</span>
          <input
            id="rp-scrubber"
            type="range"
            min={0}
            max={baseCandles.length - 1}
            value={currentIndex}
            onChange={(e) => setCurrentIndex(parseInt(e.target.value) || 0)}
          />
          <span id="rp-time-end" className="rp-time">{timeEndStr}</span>
        </div>

        <div className="rp-speed-group">
          {[
            { label: '¼×', ms: 1200 },
            { label: '½×', ms: 800 },
            { label: '1×', ms: 500 },
            { label: '2×', ms: 250 },
            { label: '4×', ms: 120 },
            { label: '8×', ms: 60 },
            { label: '32×', ms: 20 },
          ].map((s) => (
            <button
              key={s.label}
              className={`rp-speed-btn ${speedMs === s.ms ? 'active' : ''}`}
              onClick={() => setSpeedMs(s.ms)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── BLOCK 3: TRADING CONTROL & METRICS ── */}
      <div className="rp-trade-panel">
        <div className="rp-stat-group">
          <span className="rp-stat-label">Solde</span>
          <span id="rp-balance" className="rp-stat-val">
            ${balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>

        <div className="rp-stat-group">
          <span className="rp-stat-label">P&amp;L ouvert</span>
          <span id="rp-pnl" className={`rp-pnl-val ${pnlCls}`}>
            {pnlStr}
          </span>
        </div>

        <div id="rr-badge" title="Ratio Risque/Récompense">
          R:R <span id="rr-val">{rrRatioStr}</span>
        </div>

        <div className="rp-trade-inputs">
          <div className="rp-input-box">
            <span>RISK%</span>
            <input
              type="number"
              id="trade-risk-pct"
              value={riskPercent}
              step="0.5"
              min="0.1"
              max="100"
              onChange={(e) => setRiskPercent(parseFloat(e.target.value) || 1)}
            />
          </div>
          <div className="rp-input-box">
            <span>QTÉ</span>
            <input
              type="number"
              id="trade-qty"
              value={quantity}
              step="0.1"
              min="0.01"
              onChange={(e) => setQuantity(parseFloat(e.target.value) || 1)}
            />
          </div>
          <div className="rp-input-box">
            <span>PRIX</span>
            <input
              type="text"
              id="trade-entry"
              placeholder="Marché"
              value={entryInput}
              onChange={(e) => setEntryInput(e.target.value)}
            />
          </div>
          <div className="rp-input-box">
            <span>SL</span>
            <input
              type="text"
              id="trade-sl"
              placeholder="—"
              value={slInput}
              onChange={(e) => setSlInput(e.target.value)}
            />
          </div>
          <div className="rp-input-box">
            <span>TP</span>
            <input
              type="text"
              id="trade-tp"
              placeholder="—"
              value={tpInput}
              onChange={(e) => setTpInput(e.target.value)}
            />
          </div>
        </div>

        <div className="rp-actions">
          <button className="trade-btn buy" id="btn-buy" onClick={handleBuy}>
            ▲ BUY
          </button>
          <button className="trade-btn sell" id="btn-sell" onClick={handleSell}>
            ▼ SELL
          </button>
          <button
            className="trade-btn be"
            id="btn-be"
            onClick={() => setBreakeven(currentPrice)}
            title="Passer le Stop Loss à Breakeven (0 Risque)"
          >
            🛡️ BE
          </button>
          <button
            className="trade-btn scale"
            id="btn-scale-50"
            onClick={() => closePartial(50, currentPrice)}
            title="Clôturer 50% de la position"
          >
            ½
          </button>
          {activePosition && (
            <button
              className="trade-btn close"
              id="btn-close-pos"
              onClick={() => closePosition('MANUAL', currentPrice, currentCandle?.time)}
            >
              Fermer
            </button>
          )}
          <button
            className="trade-btn"
            id="btn-history"
            onClick={() => openModal('trade-history')}
            title="Journal de trades"
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-light)',
              color: 'var(--text-secondary)',
              minWidth: '34px',
              padding: 0,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};
