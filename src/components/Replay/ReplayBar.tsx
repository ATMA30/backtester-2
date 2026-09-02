import React, { useEffect, useState } from 'react';
import { useReplayStore } from '../../store/useReplayStore';
import { useMarketStore, aggregateCandles } from '../../store/useMarketStore';
import { useTradeStore } from '../../store/useTradeStore';
import { useUIStore } from '../../store/useUIStore';

const SPEEDS = [
  { label: '¼×', ms: 1200 },
  { label: '½×', ms: 800 },
  { label: '1×', ms: 500 },
  { label: '2×', ms: 250 },
  { label: '4×', ms: 120 },
  { label: '8×', ms: 60 },
  { label: '32×', ms: 20 },
];

const parsePriceInput = (input: string): number | null => {
  if (!input || !input.trim() || input.trim().toLowerCase() === 'marché' || input.trim().toLowerCase() === 'market' || input.trim() === '—') {
    return null;
  }
  const cleaned = input.trim().replace(',', '.');
  const num = parseFloat(cleaned);
  return isNaN(num) || num <= 0 ? null : num;
};

const parseSlPrice = (input: string, isLong: boolean, entry: number, pip: number): number | null => {
  if (!input || !input.trim() || input.trim() === '—') return null;
  const cleaned = input.trim().replace(',', '.');
  const num = parseFloat(cleaned);
  if (isNaN(num) || num <= 0) return null;

  // Explicit pips e.g. "25p" or "25pip"
  if (cleaned.toLowerCase().includes('p')) {
    const pipsVal = parseFloat(cleaned);
    return isLong ? entry - pipsVal * pip : entry + pipsVal * pip;
  }

  // If number is a price level near market (between 0.2*entry and 5*entry)
  if (num > entry * 0.2 && num < entry * 5) {
    return num;
  }

  // If number is small relative to entry (e.g. "20" on a 1.0850 pair), treat as pips
  return isLong ? entry - num * pip : entry + num * pip;
};

const parseTpPrice = (input: string, isLong: boolean, entry: number, pip: number): number | null => {
  if (!input || !input.trim() || input.trim() === '—') return null;
  const cleaned = input.trim().replace(',', '.');
  const num = parseFloat(cleaned);
  if (isNaN(num) || num <= 0) return null;

  // Explicit pips e.g. "50p"
  if (cleaned.toLowerCase().includes('p')) {
    const pipsVal = parseFloat(cleaned);
    return isLong ? entry + pipsVal * pip : entry - pipsVal * pip;
  }

  // If number is a price level near market
  if (num > entry * 0.2 && num < entry * 5) {
    return num;
  }

  // Treat as pips
  return isLong ? entry + num * pip : entry - num * pip;
};

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
    pendingOrders,
    riskPercent,
    quantity,
    setRiskPercent,
    setQuantity,
    openTrade,
    placePendingOrder,
    cancelPendingOrder,
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
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showOrdersMenu, setShowOrdersMenu] = useState(false);

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
        updatePrice(nextCandle);
      }
    }, speedMs);
    return () => clearInterval(interval);
  }, [isActive, isPlaying, currentIndex, speedMs, baseCandles, setCurrentIndex, setIsPlaying, updatePrice]);

  // ── SLICE SYNC WITH TIMEFRAME AGGREGATION & PRICE UPDATE ───
  useEffect(() => {
    if (!isActive || !baseCandles.length) return;
    const sliced = baseCandles.slice(0, currentIndex + 1);
    const aggregated = aggregateCandles(sliced, activeTF, baseTF);
    setDisplayCandles(aggregated);

    const currentC = baseCandles[currentIndex];
    if (currentC) {
      updatePrice(currentC);
    }
  }, [isActive, currentIndex, baseCandles, activeTF, baseTF, setDisplayCandles, updatePrice]);

  // ── AUTO-SYNC RISK% & QTY BASED ON SL DISTANCE ───────────
  const currentCandle = baseCandles[currentIndex];
  const lastCandle = baseCandles[baseCandles.length - 1];
  const currentPrice = currentCandle ? currentCandle.close : 0;

  // Calculate dynamic quantity preview based on risk% and user's SL
  useEffect(() => {
    if (!currentPrice) return;
    const targetEntry = parsePriceInput(entryInput) || currentPrice;
    const slVal = parseSlPrice(slInput, true, targetEntry, pip);
    if (slVal !== null && Math.abs(targetEntry - slVal) > 0) {
      const riskCash = (balance * (riskPercent / 100));
      const slDist = Math.abs(targetEntry - slVal);
      const calculatedLot = Math.max(0.01, parseFloat((riskCash / slDist).toFixed(2)));
      if (calculatedLot !== quantity) {
        setQuantity(calculatedLot);
      }
    }
  }, [riskPercent, slInput, entryInput, currentPrice, balance, pip]);

  if (!isActive) return null;

  const timeCurStr = currentCandle
    ? new Date(currentCandle.time * 1000).toLocaleString('fr-FR', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

  const currentSpeed = SPEEDS.find((s) => s.ms === speedMs) || SPEEDS[2];

  // Calculate live PnL & RR
  let currentPnL;
  let pnlStr = '—';
  let pnlCls = 'idle';
  if (activePosition && currentPrice) {
    currentPnL =
      activePosition.type === 'LONG'
        ? (currentPrice - activePosition.entry) * activePosition.size
        : (activePosition.entry - currentPrice) * activePosition.size;
    pnlStr = (currentPnL >= 0 ? '+$' : '-$') + Math.abs(currentPnL).toFixed(2);
    pnlCls = currentPnL >= 0 ? 'profit' : 'loss';
  }

  // Calculate RR Ratio preview if SL and TP are set
  let rrRatioStr = '—';
  const targetEntryVal = parsePriceInput(entryInput) || currentPrice;
  const parsedSl = parseSlPrice(slInput, true, targetEntryVal, pip);
  const parsedTp = parseTpPrice(tpInput, true, targetEntryVal, pip);
  if (parsedSl !== null && parsedTp !== null && targetEntryVal) {
    const risk = Math.abs(targetEntryVal - parsedSl);
    const reward = Math.abs(parsedTp - targetEntryVal);
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

    const targetEntry = parsePriceInput(entryInput);
    const isPending = targetEntry !== null && Math.abs(targetEntry - currentPrice) > pip * 0.5;
    const baseEntry = isPending ? targetEntry! : currentPrice;

    // Only set SL if user entered something in the SL input; otherwise null (no forced auto SL)
    const sl = parseSlPrice(slInput, true, baseEntry, pip);
    // Only set TP if user entered something in the TP input; otherwise null (no auto TP)
    const tp = parseTpPrice(tpInput, true, baseEntry, pip);

    if (isPending) {
      const orderType = targetEntry! < currentPrice ? 'LIMIT' : 'STOP';
      placePendingOrder('LONG', orderType, targetEntry!, sl, tp, currentCandle.time);
      showToast(`⏳ Ordre ACHAT ${orderType} placé @ ${targetEntry!.toFixed(5)} (en attente du prix)`, 'info', 3500);
    } else {
      openTrade('LONG', currentPrice, sl, tp, currentCandle.time);
      showToast(`🟢 Position ACHAT ouverte @ ${currentPrice.toFixed(5)}`, 'success', 2500);
    }
  };

  const handleSell = () => {
    if (!currentPrice || !currentCandle) return;

    const targetEntry = parsePriceInput(entryInput);
    const isPending = targetEntry !== null && Math.abs(targetEntry - currentPrice) > pip * 0.5;
    const baseEntry = isPending ? targetEntry! : currentPrice;

    // Only set SL if user entered something in the SL input; otherwise null (no forced auto SL)
    const sl = parseSlPrice(slInput, false, baseEntry, pip);
    // Only set TP if user entered something in the TP input; otherwise null (no auto TP)
    const tp = parseTpPrice(tpInput, false, baseEntry, pip);

    if (isPending) {
      const orderType = targetEntry! > currentPrice ? 'LIMIT' : 'STOP';
      placePendingOrder('SHORT', orderType, targetEntry!, sl, tp, currentCandle.time);
      showToast(`⏳ Ordre VENTE ${orderType} placé @ ${targetEntry!.toFixed(5)} (en attente du prix)`, 'info', 3500);
    } else {
      openTrade('SHORT', currentPrice, sl, tp, currentCandle.time);
      showToast(`🔴 Position VENTE ouverte @ ${currentPrice.toFixed(5)}`, 'success', 2500);
    }
  };

  return (
    <div id="replay-bar" style={{ display: 'flex' }}>
      {/* ── BLOCK 1: REPLAY TIMELINE & ANCHOR (ALLÉGÉ) ── */}
      <div className="rp-left">
        {/* 1. Bouton Quitter discret */}
        <button
          id="rp-exit"
          className="rp-exit-btn"
          title="Quitter le replay (Échap)"
          onClick={() => {
            setIsPlaying(false);
            setIsActive(false);
            setDisplayCandles(baseCandles);
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
          <span>Quitter</span>
        </button>

        {/* Anchor strategy dropdown */}
        <div className="tv-dropdown" style={{ position: 'relative' }}>
          <button
            className="rp-strategy-btn"
            onClick={() => setShowAnchorMenu(!showAnchorMenu)}
            title="Point d'ancrage & Stratégie"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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

        {/* Step controls */}
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

        {/* 1. Date compacte précise (Intraday) */}
        <div className="rp-date-badge" title="Horodatage bougie active">
          {timeCurStr}
        </div>

        {/* 1. Sélecteur de vitesse compact (Dropdown 1× ▾) */}
        <div className="tv-dropdown rp-speed-dropdown" style={{ position: 'relative' }}>
          <button
            className="rp-speed-btn-compact"
            onClick={() => setShowSpeedMenu(!showSpeedMenu)}
            title="Vitesse de défilement du Replay"
          >
            <span>{currentSpeed.label}</span>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {showSpeedMenu && (
            <div className="tv-dropdown-menu show" style={{ bottom: 'calc(100% + 8px)', top: 'auto', minWidth: '95px', display: 'block' }}>
              <div className="dropdown-section-label">Vitesse</div>
              {SPEEDS.map((s) => (
                <div
                  key={s.label}
                  className={`tv-dropdown-item ${speedMs === s.ms ? 'active' : ''}`}
                  onClick={() => {
                    setSpeedMs(s.ms);
                    setShowSpeedMenu(false);
                  }}
                  style={{ justifyContent: 'space-between' }}
                >
                  <span>{s.label}</span>
                  {s.label === '1×' && <span style={{ fontSize: '9px', color: '#64748B' }}>Défaut</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="replay-bar-separator" />

      {/* ── BLOCK 2: INDICATEURS DE COMPTE & STATS (AU CENTRE) ── */}
      <div className="rp-metrics-group">
        <div className="rp-stat-group">
          <span className="rp-stat-label">SOLDE</span>
          <span id="rp-balance" className="rp-stat-val">
            ${balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>

        {/* 2. P&L Ouvert passif sans faux cadre de saisie */}
        <div className="rp-stat-group">
          <span className="rp-stat-label">P&amp;L OUVERT</span>
          <span id="rp-pnl" className={`rp-pnl-passive ${pnlCls}`}>
            {pnlStr}
          </span>
        </div>

        {rrRatioStr !== '—' && (
          <div id="rr-badge" title="Ratio Risque / Récompense calculé">
            R:R <span id="rr-val">{rrRatioStr}</span>
          </div>
        )}

        {/* Compact Pending Orders Dropdown */}
        {pendingOrders && pendingOrders.length > 0 && (
          <div className="tv-dropdown rp-orders-dropdown" style={{ position: 'relative' }}>
            <button
              className="rp-pending-orders-btn"
              onClick={() => setShowOrdersMenu(!showOrdersMenu)}
              title="Gérer les ordres en attente"
            >
              <span>⏳ {pendingOrders.length} en attente</span>
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {showOrdersMenu && (
              <div
                className="tv-dropdown-menu show"
                style={{
                  bottom: 'calc(100% + 8px)',
                  top: 'auto',
                  minWidth: '230px',
                  display: 'block',
                  padding: '6px',
                  background: 'rgba(15, 23, 42, 0.95)',
                  backdropFilter: 'blur(20px)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  borderRadius: '8px',
                  boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', padding: '2px 4px' }}>
                  <span style={{ fontSize: '10px', fontWeight: 700, color: '#94A3B8', letterSpacing: '0.04em' }}>ORDRES EN ATTENTE</span>
                  {pendingOrders.length > 1 && (
                    <button
                      onClick={() => {
                        pendingOrders.forEach((o) => cancelPendingOrder(o.id));
                        setShowOrdersMenu(false);
                      }}
                      style={{
                        background: 'rgba(244, 63, 94, 0.15)',
                        border: '1px solid rgba(244, 63, 94, 0.3)',
                        color: '#FB7185',
                        fontSize: '9.5px',
                        padding: '2px 6px',
                        borderRadius: '3px',
                        cursor: 'pointer',
                        fontWeight: 600,
                      }}
                    >
                      Tout annuler
                    </button>
                  )}
                </div>
                {pendingOrders.map((o) => (
                  <div
                    key={o.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '5px 8px',
                      borderRadius: '4px',
                      background: 'rgba(255, 255, 255, 0.04)',
                      marginBottom: '4px',
                      border: '1px solid rgba(255, 255, 255, 0.06)',
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: o.type === 'LONG' ? '#34D399' : '#FB7185' }}>
                        {o.type === 'LONG' ? 'ACHAT' : 'VENTE'} {o.orderType} @ {o.targetPrice.toFixed(o.targetPrice < 10 ? 5 : 2)}
                      </span>
                      <span style={{ fontSize: '9px', color: '#64748B', fontFamily: 'var(--mono)' }}>
                        {o.sl ? `SL: ${o.sl.toFixed(o.sl < 10 ? 5 : 2)} ` : ''}
                        {o.tp ? `TP: ${o.tp.toFixed(o.tp < 10 ? 5 : 2)} ` : ''}
                        {`(${o.size} lots)`}
                      </span>
                    </div>
                    <button
                      onClick={() => cancelPendingOrder(o.id)}
                      title="Annuler cet ordre"
                      style={{
                        background: 'rgba(244, 63, 94, 0.12)',
                        border: '1px solid rgba(244, 63, 94, 0.25)',
                        color: '#FB7185',
                        width: '22px',
                        height: '22px',
                        borderRadius: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        fontSize: '11px',
                        fontWeight: 800,
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="replay-bar-separator" />

      {/* ── BLOCK 3: SAISIE D'ORDRES STRUCTURÉE ── */}
      <div className="rp-order-grid">
        {/* Sous-groupe 1 : Risque & Quantité synchronisés */}
        <div className="rp-input-subgroup">
          <div className="rp-input-box">
            <span className="rp-input-label" title="Pourcentage du capital risqué par trade">RISK%</span>
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

          <div className="rp-sync-icon" title="Synchronisé : Si vous entrez un SL, la quantité est calculée automatiquement selon votre Risque%">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          </div>

          <div className="rp-input-box">
            <span className="rp-input-label" title="Taille du lot (ajustée par SL ou saisie manuelle)">QTÉ</span>
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
            <span className="rp-input-label" title="Vide = Marché direct. Saisir un prix différent créera un ordre Limite ou Stop en attente.">PRIX</span>
            <input
              type="text"
              id="trade-entry"
              placeholder="Marché"
              value={entryInput}
              onChange={(e) => setEntryInput(e.target.value)}
            />
          </div>
        </div>

        {/* Sous-groupe 2 : Gestion du Risque (SL & TP distincts et optionnels) */}
        <div className="rp-input-subgroup rp-sl-tp-subgroup">
          <div className="rp-input-box">
            <span className="rp-input-label sl" title="Stop Loss optionnel (prix absolu ou pips). Vide = Pas de SL.">SL (PRIX/PIPS)</span>
            <input
              type="text"
              id="trade-sl"
              placeholder="Optionnel"
              value={slInput}
              onChange={(e) => setSlInput(e.target.value)}
            />
          </div>
          <div className="rp-input-box">
            <span className="rp-input-label tp" title="Take Profit optionnel (prix absolu ou pips). Vide = Pas de TP.">TP (OBJECTIF)</span>
            <input
              type="text"
              id="trade-tp"
              placeholder="Optionnel"
              value={tpInput}
              onChange={(e) => setTpInput(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* ── BLOCK 4: ACTIONS D'EXÉCUTION & GESTION (À DROITE) ── */}
      <div className="rp-actions">
        {/* 4. Boutons BUY / SELL épurés et alignés en hauteur */}
        <button className="trade-btn buy" id="btn-buy" onClick={handleBuy} title="Acheter au marché ou placer un ordre d'achat limite/stop">
          BUY
        </button>
        <button className="trade-btn sell" id="btn-sell" onClick={handleSell} title="Vendre au marché ou placer un ordre de vente limite/stop">
          SELL
        </button>

        {/* 4. BE et 1/2 inactifs si aucun trade en cours */}
        <button
          className={`trade-btn be ${!activePosition ? 'disabled' : ''}`}
          id="btn-be"
          onClick={() => setBreakeven(currentPrice)}
          disabled={!activePosition}
          title={activePosition ? "Passer le Stop Loss à Breakeven (0 Risque)" : "Aucune position ouverte"}
        >
          BE
        </button>
        <button
          className={`trade-btn scale ${!activePosition ? 'disabled' : ''}`}
          id="btn-scale-50"
          onClick={() => closePartial(50, currentPrice)}
          disabled={!activePosition}
          title={activePosition ? "Clôturer 50% de la position" : "Aucune position ouverte"}
        >
          ½
        </button>

        {activePosition && (
          <button
            className="trade-btn close"
            id="btn-close-pos"
            onClick={() => closePosition('MANUAL', currentPrice, currentCandle?.time)}
            title="Fermer la position totale"
          >
            Fermer
          </button>
        )}

        {/* 4. Bouton Journal explicite */}
        <button
          className="trade-btn journal-btn"
          id="btn-history"
          onClick={() => openModal('trade-history')}
          title="Journal des trades & Historique des ordres"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          </svg>
        </button>
      </div>
    </div>
  );
};

