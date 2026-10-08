/**
 * Stores exposed on `window.__stores`, in development only, for the
 * end-to-end tests.
 *
 * Replay tests used to wait fixed delays ("play for 800 ms, then check"). On
 * a loaded machine fewer candles went by in that time and the check ran too
 * early. They now wait for what they mean — N candles played — which they read
 * here. `import.meta.env.DEV` is false in production builds: the probe is
 * stripped with the branch.
 */
import { useDrawingStore } from './store/useDrawingStore';
import { useMarketStore } from './store/useMarketStore';
import { useReplayStore } from './store/useReplayStore';
import { useTradeStore } from './store/useTradeStore';

if (import.meta.env.DEV) {
  (window as unknown as { __stores: unknown }).__stores = {
    drawing: useDrawingStore,
    market: useMarketStore,
    replay: useReplayStore,
    trade: useTradeStore,
  };
}
