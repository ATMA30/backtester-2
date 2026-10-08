import React from 'react';
import { AreaChart, BarChart2, CandlestickChart, ChevronDown, LineChart } from 'lucide-react';
import { useMarketStore } from '../../store/useMarketStore';
import { useUIStore } from '../../store/useUIStore';

/** Candles, bars, line or area. */
export const ChartTypeMenu: React.FC = () => {
  const chartType = useMarketStore((m) => m.chartType);
  const setChartType = useMarketStore((m) => m.setChartType);
  const { activeDropdown, toggleDropdown, closeAllDropdowns } = useUIStore();

  return (
  <div className="tv-dropdown">
    <button
      className="tv-dropdown-btn ctype-trigger"
      id="btn-active-ctype"
      onClick={() => toggleDropdown('ctype')}
    >
      {chartType === 'Candlestick' && <CandlestickChart size={13} strokeWidth={2} className="ctype-trigger-icon" />}
      {chartType === 'Bar' && <BarChart2 size={13} strokeWidth={2} className="ctype-trigger-icon" />}
      {chartType === 'Line' && <LineChart size={13} strokeWidth={2} className="ctype-trigger-icon" />}
      {chartType === 'Area' && <AreaChart size={13} strokeWidth={2} className="ctype-trigger-icon" />}
      <span>
        {chartType === 'Candlestick'
          ? 'Chandeliers'
          : chartType === 'Bar'
          ? 'Barres'
          : chartType === 'Line'
          ? 'Ligne'
          : 'Aire'}
      </span>
      <ChevronDown size={11} strokeWidth={2.5} />
    </button>
    {activeDropdown === 'ctype' && (
      <div className="tv-dropdown-menu show ctype-menu">
        {[
          { type: 'Candlestick' as const, label: 'Chandeliers', icon: <CandlestickChart size={13} strokeWidth={2} /> },
          { type: 'Bar' as const, label: 'Barres', icon: <BarChart2 size={13} strokeWidth={2} /> },
          { type: 'Line' as const, label: 'Ligne', icon: <LineChart size={13} strokeWidth={2} /> },
          { type: 'Area' as const, label: 'Aire', icon: <AreaChart size={13} strokeWidth={2} /> },
        ].map((item) => (
          <button type="button"
            key={item.type}
            className={`tv-dropdown-item ${chartType === item.type ? 'active' : ''} ctype-option`}
            onClick={() => {
              setChartType(item.type);
              closeAllDropdowns();
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', color: chartType === item.type ? '#3B82F6' : 'inherit' }}>
              {item.icon}
            </span>
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    )}
  </div>
  );
};
