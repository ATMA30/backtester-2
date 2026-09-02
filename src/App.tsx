import React, { useEffect } from 'react';
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
import { useMarketStore } from './store/useMarketStore';
import { useDrawingStore } from './store/useDrawingStore';
import { useReplayStore } from './store/useReplayStore';
import { useTradeStore } from './store/useTradeStore';
import { useUIStore } from './store/useUIStore';
import { fetchHistoricalData } from './services/historicalApi';

export const App: React.FC = () => {
  const { setBaseCandles, setSymbol, displayCandles } = useMarketStore();
  const { setActiveTool, removeDrawing, selectedDrawingId, undo, redo } = useDrawingStore();
  const { isActive: isReplayActive, isPlaying, setIsPlaying, stepForward, stepBackward, setIsActive } = useReplayStore();
  const { setBreakeven } = useTradeStore();
  const { openModal, closeModal, activeModal, toasts, showToast } = useUIStore();

  // ── INITIAL DATA LOAD (EUR/USD 27 YEARS) ──────────────────
  useEffect(() => {
    async function loadInitial() {
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
    loadInitial();
  }, []);

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
          <div key={t.id} className={`toast ${t.type || 'info'}`} style={{ display: 'flex' }}>
            <span className="toast-icon">
              {t.type === 'success' ? '✓' : t.type === 'error' ? '✕' : 'ℹ'}
            </span>
            <span className="toast-msg">{t.message}</span>
          </div>
        ))}
      </div>
    </>
  );
};
