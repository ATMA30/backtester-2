import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LiveModal } from './LiveModal';
import { useUIStore } from '../../store/useUIStore';
import { useMarketStore } from '../../store/useMarketStore';
import * as historicalApi from '../../services/historicalApi';

describe('<LiveModal>', () => {
  beforeEach(() => {
    useUIStore.getState().closeModal();
    useMarketStore.getState().setBaseCandles([]);
    useMarketStore.getState().setSymbol('EURUSD');
    useMarketStore.getState().setDataSource(null, false);
    vi.restoreAllMocks();
  });

  it('does not render when activeModal is not live', () => {
    render(<LiveModal />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders instrument selection when live modal is active', () => {
    useUIStore.getState().openModal('live');
    render(<LiveModal />);
    expect(screen.getByRole('dialog', { name: 'Choisir un instrument' })).toBeTruthy();
  });

  it('never injects fake data when real provider fails for R_100, and displays honest error card', async () => {
    vi.spyOn(historicalApi, 'fetchHistoricalSeries').mockResolvedValue({
      candles: [],
      provenance: 'deriv',
      isSimulated: false,
      attempted: ['deriv'],
    });

    useUIStore.getState().openModal('live');
    render(<LiveModal />);

    // Select Deriv synthetics category
    const catBtn = screen.getByRole('button', { name: 'Indices Synthétiques (Deriv)' });
    fireEvent.click(catBtn);

    // Click R_100
    const r100Btn = screen.getByRole('button', { name: /R_100/i });
    fireEvent.click(r100Btn);

    // Wait for the error card to appear
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });

    expect(screen.getByText(/Données réelles non reçues pour R_100/i)).toBeTruthy();
    expect(screen.getByText(/aucune fausse donnée n'a été injectée/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Importer un fichier CSV réel/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Démo simulée/i })).toBeTruthy();

    // Chart candles were NOT contaminated
    expect(useMarketStore.getState().baseCandles).toEqual([]);
    // Modal is still open so the user can choose how to proceed
    expect(useUIStore.getState().activeModal).toBe('live');
  });

  it('loads simulated candles only when user explicitly clicks the demo button', async () => {
    vi.spyOn(historicalApi, 'fetchHistoricalSeries').mockImplementation(async (req) => {
      if (req.allowSimulated) {
        return {
          candles: [
            { time: 1000, open: 100, high: 105, low: 95, close: 102, volume: 10 },
            { time: 2000, open: 102, high: 108, low: 101, close: 107, volume: 15 },
          ],
          provenance: 'simulated',
          isSimulated: true,
          attempted: ['deriv'],
        };
      }
      return {
        candles: [],
        provenance: 'deriv',
        isSimulated: false,
        attempted: ['deriv'],
      };
    });

    useUIStore.getState().openModal('live');
    render(<LiveModal />);

    // Click R_100
    const catBtn = screen.getByRole('button', { name: 'Indices Synthétiques (Deriv)' });
    fireEvent.click(catBtn);
    const r100Btn = screen.getByRole('button', { name: /R_100/i });
    fireEvent.click(r100Btn);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Démo simulée/i })).toBeTruthy();
    });

    // Explicitly click demo button
    const demoBtn = screen.getByRole('button', { name: /Démo simulée/i });
    fireEvent.click(demoBtn);

    await waitFor(() => {
      expect(useUIStore.getState().activeModal).toBeNull();
    });

    expect(useMarketStore.getState().currentSymbol).toBe('R_100');
    expect(useMarketStore.getState().baseCandles.length).toBe(2);
    expect(useMarketStore.getState().isSimulatedData).toBe(true);
    expect(useMarketStore.getState().dataSourceLabel).toContain('Données de test simulées');
  });
});
