import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  Target,
  ChevronDown,
  Shuffle,
  Clock,
  Calendar,
  SkipBack,
  Play,
  Pause,
  SkipForward,
  Gauge,
  Hourglass,
  Link2,
  ArrowUp,
  ArrowDown,
  ShieldCheck,
  PieChart,
  XCircle,
  BookOpen,
  Trash2,
} from 'lucide-react';
import { useReplayStore } from '../../store/useReplayStore';
import { useMarketStore } from '../../store/useMarketStore';
import { useTradeStore } from '../../store/useTradeStore';
import { useUIStore } from '../../store/useUIStore';
import { PositionType } from '../../types/trading';
import { aggregateCandles, indexAtOrAfter } from '../../domain/candles';
import { archiveLimitFor } from '../../domain/archive-limits';
import { formatMoney, formatPrice, getInstrument, unitsToLots } from '../../domain/instruments';
import { REJECTION_MESSAGES, effectiveRiskPercent, netPnlAtMarket, riskBasedLots } from '../../domain/position-sizing';
import { resolveCosts, roundTripCostPerUnit } from '../../domain/trading-costs';
import { CostsMenu } from './CostsMenu';
import { blockRelocationWhileTrading, blockTradingInThePast } from './replayGuards';

const SPEEDS = [
  { label: '¼×', ms: 1200 },
  { label: '½×', ms: 800 },
  { label: '1×', ms: 500 },
  { label: '2×', ms: 250 },
  { label: '4×', ms: 120 },
  { label: '8×', ms: 60 },
  { label: '32×', ms: 20 },
];

/**
 * Result of interpreting a price field.
 *
 * The previous implementation guessed between "absolute price" and "pips" with
 * a magnitude heuristic (`num > entry * 0.2 && num < entry * 5` meant price).
 * On EUR/USD that band is [0.217, 5.425], so a trader typing `5` for "5 pips"
 * silently got a stop at the absolute price 5.00 — a level the market never
 * reaches, i.e. a position with no protection at all while the UI claimed one.
 *
 * Interpretation is now explicit: a `p` / `pip` / `pips` suffix means an offset
 * in pips, a `%` suffix means a percentage of entry, anything else is an
 * absolute price. Nothing is inferred from magnitude, and unusable input
 * surfaces an error instead of a silent, wrong order.
 */
type PriceField =
  | { readonly kind: 'empty' }
  | { readonly kind: 'value'; readonly price: number }
  | { readonly kind: 'error'; readonly message: string };

const EMPTY_FIELD: PriceField = { kind: 'empty' };

const BLANK_TOKENS = new Set(['', '—', '-', 'marché', 'marche', 'market']);

/** Strip formatting and detect the unit suffix. */
function readNumericInput(raw: string): { value: number; unit: 'price' | 'pips' | 'percent' } | null {
  const cleaned = raw.trim().toLowerCase().replace(/\s+/g, '').replace(',', '.');
  if (!cleaned) return null;

  const pipMatch = cleaned.match(/^([+-]?\d*\.?\d+)(?:p|pip|pips)$/);
  if (pipMatch) {
    const value = Number(pipMatch[1]);
    return Number.isFinite(value) ? { value, unit: 'pips' } : null;
  }

  const pctMatch = cleaned.match(/^([+-]?\d*\.?\d+)%$/);
  if (pctMatch) {
    const value = Number(pctMatch[1]);
    return Number.isFinite(value) ? { value, unit: 'percent' } : null;
  }

  // Strict: `Number` rejects trailing garbage that `parseFloat` would swallow
  // (`parseFloat('1.2abc')` === 1.2), which previously produced silent misreads.
  const value = Number(cleaned);
  return Number.isFinite(value) ? { value, unit: 'price' } : null;
}

/** Parse the entry field: blank means "at market". */
const parseEntryInput = (input: string): PriceField => {
  if (BLANK_TOKENS.has(input.trim().toLowerCase())) return EMPTY_FIELD;
  const parsed = readNumericInput(input);
  if (!parsed) return { kind: 'error', message: 'Prix d’entrée illisible.' };
  if (parsed.unit !== 'price') {
    return { kind: 'error', message: 'Le prix d’entrée doit être un prix absolu.' };
  }
  if (parsed.value <= 0) return { kind: 'error', message: 'Le prix d’entrée doit être positif.' };
  return { kind: 'value', price: parsed.value };
};

/**
 * Parse a stop-loss or take-profit field.
 * A pips/percent offset is applied in the protective direction for the side,
 * so `30p` is always 30 pips *away* from entry on the correct side.
 */
function parseProtectionInput(
  input: string,
  target: 'sl' | 'tp',
  isLong: boolean,
  entry: number,
  pip: number
): PriceField {
  if (BLANK_TOKENS.has(input.trim().toLowerCase())) return EMPTY_FIELD;

  const parsed = readNumericInput(input);
  if (!parsed) {
    return { kind: 'error', message: `${target.toUpperCase()} illisible : saisissez un prix, « 30p » ou « 1.5% ».` };
  }
  if (!Number.isFinite(entry) || entry <= 0) {
    return { kind: 'error', message: 'Prix d’entrée indisponible pour calculer un décalage.' };
  }

  if (parsed.unit === 'price') {
    if (parsed.value <= 0) {
      return { kind: 'error', message: `${target.toUpperCase()} invalide : le prix doit être positif.` };
    }
    return { kind: 'value', price: parsed.value };
  }

  const distance =
    parsed.unit === 'pips' ? Math.abs(parsed.value) * pip : (Math.abs(parsed.value) / 100) * entry;
  if (distance <= 0) {
    return { kind: 'error', message: `${target.toUpperCase()} invalide : le décalage doit être non nul.` };
  }

  // A stop sits below entry for a long and above for a short; a target is the mirror.
  const below = target === 'sl' ? isLong : !isLong;
  return { kind: 'value', price: below ? entry - distance : entry + distance };
}

/** Price when the field holds one, otherwise null (blank or invalid). */
function priceOf(field: PriceField): number | null {
  return field.kind === 'value' ? field.price : null;
}

/**
 * Read a numeric input, keeping the previous value while the field is being
 * retyped.
 *
 * `parseFloat(v) || 1` collapsed two different situations onto the literal 1:
 * an emptied field (mid-edit) and a genuine `0`. Clearing the volume box to
 * type `0.5` therefore committed 1 lot for one keystroke, and `0` was
 * unreachable — the documented `||`-erases-zeros trap.
 */
function readPositiveNumber(raw: string, fallback: number): number {
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * How deep the current granularity actually reaches, phrased for a prompt.
 *
 * These sentences used to be written by hand, and had drifted from
 * `domain/archive-limits`: the dialog claimed 7 days at 1 minute where the rule
 * says 30, and offered "1H (2 ans)" where the table says 5 years. One rule, one
 * source.
 */
function archiveNotice(timeframeSeconds: number): { suffix: string; hint: string } {
  const limit = archiveLimitFor(timeframeSeconds);
  if (!limit) return { suffix: '', hint: '' };
  return {
    suffix: ` (${limit.label} : archive ${limit.maxAgeDays} jours max)`,
    hint: limit.fallbackHint,
  };
}

export const ReplayBar: React.FC = () => {
  const {
    isActive,
    isPlaying,
    currentIndex,
    speedMs,
    setIsPlaying,
    setIsActive,
    setCurrentIndex,
    setStartIndex,
    setSpeedMs,
    stepForward,
    stepBackward,
  } = useReplayStore();

  const { baseCandles, setDisplayCandles, currentSymbol, activeTF, baseTF, triggerFitContent } = useMarketStore();
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
    closeAtMarket,
    closePartial,
    setBreakeven,
    updatePrice,
    costs,
  } = useTradeStore();

  const { openModal, showToast, activeDropdown, toggleDropdown, closeAllDropdowns } = useUIStore();

  const [entryInput, setEntryInput] = useState('');
  const [slInput, setSlInput] = useState('');
  const [tpInput, setTpInput] = useState('');
  const [dateDraft, setDateDraft] = useState('');
  /**
   * Les trois menus de la barre passent par le registre partagé du store.
   *
   * C'étaient trois `useState` indépendants : rien ne les fermait l'un l'autre
   * — on pouvait avoir « Point de départ » et « Vitesse » ouverts en même temps
   * — et le gestionnaire de clic extérieur de `App` ne connaît que
   * `activeDropdown`, donc aucun ne se fermait en cliquant ailleurs. Il fallait
   * recliquer le bouton exact. Le registre donne l'exclusion mutuelle et la
   * fermeture au clic extérieur, gratuitement.
   */
  const showAnchorMenu = activeDropdown === 'rp-anchor';
  const showSpeedMenu = activeDropdown === 'rp-speed';
  const barRef = useRef<HTMLDivElement>(null);
  const showOrdersMenu = activeDropdown === 'rp-orders';
  /** Un menu ouvert doit pouvoir déborder de la barre — voir `has-open-menu`. */
  const isMenuOpen = showAnchorMenu || showSpeedMenu || showOrdersMenu;

  const instrument = getInstrument(currentSymbol, baseCandles[currentIndex]?.close);
  const pip = instrument.pip;

  // ── REPLAY LOOP ───────────────────────────────────────────
  // The interval reads the index from the store instead of closing over it, so
  // it is created once per play session. Depending on `currentIndex` previously
  // tore the timer down and rebuilt it on every tick, which made the effective
  // playback speed drift away from the selected one.
  useEffect(() => {
    if (!isActive || !isPlaying) return;

    const interval = setInterval(() => {
      const { currentIndex: index } = useReplayStore.getState();
      const { baseCandles: candles } = useMarketStore.getState();

      if (index >= candles.length - 1) {
        setIsPlaying(false);
        showToast('Fin de l’historique atteinte.', 'info', 4000);
        return;
      }
      setCurrentIndex(index + 1);
    }, speedMs);

    return () => clearInterval(interval);
  }, [isActive, isPlaying, speedMs, setCurrentIndex, setIsPlaying, showToast]);

  // ── SLICE SYNC WITH TIMEFRAME AGGREGATION & PRICE UPDATE ───
  // Keep the visible slice, and the trading engine, in step with the cursor.
  //
  // This is the single place that feeds candles to `updatePrice`. The playback
  // loop used to call it too, so every replay candle was processed twice: stops
  // and targets were idempotent, but pending orders were evaluated a second time
  // against the same candle and could fill right after a close that the first
  // pass had correctly blocked.
  /** Last cursor position fed to the engine, and the series it indexed. */
  const lastFedRef = useRef<{ index: number; candles: readonly unknown[] } | null>(null);

  useEffect(() => {
    if (!isActive || !baseCandles.length) {
      lastFedRef.current = null;
      return;
    }

    const safeIdx = Math.min(Math.max(currentIndex, 0), baseCandles.length - 1);
    if (safeIdx !== currentIndex) {
      setCurrentIndex(safeIdx);
      return;
    }

    // The slice, never `baseCandles`: the previous fallback published the whole
    // series — every future candle included — the moment aggregation returned
    // nothing, which is the one thing a replay must never show.
    const slice = baseCandles.slice(0, safeIdx + 1);
    const aggregated = aggregateCandles(slice, activeTF, baseTF);
    setDisplayCandles(aggregated.length > 0 ? aggregated : slice);

    // Feed every candle crossed since the last update, not only the landing
    // one. A jump of N candles with a position open used to test the stop on
    // the destination alone: a stop blown through in between went unseen. Going
    // backwards feeds nothing new — the engine ignores candles it already saw.
    const last = lastFedRef.current;
    const from = last && last.candles === baseCandles && last.index < safeIdx ? last.index + 1 : safeIdx;
    for (let i = from; i <= safeIdx; i++) updatePrice(baseCandles[i]);
    lastFedRef.current = { index: safeIdx, candles: baseCandles };
  }, [isActive, currentIndex, baseCandles, activeTF, baseTF, setDisplayCandles, updatePrice, setCurrentIndex]);

  // ── AUTO-SYNC RISK% & QTY BASED ON SL DISTANCE ───────────
  const currentCandle = baseCandles[currentIndex];
  const currentPrice = currentCandle ? currentCandle.close : 0;

  // Keep the QTY field in sync with risk% and the stop distance.
  //
  // The order handlers now pass this quantity explicitly, so what the field shows
  // is exactly what gets traded. Previously the field was computed here with one
  // formula (a `pipValuePerLot` table whose gold branch was dead code, because
  // XAUUSD matched the `length === 6` forex test first) while `openTrade` silently
  // recomputed its own size from the stop and ignored the field entirely.
  useEffect(() => {
    if (!currentPrice) return;

    const entry = priceOf(parseEntryInput(entryInput)) ?? currentPrice;
    const sl = priceOf(parseProtectionInput(slInput, 'sl', true, entry, pip));
    if (sl === null) return;

    const costPerUnit = roundTripCostPerUnit(currentSymbol, entry, resolveCosts(currentSymbol, entry, costs));
    const lots = riskBasedLots(currentSymbol, balance, riskPercent, entry, sl, costPerUnit);
    if (lots !== null && lots !== quantity) setQuantity(lots);
  }, [riskPercent, slInput, entryInput, currentPrice, balance, pip, currentSymbol, quantity, setQuantity, costs]);

  /**
   * Mark the document while replay is on.
   *
   * `body.replay-active` was referenced by the stylesheet but set by nobody —
   * the rule that clears the chart of the trading bar had never once matched.
   * Same failure mode as an undeclared custom property: no error, no warning,
   * just a rule that silently does nothing.
   */
  useEffect(() => {
    if (!isActive) return;
    document.body.classList.add('replay-active');
    return () => document.body.classList.remove('replay-active');
  }, [isActive]);

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
    // Net : sortie du bon côté du spread, commissions déduites — ce que la
    // clôture créditerait vraiment.
    const symbol = activePosition.symbol ?? currentSymbol;
    currentPnL = netPnlAtMarket(activePosition, symbol, currentPrice, resolveCosts(symbol, currentPrice, costs));
    pnlStr = formatMoney(currentPnL, { signed: true });
    pnlCls = currentPnL >= 0 ? 'profit' : 'loss';
  }

  // Calculate RR Ratio preview if SL and TP are set
  let rrRatioStr = '—';
  /** Récompense / risque, en valeur — pour colorer le badge, pas juste l'écrire. */
  let rrRatio: number | null = null;
  const targetEntryVal = priceOf(parseEntryInput(entryInput)) ?? currentPrice;
  const parsedSl = priceOf(parseProtectionInput(slInput, 'sl', true, targetEntryVal, pip));
  const parsedTp = priceOf(parseProtectionInput(tpInput, 'tp', true, targetEntryVal, pip));
  if (parsedSl !== null && parsedTp !== null && targetEntryVal) {
    const risk = Math.abs(targetEntryVal - parsedSl);
    const reward = Math.abs(parsedTp - targetEntryVal);
    if (risk > 0 && reward > 0) {
      rrRatio = reward / risk;
      rrRatioStr = '1 : ' + rrRatio.toFixed(2);
    }
  }

  // Ce que l'ordre risque vraiment, une fois le volume arrondi au pas de lot.
  // Le dimensionnement arrondit au lot minimum : sur un petit compte ou un stop
  // serré, le risque réel dépassait celui demandé sans que rien ne le dise.
  const riskEntry = priceOf(parseEntryInput(entryInput)) ?? currentPrice;
  const riskStop = priceOf(parseProtectionInput(slInput, 'sl', true, riskEntry, pip));
  const realRisk =
    riskStop !== null && riskEntry > 0
      ? effectiveRiskPercent(
          currentSymbol,
          balance,
          riskEntry,
          riskStop,
          quantity,
          roundTripCostPerUnit(currentSymbol, riskEntry, resolveCosts(currentSymbol, riskEntry, costs))
        )
      : null;
  const riskOverrun = realRisk !== null && realRisk > riskPercent * 1.15;

  const dataBounds = {
    min: baseCandles.length ? new Date(baseCandles[0].time * 1000).toISOString().slice(0, 10) : undefined,
    max: baseCandles.length
      ? new Date(baseCandles[baseCandles.length - 1].time * 1000).toISOString().slice(0, 10)
      : undefined,
  };

  const startRandom = () => {
    if (baseCandles.length < 50) return;
    if (blockRelocationWhileTrading('Changer de point de départ')) return;
    const randIdx = Math.floor(Math.random() * (baseCandles.length - 40)) + 20;
    setStartIndex(randIdx);
    setCurrentIndex(randIdx);
    setIsPlaying(false);
    closeAllDropdowns();
    showToast('Départ tiré au hasard.', 'info');
  };

  const startAtSession = (hour: number, name: string) => {
    if (baseCandles.length < 50) return;
    if (blockRelocationWhileTrading('Changer de point de départ')) return;
    for (let i = baseCandles.length - 100; i >= 10; i--) {
      const d = new Date(baseCandles[i].time * 1000);
      if (d.getUTCHours() === hour) {
        setStartIndex(i);
        setCurrentIndex(i);
        setIsPlaying(false);
        closeAllDropdowns();
        showToast(`Départ calé sur ${name}`, 'success');
        return;
      }
    }
    startRandom();
  };

  /**
   * Start the replay at a typed date.
   *
   * A native `prompt()` used to ask for « AAAA-MM-JJ » in a blocking,
   * unstyled box with no calendar and no bounds; the menu now holds a
   * `<input type="date">` limited to the loaded range.
   */
  const goToDate = (userInput: string) => {
    if (!baseCandles.length || !userInput) return;
    if (blockRelocationWhileTrading('Changer de point de départ')) return;
    const minD = new Date(baseCandles[0].time * 1000).toISOString().slice(0, 10);
    const { hint: tfHint } = archiveNotice(activeTF);

    // `new Date('oops').getTime()` is NaN, and every comparison against NaN is
    // false — the old code therefore fell through every guard and silently did
    // nothing, leaving the user with no feedback at all.
    const parsedMs = Date.parse(`${userInput.trim()}T00:00:00Z`);
    if (Number.isNaN(parsedMs)) {
      showToast(`Date illisible : « ${userInput} ». Format attendu AAAA-MM-JJ.`, 'error', 4000);
      return;
    }
    const target = parsedMs / 1000;

    if (target < baseCandles[0].time) {
      showToast(
        `⚠️ Les données chargées ne remontent pas avant le ${minD}. ${tfHint}`.trim(),
        'warning',
        6000
      );
      return;
    }

    // `baseCandles` is sorted, so a binary search replaces the linear scan.
    const idx = indexAtOrAfter(baseCandles, target);
    if (idx === -1) {
      showToast(`Aucune bougie au-delà du ${userInput} dans ce jeu de données.`, 'warning', 4000);
      return;
    }

    // Clamp into range: `Math.max(20, idx)` alone could exceed the series on a
    // dataset shorter than 20 candles.
    const safeIdx = Math.min(Math.max(20, idx), baseCandles.length - 1);
    setStartIndex(safeIdx);
    setCurrentIndex(safeIdx);
    setIsPlaying(false);
    closeAllDropdowns();
    showToast(`Replay démarré au ${userInput}`, 'success');
  };

  /**
   * Submit an order for one side.
   *
   * BUY and SELL were two near-identical 20-line blocks that had already drifted
   * (the RR preview used the long-side parser for both). They now share this path,
   * which also surfaces rejections: the store validates the order and returns a
   * reason, instead of the previous silent no-op behind an error beep.
   */
  const submitOrder = (side: PositionType) => {
    if (!currentPrice || !currentCandle) return;
    if (blockTradingInThePast()) return;
    const isLong = side === 'LONG';

    const entryField = parseEntryInput(entryInput);
    if (entryField.kind === 'error') {
      showToast(entryField.message, 'error', 4000);
      return;
    }

    const targetEntry = priceOf(entryField);
    // A price within half a pip of the market is a market order, not a pending one.
    const isPending = targetEntry !== null && Math.abs(targetEntry - currentPrice) > pip * 0.5;
    const entry = isPending && targetEntry !== null ? targetEntry : currentPrice;

    const slField = parseProtectionInput(slInput, 'sl', isLong, entry, pip);
    if (slField.kind === 'error') {
      showToast(slField.message, 'error', 4000);
      return;
    }
    const tpField = parseProtectionInput(tpInput, 'tp', isLong, entry, pip);
    if (tpField.kind === 'error') {
      showToast(tpField.message, 'error', 4000);
      return;
    }

    const common = {
      symbol: currentSymbol,
      type: side,
      sl: priceOf(slField),
      tp: priceOf(tpField),
      time: currentCandle.time,
      // Explicit: the QTY field is what gets traded.
      lots: quantity,
    };

    const label = isLong ? 'Achat' : 'Vente';

    if (isPending && targetEntry !== null) {
      const orderType = (isLong ? targetEntry < currentPrice : targetEntry > currentPrice)
        ? 'LIMIT'
        : 'STOP';
      const outcome = placePendingOrder({ ...common, entry: targetEntry, targetPrice: targetEntry, orderType });
      if (!outcome.ok) {
        showToast(REJECTION_MESSAGES[outcome.reason], 'error', 5000);
        return;
      }
      showToast(`Ordre ${label.toLowerCase()} ${orderType === 'LIMIT' ? 'limite' : 'stop'} placé à ${formatPrice(currentSymbol, targetEntry)}`, 'info', 3500);
      return;
    }

    const outcome = openTrade({ ...common, entry: currentPrice });
    if (!outcome.ok) {
      showToast(REJECTION_MESSAGES[outcome.reason], 'error', 5000);
      return;
    }
    showToast(`Position ${label.toLowerCase()} ouverte à ${formatPrice(currentSymbol, currentPrice)}`, 'success', 2500);
  };

  const handleBuy = () => submitOrder('LONG');
  const handleSell = () => submitOrder('SHORT');


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
      className={`${isMenuOpen ? 'has-open-menu' : ''} u-display-flex`}
    >
      {/* ── BLOCK 1: REPLAY TIMELINE & ANCHOR (ALLÉGÉ) ── */}
      <div className="rp-left">
        {/* 1. Bouton Quitter discret */}
        <button
          id="rp-exit"
          className="rp-exit-btn u-display-flex u-align-items-center u-gap-4px"
          title="Quitter le replay · Échap"
          onClick={() => {
            if (blockRelocationWhileTrading('Quitter le replay')) return;
            setIsPlaying(false);
            setIsActive(false);
            setDisplayCandles(baseCandles);
            triggerFitContent();
          }}
        >
          <X size={12} strokeWidth={2.4} />
          <span>Quitter</span>
        </button>

        {/* Anchor strategy dropdown */}
        <div className="tv-dropdown u-position-relative">
          <button
            className="rp-strategy-btn u-display-flex u-align-items-center u-gap-5px"
            onClick={() => toggleDropdown('rp-anchor')}
            title="Choisir le point de départ"
          >
            <Target size={13} strokeWidth={2} className="u-color-38bdf8" />
            <span>Point de départ</span>
            <ChevronDown size={10} strokeWidth={2.2} />
          </button>
          {showAnchorMenu && (
            <div className="tv-dropdown-menu show u-bottom-calc-100pct-8px u-top-auto u-min-width-220px u-display-block">
              <div className="dropdown-section-label">Point de départ</div>
              <div className="tv-dropdown-item u-display-flex u-align-items-center u-gap-8px" onClick={startRandom}>
                <Shuffle size={13} strokeWidth={2} className="u-color-a78bfa" />
                <span>Date au hasard — test à l’aveugle</span>
              </div>
              <div className="tv-dropdown-item u-display-flex u-align-items-center u-gap-8px" onClick={() => startAtSession(8, 'Londres (08h UTC)')}>
                <Clock size={13} strokeWidth={2} className="u-color-60a5fa" />
                <span>Ouverture de Londres · 08:00 UTC</span>
              </div>
              <div className="tv-dropdown-item u-display-flex u-align-items-center u-gap-8px" onClick={() => startAtSession(13, 'New York (13h UTC)')}>
                <Clock size={13} strokeWidth={2} className="u-color-34d399" />
                <span>Ouverture de New York · 13:00 UTC</span>
              </div>
              <div className="tv-dropdown-item u-display-flex u-align-items-center u-gap-8px" onClick={() => startAtSession(0, 'Tokyo (00h UTC)')}>
                <Clock size={13} strokeWidth={2} className="u-color-fb923c" />
                <span>Ouverture de Tokyo · 00:00 UTC</span>
              </div>
              <div className="dropdown-divider" />
              <form
                className="rp-date-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  goToDate(dateDraft);
                }}
              >
                <Calendar size={13} strokeWidth={2} className="u-color-fcd34d" aria-hidden />
                <input
                  type="date"
                  aria-label={`Date de départ${archiveNotice(activeTF).suffix}`}
                  min={dataBounds.min}
                  max={dataBounds.max}
                  value={dateDraft}
                  onChange={(e) => setDateDraft(e.target.value)}
                />
                <button type="submit" className="btn-sm" disabled={!dateDraft}>
                  Aller
                </button>
              </form>
            </div>
          )}
        </div>

        {/* Step controls */}
        <div className="rp-controls">
          <button id="rp-step-back" title="Bougie précédente · ←" onClick={stepBackward}>
            <SkipBack size={13} strokeWidth={2} />
          </button>
          <button id="rp-play" className={isPlaying ? 'playing' : ''} title="Lecture ou pause · Espace" onClick={() => setIsPlaying(!isPlaying)}>
            {isPlaying ? (
              <Pause size={14} strokeWidth={2.4} />
            ) : (
              <Play size={14} strokeWidth={2.4} fill="currentColor" />
            )}
          </button>
          <button id="rp-step-fwd" title="Bougie suivante · →" onClick={() => stepForward(baseCandles.length)}>
            <SkipForward size={13} strokeWidth={2} />
          </button>
        </div>

        {/* 1. Date compacte précise (Intraday) */}
        <div className="rp-date-badge u-display-flex u-align-items-center u-gap-5px" title="Date de la bougie affichée">
          <Calendar size={11} strokeWidth={2} className="u-color-text-muted" />
          <span>{timeCurStr}</span>
        </div>

        {/* 1. Sélecteur de vitesse compact (Dropdown 1× ▾) */}
        <div className="tv-dropdown rp-speed-dropdown u-position-relative">
          <button
            className="rp-speed-btn-compact u-display-flex u-align-items-center u-gap-4px"
            onClick={() => toggleDropdown('rp-speed')}
            title="Vitesse de lecture"
          >
            <Gauge size={11} strokeWidth={2} />
            <span>{currentSpeed.label}</span>
            <ChevronDown size={9} strokeWidth={2.5} />
          </button>
          {showSpeedMenu && (
            <div className="tv-dropdown-menu show u-bottom-calc-100pct-8px u-top-auto u-min-width-95px u-display-block">
              <div className="dropdown-section-label">Vitesse</div>
              {SPEEDS.map((s) => (
                <div
                  key={s.label}
                  className={`tv-dropdown-item ${speedMs === s.ms ? 'active' : ''} u-justify-content-space-between`}
                  onClick={() => {
                    setSpeedMs(s.ms);
                    closeAllDropdowns();
                  }}
                >
                  <span>{s.label}</span>
                  {s.label === '1×' && <span className="u-font-size-9px u-color-64748b">1× (normal)</span>}
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
          <span className="rp-stat-label">Solde</span>
          <span id="rp-balance" className="rp-stat-val">
            {formatMoney(balance)}
          </span>
        </div>

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

        {/* Compact Pending Orders Dropdown */}
        {pendingOrders && pendingOrders.length > 0 && (
          <div className="tv-dropdown rp-orders-dropdown u-position-relative">
            <button
              className="rp-pending-orders-btn u-display-flex u-align-items-center u-gap-5px"
              onClick={() => toggleDropdown('rp-orders')}
              title="Ordres en attente"
            >
              <Hourglass size={11} strokeWidth={2} className="u-color-38bdf8" />
              <span>{pendingOrders.length} en attente</span>
              <ChevronDown size={9} strokeWidth={2.5} />
            </button>
            {showOrdersMenu && (
              <div
                className="tv-dropdown-menu show u-bottom-calc-100pct-8px u-top-auto u-min-width-230px u-display-block u-padding-6px u-background-rgba-15-23-42-0_95 u-backdrop-filter-blur-20px u-border-7eec68 u-border-radius-8px u-box-shadow-ae6988"
              >
                <div className="u-display-flex u-justify-content-space-between u-align-items-center u-margin-bottom-6px u-padding-2px-4px">
                  <span className="u-font-size-10px u-font-weight-700 u-color-94a3b8 u-letter-spacing-0_04em">Ordres en attente</span>
                  {pendingOrders.length > 1 && (
                    <button
                      onClick={() => {
                        pendingOrders.forEach((o) => cancelPendingOrder(o.id));
                        closeAllDropdowns();
                      }} className="u-background-rgba-244-63-94-0_15 u-border-19dc74 u-color-fb7185 u-font-size-9_5px u-padding-2px-6px u-border-radius-3px u-cursor-pointer u-font-weight-600 u-display-flex u-align-items-center u-gap-4px"
                    >
                      <Trash2 size={10} strokeWidth={2} />
                      <span>Tout annuler</span>
                    </button>
                  )}
                </div>
                {pendingOrders.map((o) => (
                  <div
                    key={o.id} className="u-display-flex u-align-items-center u-justify-content-space-between u-padding-5px-8px u-border-radius-4px u-background-rgba-255-255-255-0_04 u-margin-bottom-4px u-border-d07d4b"
                  >
                    <div className="u-display-flex u-flex-direction-column u-gap-2px">
                      <span style={{ fontSize: '11px', fontWeight: 700, color: o.type === 'LONG' ? '#34D399' : '#FB7185' }}>
                        {o.type === 'LONG' ? 'Achat' : 'Vente'} {o.orderType === 'LIMIT' ? 'limite' : 'stop'} à {formatPrice(currentSymbol, o.targetPrice)}
                      </span>
                      <span className="u-font-size-9px u-color-64748b u-font-family-mono">
                        {o.sl ? `SL: ${formatPrice(currentSymbol, o.sl)} ` : ''}
                        {o.tp ? `TP: ${formatPrice(currentSymbol, o.tp)} ` : ''}
                        {`(${unitsToLots(o.symbol ?? currentSymbol, o.size).toFixed(2)} lots)`}
                      </span>
                    </div>
                    <button
                      onClick={() => cancelPendingOrder(o.id)}
                      title="Annuler cet ordre" className="u-background-rgba-244-63-94-0_12 u-border-c5b772 u-color-fb7185 u-width-22px u-height-22px u-border-radius-4px u-display-flex u-align-items-center u-justify-content-center u-cursor-pointer"
                    >
                      <X size={11} strokeWidth={2.4} />
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
      {/* ── BLOC 3 : SAISIE D'ORDRE ──
          Ordonné selon la chaîne de décision réelle : entrée → stop → objectif
          → risque → volume. L'ordre précédent (risque, volume, puis entrée et
          stop) demandait le volume avant les deux valeurs qui le déterminent.
          Les règles de saisie remontent des infobulles vers les placeholders. */}
      <div className="rp-order-grid">
        <div className="rp-order-row">
        <div className="rp-input-subgroup">
          <div className="rp-input-box">
            <span className="rp-input-label">Entrée</span>
            <input
              type="text"
              id="trade-entry"
              placeholder="Au marché"
              aria-describedby="hint-entry"
              value={entryInput}
              onChange={(e) => setEntryInput(e.target.value)}
            />
          </div>

          <div className="rp-input-box">
            <span className="rp-input-label sl">Stop</span>
            <input
              type="text"
              id="trade-sl"
              placeholder="prix ou 30p"
              aria-describedby="hint-protection"
              value={slInput}
              onChange={(e) => setSlInput(e.target.value)}
            />
          </div>

          <div className="rp-input-box">
            <span className="rp-input-label tp">Objectif</span>
            <input
              type="text"
              id="trade-tp"
              placeholder="prix ou 60p"
              aria-describedby="hint-protection"
              value={tpInput}
              onChange={(e) => setTpInput(e.target.value)}
            />
          </div>
        </div>

        <div className="rp-input-subgroup">
          <div className="rp-input-box">
            <span className="rp-input-label">Risque</span>
            <input
              type="number"
              id="trade-risk-pct"
              value={riskPercent}
              step="0.5"
              min="0.1"
              max="100"
              onChange={(e) => setRiskPercent(readPositiveNumber(e.target.value, riskPercent))}
            />
          </div>

          <div className="rp-sync-icon" aria-hidden="true">
            <Link2 size={12} strokeWidth={2.2} />
          </div>

          <div className="rp-input-box">
            <span className="rp-input-label">Volume</span>
            <input
              type="number"
              id="trade-qty"
              value={quantity}
              step="0.1"
              min="0.01"
              aria-describedby="hint-volume"
              onChange={(e) => setQuantity(readPositiveNumber(e.target.value, quantity))}
            />
          </div>
        </div>
        </div>

        {/* Ce que les infobulles cachaient : visible, et lisible au tactile. */}
        <div className="rp-order-hints">
          <span id="hint-entry">Vide = au marché ; un autre prix crée un ordre en attente.</span>
          <span id="hint-protection">Stop et objectif : un prix, <strong>30p</strong> (pips) ou <strong>1,5 %</strong>.</span>
          <span id="hint-volume" className={`derived ${riskOverrun ? 'is-warning' : ''}`}>
            {realRisk === null || riskStop === null
              ? 'Volume calculé depuis le risque et le stop.'
              : `${
                  // Saisie relative (« 30p », « 1,5 % ») : le côté du stop dépend
                  // du bouton qui sera cliqué, donc on donne la distance, pas un
                  // prix qui serait faux pour une vente.
                  /[p%]/i.test(slInput)
                    ? `Stop à ${(Math.abs(riskEntry - riskStop) / pip).toFixed(1)} pips de l’entrée`
                    : `Stop ${formatPrice(currentSymbol, riskStop)}`
                } · perte au stop ${formatMoney((balance * realRisk) / 100)} (${realRisk.toFixed(1)} %)${
                  riskOverrun ? ' — au-dessus du risque demandé : volume au lot minimum.' : ''
                }`}
          </span>
        </div>
      </div>

      {/* ── BLOCK 4: ACTIONS D'EXÉCUTION & GESTION (À DROITE) ── */}
      <div className="rp-actions">
        {/* 4. Boutons BUY / SELL épurés et alignés en hauteur */}
        <button className="trade-btn buy u-display-flex u-align-items-center u-gap-5px" id="btn-buy" onClick={handleBuy} title="Acheter — au marché ou en attente selon le prix saisi">
          <ArrowUp size={12} strokeWidth={2.8} />
          <span>Acheter</span>
        </button>
        <button className="trade-btn sell u-display-flex u-align-items-center u-gap-5px" id="btn-sell" onClick={handleSell} title="Vendre — au marché ou en attente selon le prix saisi">
          <ArrowDown size={12} strokeWidth={2.8} />
          <span>Vendre</span>
        </button>

        {/* Gestion de position : ces trois actions n'ont de sens qu'avec une
            position ouverte. Les afficher grisées en permanence occupait un
            tiers de la barre et poussait « Fermer » hors de l'écran. */}
        {activePosition && (
          <>
            <button
              className="trade-btn be u-display-flex u-align-items-center u-gap-4px"
              id="btn-be"
              onClick={() => {
                if (!blockTradingInThePast()) setBreakeven();
              }}
              title="Remonter le stop au prix d’entrée"
            >
              <ShieldCheck size={12} strokeWidth={2} />
              <span>Stop à l’entrée</span>
            </button>
            <button
              className="trade-btn scale u-display-flex u-align-items-center u-gap-4px"
              id="btn-scale-50"
              onClick={() => {
                if (!blockTradingInThePast()) closePartial(50, currentPrice, currentCandle?.time);
              }}
              title="Clôturer la moitié de la position"
            >
              <PieChart size={12} strokeWidth={2} />
              <span>Clôturer 50 %</span>
            </button>
          </>
        )}

        {activePosition && (
          <button
            className="trade-btn close u-display-flex u-align-items-center u-gap-4px"
            id="btn-close-pos"
            onClick={() => {
              if (!blockTradingInThePast()) closeAtMarket(currentPrice, currentCandle?.time);
            }}
            title="Fermer la position totale"
          >
            <XCircle size={12} strokeWidth={2} />
            <span>Fermer</span>
          </button>
        )}

        {/* 4. Bouton Journal explicite */}
        <button
          className="trade-btn journal-btn u-display-flex u-align-items-center u-justify-content-center"
          id="btn-history"
          onClick={() => openModal('trade-history')}
          title="Journal des trades & Historique des ordres"
        >
          <BookOpen size={14} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
};

