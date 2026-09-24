import { create } from 'zustand';

interface ReplayState {
  isActive: boolean;
  isPicking: boolean;
  isPlaying: boolean;
  currentIndex: number;
  startIndex: number;
  /**
   * Furthest candle the user has revealed since the replay started.
   *
   * Stepping back to review is fine; trading there is not — the user has
   * already seen what comes next. The order entry refuses while
   * `currentIndex < furthestIndex`.
   */
  furthestIndex: number;
  speedMs: number;

  setIsActive: (isActive: boolean) => void;
  setIsPicking: (isPicking: boolean) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  /** Move the cursor. Pass `candleCount` to clamp against the loaded series. */
  setCurrentIndex: (currentIndex: number, candleCount?: number) => void;
  setStartIndex: (startIndex: number, candleCount?: number) => void;
  setSpeedMs: (speedMs: number) => void;
  /** Advance one candle, never past the last one when `candleCount` is given. */
  stepForward: (candleCount?: number) => void;
  stepBackward: () => void;
  resetReplay: () => void;
}

/** Clamp an index into `[0, candleCount - 1]`, tolerating an unknown count. */
function clampIndex(index: number, candleCount?: number): number {
  if (!Number.isFinite(index)) return 0;
  const floored = Math.max(0, Math.floor(index));
  if (candleCount === undefined || !Number.isFinite(candleCount) || candleCount <= 0) {
    return floored;
  }
  return Math.min(floored, candleCount - 1);
}

export const useReplayStore = create<ReplayState>((set) => ({
  isActive: false,
  isPicking: false,
  isPlaying: false,
  currentIndex: 0,
  startIndex: 0,
  furthestIndex: 0,
  speedMs: 500,

  setIsActive: (isActive) => set({ isActive }),
  setIsPicking: (isPicking) => set({ isPicking }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),

  setCurrentIndex: (currentIndex, candleCount) =>
    set((state) => {
      const index = clampIndex(currentIndex, candleCount);
      return { currentIndex: index, furthestIndex: Math.max(state.furthestIndex, index) };
    }),

  /** A new starting point is a new replay: nothing past it has been seen. */
  setStartIndex: (startIndex, candleCount) => {
    const index = clampIndex(startIndex, candleCount);
    set({ startIndex: index, currentIndex: index, furthestIndex: index });
  },

  setSpeedMs: (speedMs) =>
    set({ speedMs: Number.isFinite(speedMs) && speedMs > 0 ? speedMs : 500 }),

  /**
   * Previously unbounded (`currentIndex + 1`). Holding the → key past the last
   * candle grew the index indefinitely: the cursor read `undefined`, the trade
   * panel went blank, and the user had to press ← once per phantom step to get
   * back to real data.
   */
  stepForward: (candleCount) =>
    set((state) => {
      const index = clampIndex(state.currentIndex + 1, candleCount);
      return { currentIndex: index, furthestIndex: Math.max(state.furthestIndex, index) };
    }),

  stepBackward: () =>
    set((state) => ({ currentIndex: Math.max(state.startIndex, state.currentIndex - 1) })),

  resetReplay: () =>
    set({
      isActive: false,
      isPicking: false,
      isPlaying: false,
      currentIndex: 0,
      startIndex: 0,
      furthestIndex: 0,
    }),
}));
