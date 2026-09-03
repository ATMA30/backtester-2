import { create } from 'zustand';

interface ReplayState {
  isActive: boolean;
  isPicking: boolean;
  isPlaying: boolean;
  currentIndex: number;
  startIndex: number;
  speedMs: number;
  
  setIsActive: (isActive: boolean) => void;
  setIsPicking: (isPicking: boolean) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  setCurrentIndex: (currentIndex: number) => void;
  setStartIndex: (startIndex: number) => void;
  setSpeedMs: (speedMs: number) => void;
  stepForward: () => void;
  stepBackward: () => void;
  resetReplay: () => void;
}

export const useReplayStore = create<ReplayState>((set) => ({
  isActive: false,
  isPicking: false,
  isPlaying: false,
  currentIndex: 0,
  startIndex: 0,
  speedMs: 500,

  setIsActive: (isActive) => set({ isActive }),
  setIsPicking: (isPicking) => set({ isPicking }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setCurrentIndex: (currentIndex) => set({ currentIndex }),
  setStartIndex: (startIndex) => set({ startIndex, currentIndex: startIndex }),
  setSpeedMs: (speedMs) => set({ speedMs }),
  stepForward: () => set((state) => ({ currentIndex: state.currentIndex + 1 })),
  stepBackward: () => set((state) => ({ currentIndex: Math.max(state.startIndex, state.currentIndex - 1) })),
  resetReplay: () => set({ isActive: false, isPicking: false, isPlaying: false, currentIndex: 0, startIndex: 0 }),
}));
