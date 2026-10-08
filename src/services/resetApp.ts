import { clearAllDatabase } from './db';
import { useDrawingStore } from '../store/useDrawingStore';
import { useTradeStore } from '../store/useTradeStore';
import { useReplayStore } from '../store/useReplayStore';
import { useUIStore } from '../store/useUIStore';

export interface ResetOptions {
  /**
   * Whether to reload the window after clearing all data.
   * Defaults to true in browser environments.
   */
  reload?: boolean;
}

/**
 * Completely wipe all persistent and in-memory application data:
 * - IndexedDB datasets (cached/imported candles), sessions, screenshot captures
 * - LocalStorage drawings across all symbols, indicators, session settings, trade costs, UI preferences
 * - SessionStorage temporary items
 * - Active Zustand stores (drawings, account, replay)
 * - Reloads the page to restart with a clean slate (EURUSD default dataset, fresh balance, clean charts)
 */
export async function resetAllAppData(options: ResetOptions = { reload: true }): Promise<void> {
  // 1. Wipe IndexedDB database tables
  try {
    await clearAllDatabase();
  } catch (error) {
    console.warn('[resetApp] Failed to clear IndexedDB:', error);
  }

  // 2. Wipe LocalStorage & SessionStorage
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
  } catch (error) {
    console.warn('[resetApp] Failed to clear localStorage:', error);
  }

  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.clear();
    }
  } catch (error) {
    console.warn('[resetApp] Failed to clear sessionStorage:', error);
  }

  // 3. Reset in-memory stores
  try {
    useDrawingStore.getState().clearAllSymbolsDrawings();
    useTradeStore.getState().resetAccount();
    useReplayStore.getState().resetReplay();
    useUIStore.getState().closeAllDropdowns();
  } catch (error) {
    console.warn('[resetApp] In-memory store reset failed:', error);
  }

  // 4. Reload the page for a guaranteed 100% clean restart
  if (options.reload) {
    if (typeof window !== 'undefined' && typeof window.location?.reload === 'function') {
      try {
        window.location.reload();
      } catch {
        // Fallback for test environments (e.g. JSDOM where reload is not implemented)
      }
    }
  }
}
