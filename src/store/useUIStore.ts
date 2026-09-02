import { create } from 'zustand';

export type ModalType =
  | 'import'
  | 'live'
  | 'datasets'
  | 'indicators'
  | 'indicator-config'
  | 'trade-history'
  | 'snapshot'
  | 'shortcuts'
  | null;

interface UIState {
  activeModal: ModalType;
  activeDropdown: string | null;
  selectedIndicatorType: 'SMA' | 'EMA' | 'RSI' | 'MACD' | 'BB' | 'VWAP' | null;
  snapshotDataUrl: string | null;
  toasts: Array<{ id: string; message: string; type: 'info' | 'success' | 'warning' | 'error' }>;

  openModal: (modal: ModalType) => void;
  closeModal: () => void;
  toggleDropdown: (id: string) => void;
  closeAllDropdowns: () => void;
  setSelectedIndicatorType: (type: 'SMA' | 'EMA' | 'RSI' | 'MACD' | 'BB' | 'VWAP' | null) => void;
  setSnapshotDataUrl: (url: string | null) => void;
  showToast: (message: string, type?: 'info' | 'success' | 'warning' | 'error', duration?: number) => void;
  removeToast: (id: string) => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  activeModal: null,
  activeDropdown: null,
  selectedIndicatorType: null,
  snapshotDataUrl: null,
  toasts: [],

  openModal: (modal) => set({ activeModal: modal, activeDropdown: null }),
  closeModal: () => set({ activeModal: null }),
  toggleDropdown: (id) =>
    set((state) => ({ activeDropdown: state.activeDropdown === id ? null : id })),
  closeAllDropdowns: () => set({ activeDropdown: null }),
  setSelectedIndicatorType: (type) => set({ selectedIndicatorType: type }),
  setSnapshotDataUrl: (snapshotDataUrl) => set({ snapshotDataUrl }),

  showToast: (message, type = 'info', duration = 3000) => {
    const id = 'toast_' + Date.now() + '_' + Math.random().toString(36).substring(2, 5);
    set((state) => ({ toasts: [...state.toasts, { id, message, type }] }));
    setTimeout(() => {
      get().removeToast(id);
    }, duration);
  },

  removeToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },
}));
