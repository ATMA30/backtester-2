import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBar } from './StatusBar';
import { useMarketStore } from '../../store/useMarketStore';
import { useReplayStore } from '../../store/useReplayStore';

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000;
const candle = (time: number) => ({ time, open: 1, high: 1, low: 1, close: 1, volume: 0 });

describe('<StatusBar>', () => {
  beforeEach(() => {
    useReplayStore.getState().resetReplay();
    useMarketStore.getState().setBaseCandles([]);
    useMarketStore.getState().setDataSource(null, false);
  });

  it('says there is nothing loaded, not "connected"', () => {
    render(<StatusBar />);
    expect(screen.getByText('Aucune donnée')).toBeTruthy();
    expect(screen.queryByText(/bougies/)).toBeNull();
  });

  it('names the source, counts the candles and gives their range', () => {
    useMarketStore.getState().setBaseCandles([candle(day('2024-01-02')), candle(day('2024-01-03')), candle(day('2024-01-04'))]);
    useMarketStore.getState().setDataSource('Données réelles · Dukascopy', false);
    render(<StatusBar />);
    expect(screen.getByText('Données réelles · Dukascopy')).toBeTruthy();
    expect(document.getElementById('rows-count')?.textContent).toBe('3');
    expect(document.getElementById('range-text')?.textContent).toBe('02/01/2024 → 04/01/2024');
  });

  it('never lets simulated candles pass for market data', () => {
    useMarketStore.getState().setBaseCandles([candle(day('2024-01-02'))]);
    useMarketStore.getState().setDataSource('Données réelles · Yahoo', true);
    render(<StatusBar />);
    expect(screen.getByText('Données simulées')).toBeTruthy();
    expect(document.getElementById('status-dot')?.className).toContain('simulated');
  });

  it('shows a running replay', () => {
    useReplayStore.getState().setIsActive(true);
    render(<StatusBar />);
    expect(screen.getByText('Replay en cours')).toBeTruthy();
  });
});
