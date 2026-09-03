import React, { useEffect } from 'react';
import { CheckCircle2, AlertCircle, Info } from 'lucide-react';
import { Topbar } from './components/Topbar/Topbar';
import { DrawingSidebar } from './components/Toolbar/DrawingSidebar';
import { TradingChart } from './components/Chart/TradingChart';
import { ReplayBar } from './components/Replay/ReplayBar';
import { ImportModal } from './components/Modals/ImportModal';
import { LiveModal } from './components/Modals/LiveModal';
import { DatasetsModal } from './components/Modals/DatasetsModal';
import { IndicatorConfigModal } from './components/Modals/IndicatorConfigModal';
import { TradeHistoryModal } from './components/Modals/TradeHistoryModal';
import { SnapshotModal } from './components/Modals/SnapshotModal';
import { ShortcutsModal } from './components/Modals/ShortcutsModal';
import { useMarketStore, loadSessionSettings } from './store/useMarketStore';
import { useDrawingStore } from './store/useDrawingStore';
import { useReplayStore } from './store/useReplayStore';
import { useTradeStore } from './store/useTradeStore';
import { useUIStore } from './store/useUIStore';
import { fetchHistoricalData } from './services/historicalApi';
import { getDataset } from './services/db';

export const App: React.FC = () => {
  const {
    setBaseCandles,
    setSymbol,
    displayCandles,
    currentSymbol,
    setTimeframe,
    setChartType,
    setHistoryRange,
    setSeparatorTF,
    addIndicator,
    toggleVolume,
    toggleGrid,
    toggleSound,
    toggleForexSession,
    toggleForexLocalTz,
  } = useMarketStore();
  const { setActiveTool, removeDrawing, selectedDrawingId, undo, redo, setActiveSymbol } = useDrawingStore();
  const { isActive: isReplayActive, isPlaying, setIsPlaying, stepForward, stepBackward, setIsActive } = useReplayStore();
  const { setBreakeven } = useTradeStore();
  const { openModal, closeModal, activeModal, toasts, showToast } = useUIStore();

  // ── SESSION RESTORE (resume where the user left off) ──────
  useEffect(() => {
    async function restoreSession() {
      const saved = loadSessionSettings();

      if (saved) {
        const dataset = await getDataset(saved.currentSymbol);
        if (dataset && dataset.data && dataset.data.length > 0) {
          setSymbol(dataset.symbol);
          setBaseCandles(dataset.data, dataset.baseTF);
          setTimeframe(saved.activeTF);
          setChartType(saved.chartType);
          setHistoryRange(saved.historyRange);
          setSeparatorTF(saved.separatorTF);
          if (saved.showVolume !== useMarketStore.getState().showVolume) toggleVolume();
          if (saved.showGrid !== useMarketStore.getState().showGrid) toggleGrid();
          if (saved.soundEnabled !== useMarketStore.getState().soundEnabled) toggleSound();
          (['sydney', 'tokyo', 'london', 'newyork'] as const).forEach((session) => {
            if (saved.forexSessions[session] !== useMarketStore.getState().forexSessions[session]) {
              toggleForexSession(session);
            }
          });
          if (saved.forexSessions.useLocalTz !== useMarketStore.getState().forexSessions.useLocalTz) {
            toggleForexLocalTz();
          }
          saved.activeIndicators.forEach((ind) => addIndicator(ind));
          showToast(`🟢 Session restaurée — ${dataset.symbol} (${dataset.data.length.toLocaleString()} bougies)`, 'success', 3500);
          return;
        }
      }

      // No usable saved session — fall back to the default EUR/USD dataset.
      try {
        const candles = await fetchHistoricalData('EURUSD', '1d', 'max');
        if (candles && candles.length > 0) {
          setSymbol('EURUSD');
          setBaseCandles(candles);
          showToast(`🟢 EUR/USD — ${candles.length.toLocaleString()} bougies réelles (1999 → 2026)`, 'success', 3500);
        }
      } catch (e) {
        console.warn('Initial data load error:', e);
      }
    }
    restoreSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── KEEP DRAWINGS SCOPED TO THE ACTIVE SYMBOL ─────────────
  useEffect(() => {
    setActiveSymbol(currentSymbol);
  }, [currentSymbol, setActiveSymbol]);

  // ── GLOBAL KEYBOARD SHORTCUTS ─────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in inputs
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        return;
      }

      if (e.key === 'Escape') {
        if (activeModal) closeModal();
        else if (isReplayActive) setIsActive(false);
      } else if (e.key === '1') {
        setActiveTool('cursor');
      } else if (e.key === '2') {
        setActiveTool('trendline');
      } else if (e.key === '3') {
        setActiveTool('hline');
      } else if (e.key === '4') {
        setActiveTool('vline');
      } else if (e.key === '5') {
        setActiveTool('rect');
      } else if (e.key === '6') {
        setActiveTool('fib');
      } else if (e.key === '7' || e.key === 't' || e.key === 'T') {
        setActiveTool('text');
      } else if (e.key === '8') {
        setActiveTool('channel');
      } else if (e.key === '9') {
        setActiveTool('pos_long');
      } else if (e.key === '0') {
        setActiveTool('pos_short');
      } else if (e.key === 'r' || e.key === 'R') {
        setActiveTool('ray');
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedDrawingId) removeDrawing(selectedDrawingId);
      } else if (e.key === ' ') {
        e.preventDefault();
        if (isReplayActive) setIsPlaying(!isPlaying);
      } else if (e.key === 'ArrowRight') {
        if (isReplayActive) stepForward();
      } else if (e.key === 'ArrowLeft') {
        if (isReplayActive) stepBackward();
      } else if (e.key === 'b' || e.key === 'B') {
        const last = displayCandles[displayCandles.length - 1];
        if (last) setBreakeven(last.close);
      } else if (e.key === 'p' || e.key === 'P') {
        openModal('snapshot');
      } else if (e.key === '?') {
        openModal('shortcuts');
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        if (e.shiftKey) redo();
        else undo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeModal, isReplayActive, isPlaying, selectedDrawingId, displayCandles, setActiveTool, removeDrawing, setIsPlaying, stepForward, stepBackward, setBreakeven, openModal, closeModal, setIsActive, undo, redo]);

  // ── AUTO-CLOSE DROPDOWNS ON CLICK OUTSIDE ─────────────────
  const { activeDropdown, closeAllDropdowns } = useUIStore();
  useEffect(() => {
    if (!activeDropdown) return;
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && !target.closest('.tv-dropdown') && !target.closest('.tv-dropdown-menu')) {
        closeAllDropdowns();
      }
    };
    window.addEventListener('click', handleOutsideClick);
    return () => window.removeEventListener('click', handleOutsideClick);
  }, [activeDropdown, closeAllDropdowns]);

  return (
    <>
      <Topbar />

      <div id="layout">
        <DrawingSidebar />
        <TradingChart />
      </div>

      <ReplayBar />

      {/* Modals */}
      <ImportModal />
      <LiveModal />
      <DatasetsModal />
      <IndicatorConfigModal />
      <TradeHistoryModal />
      <SnapshotModal />
      <ShortcutsModal />

      {/* Toast Notification Container */}
      <div id="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type || 'info'}`} style={{ display: 'flex', alignItems: 'center' }}>
            <span className="toast-icon" style={{ display: 'inline-flex', alignItems: 'center' }}>
              {t.type === 'success' ? (
                <CheckCircle2 size={15} strokeWidth={2.4} style={{ color: '#00C46E' }} />
              ) : t.type === 'error' ? (
                <AlertCircle size={15} strokeWidth={2.4} style={{ color: '#F43F5E' }} />
              ) : (
                <Info size={15} strokeWidth={2.4} style={{ color: '#38BDF8' }} />
              )}
            </span>
            <span className="toast-msg">{t.message}</span>
          </div>
        ))}
      </div>
    </>
  );
};
