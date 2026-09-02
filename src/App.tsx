import React, { useEffect } from 'react';
import { Topbar } from './components/Topbar/Topbar';
import { DrawingSidebar } from './components/Toolbar/DrawingSidebar';
import { TradingChart } from './components/Chart/TradingChart';
import { OrderPanel } from './components/Trading/OrderPanel';
import { ReplayControls } from './components/Replay/ReplayControls';
import { LiveMarketModal } from './components/Modals/LiveMarketModal';
import { MetricsModal } from './components/Modals/MetricsModal';
import { useMarketStore } from './store/useMarketStore';
import { useUIStore } from './store/useUIStore';
import { fetchHistoricalData } from './services/historicalApi';

export const App: React.FC = () => {
  const { currentSymbol, setBaseCandles, setLiveConnected } = useMarketStore();
  const { toasts, showToast } = useUIStore();

  // Initial Data Load (EURUSD Daily 27y)
  useEffect(() => {
    async function loadInitial() {
      try {
        const candles = await fetchHistoricalData('EURUSD', '1d', 'max');
        if (candles && candles.length > 0) {
          setBaseCandles(candles);
          setLiveConnected(true);
          showToast(`🟢 EUR/USD — ${candles.length.toLocaleString()} bougies réelles chargées (1999 → 2026)`, 'success', 3500);
        }
      } catch (e) {
        console.warn('Initial data load error:', e);
      }
    }
    loadInitial();
  }, []);

  return (
    <div className="app-container">
      <Topbar />

      <div className="main-workspace">
        <DrawingSidebar />

        <div className="chart-area">
          <TradingChart />
          <ReplayControls />
        </div>

        <OrderPanel />
      </div>

      {/* Modals */}
      <LiveMarketModal />
      <MetricsModal />

      {/* Toasts */}
      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`toast-card ${t.type}`}>
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
};
