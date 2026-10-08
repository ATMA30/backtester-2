import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAllAppData } from './resetApp';
import * as dbModule from './db';
import { useDrawingStore } from '../store/useDrawingStore';
import { useTradeStore } from '../store/useTradeStore';
import { useReplayStore } from '../store/useReplayStore';
import { useUIStore } from '../store/useUIStore';

describe('resetAllAppData', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('wipes IndexedDB, localStorage, sessionStorage, and in-memory stores without throwing', async () => {
    const clearDbSpy = vi.spyOn(dbModule, 'clearAllDatabase').mockResolvedValue({ ok: true });

    // Seed localStorage & sessionStorage
    localStorage.setItem('tv_pro_drawings', JSON.stringify({ EURUSD: [] }));
    localStorage.setItem('dummy_key', 'value');
    sessionStorage.setItem('temp_data', '123');

    // Seed stores
    useDrawingStore.setState({
      drawingsBySymbol: { EURUSD: [] },
      drawings: [],
    });
    useTradeStore.setState({
      balance: 5000,
      openPositions: [],
    });
    useReplayStore.setState({
      isActive: true,
      currentIndex: 50,
    });
    useUIStore.setState({
      activeDropdown: 'data',
    });

    await resetAllAppData({ reload: false });

    // 1. Database clear was invoked
    expect(clearDbSpy).toHaveBeenCalledTimes(1);

    // 2. Storage cleared
    expect(localStorage.getItem('tv_pro_drawings')).toBeNull();
    expect(localStorage.getItem('dummy_key')).toBeNull();
    expect(sessionStorage.getItem('temp_data')).toBeNull();

    // 3. In-memory stores reset
    expect(useDrawingStore.getState().drawingsBySymbol).toEqual({});
    expect(useTradeStore.getState().balance).toBe(10_000); // Initial balance restored
    expect(useReplayStore.getState().isActive).toBe(false); // Replay reset
    expect(useUIStore.getState().activeDropdown).toBeNull(); // Dropdowns closed

    clearDbSpy.mockRestore();
  });
});
