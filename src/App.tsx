import React, { Suspense, lazy, useEffect, useRef } from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import { Topbar } from './components/Topbar/Topbar';
import { DrawingSidebar } from './components/Toolbar/DrawingSidebar';
import { TradingChart } from './components/Chart/TradingChart';
import { ReplayBar } from './components/Replay/ReplayBar';
import { ErrorBoundary } from './components/ErrorBoundary';
import { OnboardingGuide } from './components/Onboarding/OnboardingGuide';
import { TimeframeCoverageModal } from './components/Modals/TimeframeCoverageModal';
import { useMarketStore, loadSessionSettings } from './store/useMarketStore';
import { useDrawingStore } from './store/useDrawingStore';
import { useReplayStore } from './store/useReplayStore';
import { useTradeStore } from './store/useTradeStore';
import { useUIStore, ToastType } from './store/useUIStore';
import { fetchHistoricalSeries, PROVENANCE_LABELS } from './services/historicalApi';
import { getDataset, pruneOrphanCaptures } from './services/db';
import { isClosesOnlySeries } from './domain/candles';
import { prepareConversionFor } from './services/fxRates';
import { sound } from './services/audio';
import { DrawingTool } from './types/drawing';
import { toggleFullscreen } from './hooks/useFullscreen';
import { blockRelocationWhileTrading, blockTradingInThePast } from './components/Replay/replayGuards';

/**
 * Dialogs load on first open, out of the main bundle, and are mounted only
 * while open. Rendering all of them permanently — each returning `null` — kept
 * their state and their in-flight requests alive after closing, which needed a
 * `key` trick per modal to work around.
 */
const ImportModal = lazy(() => import('./components/Modals/ImportModal').then((m) => ({ default: m.ImportModal })));
const LiveModal = lazy(() => import('./components/Modals/LiveModal').then((m) => ({ default: m.LiveModal })));
const DatasetsModal = lazy(() => import('./components/Modals/DatasetsModal').then((m) => ({ default: m.DatasetsModal })));
const IndicatorConfigModal = lazy(() => import('./components/Modals/IndicatorConfigModal').then((m) => ({ default: m.IndicatorConfigModal })));
const TradeHistoryModal = lazy(() => import('./components/Modals/TradeHistoryModal').then((m) => ({ default: m.TradeHistoryModal })));
const SnapshotModal = lazy(() => import('./components/Modals/SnapshotModal').then((m) => ({ default: m.SnapshotModal })));
const ShortcutsModal = lazy(() => import('./components/Modals/ShortcutsModal').then((m) => ({ default: m.ShortcutsModal })));
const ResetAllModal = lazy(() => import('./components/Modals/ResetAllModal').then((m) => ({ default: m.ResetAllModal })));

/** Tool shortcuts, extracted from what used to be a 16-branch if/else chain. */
const TOOL_SHORTCUTS: Readonly<Record<string, DrawingTool>> = {
  '1': 'cursor',
  '2': 'trendline',
  '3': 'hline',
  '4': 'vline',
  '5': 'rect',
  '6': 'fib',
  '7': 'text',
  '8': 'channel',
  '9': 'pos_long',
  '0': 'pos_short',
  t: 'text',
  r: 'ray',
};

/**
 * Icône par gravité.
 *
 * `warning` partageait l'icône bleue d'`info` : un avertissement — « données
 * simulées », « sauvegarde impossible » — était visuellement identique à une
 * information neutre, alors que le store distingue les quatre niveaux et que
 * chaque appelant choisit le sien délibérément.
 */
const TOAST_ICONS: Readonly<Record<ToastType, React.ReactNode>> = {
  success: <CheckCircle2 size={15} strokeWidth={2.4} aria-hidden />,
  error: <AlertCircle size={15} strokeWidth={2.4} aria-hidden />,
  warning: <AlertTriangle size={15} strokeWidth={2.4} aria-hidden />,
  info: <Info size={15} strokeWidth={2.4} aria-hidden />,
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName);
}

export const App: React.FC = () => {
  const currentSymbol = useMarketStore((s) => s.currentSymbol);
  const setActiveSymbol = useDrawingStore((s) => s.setActiveSymbol);
  const soundEnabled = useMarketStore((s) => s.soundEnabled);
  const toasts = useUIStore((s) => s.toasts);
  const activeDropdown = useUIStore((s) => s.activeDropdown);
  const activeModal = useUIStore((s) => s.activeModal);

  /**
   * StrictMode mounts effects twice in development. Without this guard the
   * restore ran twice, which duplicated every persisted indicator and fired two
   * concurrent history downloads.
   */
  const hasStartedRestoreRef = useRef(false);
  /**
   * True once the bootstrap has finished choosing an instrument.
   *
   * The isolation rule below must not fire while the app is still deciding what
   * to load: a restored session legitimately swaps the symbol away from the
   * store's default, and resetting there would wipe the account it just brought
   * back.
   */
  const hasBootstrappedRef = useRef(false);

  // ── AUDIO MUTE ────────────────────────────────────────────
  // `SoundEngine.enabled` was never assigned anywhere: toggling the speaker icon
  // updated the store and the icon, but every sound kept playing.
  useEffect(() => {
    sound.enabled = soundEnabled;
  }, [soundEnabled]);

  // ── SESSION RESTORE ───────────────────────────────────────
  useEffect(() => {
    if (hasStartedRestoreRef.current) return;
    hasStartedRestoreRef.current = true;

    // No cancellation flag here on purpose. Every write below targets a
    // module-level Zustand store, not component state, so there is nothing to
    // abort on unmount — and pairing an abort with the StrictMode guard was a
    // deadlock: the first mount started the load, the cleanup cancelled it, and
    // the second mount returned early, so the chart stayed permanently empty.
    async function restoreSavedSession(): Promise<boolean> {
      const saved = loadSessionSettings();
      if (!saved) return false;

      const dataset = await getDataset(saved.currentSymbol);
      if (!dataset?.data?.length) return false;
      // A provider cache holding closes only (the old ECB-first daily forex)
      // must not come back: reload that instrument with real wicks instead.
      if (dataset.source !== 'import' && isClosesOnlySeries(dataset.data)) {
        const loaded = await loadDefaultDataset(saved.currentSymbol);
        if (loaded) {
          useMarketStore.getState().setChartType(saved.chartType);
          return true;
        }
      }

      const market = useMarketStore.getState();
      market.setSymbol(dataset.symbol);
      market.setBaseCandles(dataset.data, dataset.baseTF);
      market.setTimeframe(saved.activeTF);
      market.setChartType(saved.chartType);
      market.setHistoryRange(saved.historyRange);
      market.setSeparatorTF(saved.separatorTF);

      // Explicit setters rather than "toggle until it matches": the toggle-based
      // restore could not express the killzone and display flags at all, so
      // asianRange / londonOpenKZ / nyOpenKZ / londonCloseKZ / showHighLow /
      // showLabels were persisted but silently dropped on every reload.
      market.setShowVolume(saved.showVolume);
      market.setShowGrid(saved.showGrid);
      market.setSoundEnabled(saved.soundEnabled);
      market.setForexSessions(saved.forexSessions);
      saved.activeIndicators.forEach(market.addIndicator);
      // Après un rechargement, l'origine réelle des bougies n'est plus
      // vérifiable : ne pas la revendiquer.
      market.setDataSource('Sauvegarde locale', false);

      useUIStore
        .getState()
        .showToast(
          `Session reprise · ${dataset.symbol} · ${dataset.data.length.toLocaleString('fr-FR')} bougies`,
          'success',
          3500
        );
      return true;
    }

    async function loadDefaultDataset(symbol = 'EURUSD'): Promise<boolean> {
      const series = await fetchHistoricalSeries({ symbol, interval: '1d', range: 'max' });
      if (!series.candles.length) return false;

      const market = useMarketStore.getState();
      market.setSymbol(symbol);
      market.setBaseCandles(series.candles);
      market.setChartType('Candlestick');
      market.setDataSource(`Données réelles · ${PROVENANCE_LABELS[series.provenance]}`, series.isSimulated);

      // Say which it is. The loader used to announce "bougies réelles" even when
      // every provider had failed and the series was locally generated.
      const count = series.candles.length.toLocaleString('fr-FR');
      useUIStore.getState().showToast(
        series.isSimulated
          ? `Données simulées : aucune source n’a répondu. Résultats non exploitables.`
          : `${symbol} chargé · ${count} bougies · ${PROVENANCE_LABELS[series.provenance]}`,
        series.isSimulated ? 'warning' : 'success',
        series.isSimulated ? 8000 : 3500
      );
      return true;
    }

    // A single catch around both paths: the previous version awaited an unguarded
    // promise, so a malformed localStorage payload threw before the fallback
    // loader ran and left the app permanently empty.
    // Before anything can close a trade: only saved sessions still hold trades.
    void pruneOrphanCaptures();

    void (async () => {
      // Le `finally` enveloppe les *deux* chemins. Attaché au seul second bloc,
      // il était sauté dès qu'une session sauvegardée était restaurée — le cas
      // courant — et le drapeau restait faux pour toute la durée de la session.
      try {
        try {
          if (await restoreSavedSession()) return;
        } catch (error) {
          console.warn('[App] Session restore failed, falling back to default dataset:', error);
        }
        try {
          await loadDefaultDataset();
        } catch (error) {
          console.error('[App] Initial data load failed:', error);
          useUIStore
            .getState()
            .showToast('Chargement impossible. Importez un fichier pour commencer.', 'error', 6000);
        }
      } finally {
        hasBootstrappedRef.current = true;
        useTradeStore.getState().setAccountSymbol(useMarketStore.getState().currentSymbol);
      }
    })();
  }, []);

  // ── ONE INSTRUMENT, ONE ACCOUNT ───────────────────────────
  /**
   * Wipe the trading account when the loaded instrument changes.
   *
   * `resetAccount` existed in the store and was called from nowhere, so a
   * position stayed open across a dataset swap: buying at 2 000 on one file and
   * then importing another whose prices sit near 157 left an open trade showing
   * a −1 914 € loss, computed between one instrument's entry and another's
   * price. Pending orders had the same problem, and the balance that follows
   * from them was meaningless.
   *
   * Keyed on the symbol rather than wired into each import path on purpose:
   * there are six places that can swap the dataset, and a seventh would forget.
   */
  useEffect(() => {
    if (!hasBootstrappedRef.current) return;

    const trade = useTradeStore.getState();
    const previous = trade.accountSymbol;
    if (previous === currentSymbol) return;
    trade.setAccountSymbol(currentSymbol);
    // First instrument after the bootstrap: nothing to wipe.
    if (previous === null) return;

    // Compté AVANT la remise à zéro. `trade` reste un instantané figé grâce à
    // l'immutabilité de Zustand, mais s'appuyer là-dessus pour un message
    // rendu après coup se lit mal et casserait au premier `set` mutatif.
    const closedCount = trade.closedPositions.length;
    const pendingCount = trade.pendingOrders.length;
    const openCount = trade.openPositions.length;
    const hadOpenWork = openCount > 0 || pendingCount > 0;
    const hadHistory = closedCount > 0;

    useReplayStore.getState().resetReplay();
    trade.resetAccount();

    if (hadOpenWork || hadHistory) {
      // Effacer un journal de trades est irréversible. Le message disait
      // seulement « compte réinitialisé », sur le ton d'une information, et
      // n'était de toute façon jamais affiché — les toasts étaient invisibles.
      // Il dit maintenant ce qui a disparu, et comment ne pas le reperdre.
      const lost = [
        hadHistory ? `${closedCount} trade(s) au journal` : null,
        openCount > 0 ? `${openCount} position(s) ouverte(s)` : null,
        pendingCount > 0 ? `${pendingCount} ordre(s) en attente` : null,
      ].filter(Boolean);

      useUIStore
        .getState()
        .showToast(
          `Compte remis à zéro pour ${currentSymbol} : ${lost.join(', ')} effacé(s). ` +
            `Enregistrez une session avant de changer d’instrument pour la retrouver.`,
          'warning',
          8000
        );
    }
  }, [currentSymbol]);

  // ── KEEP DRAWINGS SCOPED TO THE ACTIVE SYMBOL ─────────────
  useEffect(() => {
    setActiveSymbol(currentSymbol);
  }, [currentSymbol, setActiveSymbol]);

  // ── CONVERSION RATES ──────────────────────────────────────
  // Whatever leg the pair cannot price by itself (the quote of a cross, the
  // account currency against the dollar) converts with the ECB rate of the
  // candle's day, loaded here once per currency.
  const accountCurrency = useTradeStore((s) => s.accountCurrency);
  useEffect(() => {
    void prepareConversionFor(currentSymbol);
  }, [currentSymbol, accountCurrency]);

  // ── GLOBAL KEYBOARD SHORTCUTS ─────────────────────────────
  // Stores are read via getState() inside the handler, so the listener is
  // attached once instead of being detached and reattached on every price tick
  // (the previous dependency array included the whole `displayCandles` array).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;

      const ui = useUIStore.getState();
      const replay = useReplayStore.getState();
      const drawing = useDrawingStore.getState();

      const isUndo = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z';
      if (isUndo) {
        e.preventDefault();
        if (e.shiftKey) drawing.redo();
        else drawing.undo();
        return;
      }

      // Never hijack browser and OS chords (Ctrl+R reload, Cmd+T new tab, …):
      // the old chain matched on `e.key` alone, so Ctrl+R switched to the ray
      // tool on its way to reloading the page.
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // Une boîte de dialogue ouverte absorbe tout sauf Échap : sans cela, `d`
      // ouvrait les sauvegardes et `p` la capture d'écran par-dessus le
      // diagnostic qu'on venait d'afficher, et `1`–`0` changeaient d'outil de
      // dessin pendant qu'on lisait un message.
      const isDialogOpen = ui.timeframeCoverage !== null || ui.activeModal !== null;
      if (isDialogOpen && e.key !== 'Escape') return;

      const tool = TOOL_SHORTCUTS[e.key.toLowerCase()];
      if (tool) {
        drawing.setActiveTool(tool);
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'f':
          // Advertised by the topbar menu ("Plein écran · F") but never bound:
          // pressing F did nothing at all.
          e.preventDefault();
          void toggleFullscreen();
          break;

        case 'a':
          // "Ajuster la vue". Previously documented as Ctrl+F, which this
          // handler deliberately never receives — see the chord guard above.
          useMarketStore.getState().triggerFitContent();
          break;

        case 'd':
          // "Ouvrir les données". Previously documented as Ctrl+O, likewise
          // unreachable.
          ui.openModal('datasets');
          break;

        case 'escape':
          // Ordre du plus local au plus global. Le diagnostic de couverture ne
          // passe volontairement pas par `activeModal` : sans ce premier test,
          // Échap le sautait et tombait dans la branche replay — la boîte qui
          // promet « votre position est conservée » se fermait en détruisant
          // cette position, et elle ne s'ouvre justement que pendant un replay.
          if (ui.timeframeCoverage) ui.setTimeframeCoverage(null);
          else if (ui.activeModal) ui.closeModal();
          // Annoncé par le bandeau « Échap pour annuler », jamais câblé.
          else if (replay.isPicking) replay.setIsPicking(false);
          else if (replay.isActive && !blockRelocationWhileTrading('Quitter le replay')) {
            replay.setIsActive(false);
          }
          break;

        case 'delete':
        case 'backspace':
          if (drawing.selectedDrawingId) {
            drawing.removeDrawing(drawing.selectedDrawingId);
            drawing.selectDrawing(null);
          }
          break;

        case ' ':
          e.preventDefault();
          if (replay.isActive) replay.setIsPlaying(!replay.isPlaying);
          break;

        case 'arrowright':
          if (replay.isActive) {
            replay.stepForward(useMarketStore.getState().baseCandles.length);
          }
          break;

        case 'arrowleft':
          if (replay.isActive) replay.stepBackward();
          break;

        case 'b':
          if (!blockTradingInThePast()) useTradeStore.getState().setBreakeven();
          break;

        case 'p':
          ui.openModal('snapshot');
          break;

        case '?':
          ui.openModal('shortcuts');
          break;

        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // ── AUTO-CLOSE DROPDOWNS ON CLICK OUTSIDE ─────────────────
  useEffect(() => {
    if (!activeDropdown) return;
    // `composedPath()` rather than `target.closest()`: React re-renders between
    // its own listener and this one, and a click that swaps the menu's content
    // (a confirmation step) leaves `target` detached, with no ancestor at all —
    // the menu then closed on its own button.
    const handleOutsideClick = (e: MouseEvent) => {
      const inside = e
        .composedPath()
        .some((node) => node instanceof Element && node.matches('.tv-dropdown, .tv-dropdown-menu'));
      if (!inside) useUIStore.getState().closeAllDropdowns();
    };
    window.addEventListener('click', handleOutsideClick);
    return () => window.removeEventListener('click', handleOutsideClick);
  }, [activeDropdown]);

  return (
    <>
      <ErrorBoundary compact label="la barre d’outils">
        <Topbar />
      </ErrorBoundary>

      <div id="layout">
        <DrawingSidebar />
        <ErrorBoundary>
          <TradingChart />
        </ErrorBoundary>
      </div>

      <ErrorBoundary compact label="le guide d’arrivée">
        <OnboardingGuide />
      </ErrorBoundary>

      <ErrorBoundary compact label="la barre de replay">
        <ReplayBar />
      </ErrorBoundary>

      {/* Modals — une erreur dans une boîte de dialogue la ferme, sans
          emporter le graphique ni le compte. */}
      <ErrorBoundary compact label="cette fenêtre" onReset={() => useUIStore.getState().closeModal()}>
        <TimeframeCoverageModal />
        <Suspense fallback={null}>
          {activeModal === 'import' && <ImportModal />}
          {activeModal === 'live' && <LiveModal />}
          {activeModal === 'datasets' && <DatasetsModal />}
          {activeModal === 'indicator-config' && <IndicatorConfigModal />}
          {activeModal === 'trade-history' && <TradeHistoryModal />}
          {activeModal === 'snapshot' && <SnapshotModal />}
          {activeModal === 'shortcuts' && <ShortcutsModal />}
          {activeModal === 'reset-all' && <ResetAllModal />}
        </Suspense>
      </ErrorBoundary>

      {/* ── Toasts ──
          La classe portait le type nu (`toast success`) alors que la feuille de
          style définit `.toast-success` : aucune des quatre variantes ne
          s'appliquait. L'anatomie complète (corps, fermeture, barre de
          progression) était elle aussi décrite en CSS mais jamais rendue. */}
      <div id="toast-container" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast toast-${t.type}`}
            role={t.type === 'error' || t.type === 'warning' ? 'alert' : undefined}
            // La barre de progression dure exactement ce que dure le toast.
            style={{ '--toast-duration': `${t.durationMs}ms` } as React.CSSProperties}
          >
            <span className="toast-icon">{TOAST_ICONS[t.type] ?? TOAST_ICONS.info}</span>
            <div className="toast-body">
              <span className="toast-msg">{t.message}</span>
            </div>
            <button
              type="button"
              className="toast-close"
              onClick={() => useUIStore.getState().removeToast(t.id)}
              aria-label="Fermer la notification"
            >
              <X size={13} strokeWidth={2.4} />
            </button>
            <span className="toast-progress" aria-hidden />
          </div>
        ))}
      </div>
    </>
  );
};
