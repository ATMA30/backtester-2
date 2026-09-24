import { create } from 'zustand';
import { newId } from '../utils/id';
import { IndicatorKind } from '../types/market';
import { TimeframeCoverage } from '../domain/timeframe-coverage';

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

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  readonly id: string;
  readonly message: string;
  readonly type: ToastType;
  /**
   * Combien de temps le toast reste à l'écran, en millisecondes.
   *
   * Porté par la donnée pour que la barre de progression dure exactement ce que
   * dure le toast. La feuille de style codait quatre durées en dur (4 s, 5 s,
   * 4 s, 3,5 s) alors que les appelants passent de 2 000 à 8 000 ms : la barre
   * finissait sa course bien avant, ou restait pleine à la disparition.
   */
  readonly durationMs: number;
}

const DEFAULT_TOAST_MS = 3_000;
/** Cap the stack so a burst cannot push older toasts off-screen indefinitely. */
const MAX_TOASTS = 5;

interface UIState {
  activeModal: ModalType;
  activeDropdown: string | null;
  selectedIndicatorType: IndicatorKind | null;
  snapshotDataUrl: string | null;
  toasts: Toast[];
  /**
   * Pourquoi la dernière demande d'unité de temps a été refusée.
   *
   * Hors de `ModalType` : ce n'est pas une modale qu'on ouvre, c'est un
   * diagnostic qui, quand il existe, doit être expliqué. Le porter comme une
   * donnée évite de reconstruire les faits dans le composant.
   */
  timeframeCoverage: TimeframeCoverage | null;

  openModal: (modal: ModalType) => void;
  closeModal: () => void;
  setTimeframeCoverage: (coverage: TimeframeCoverage | null) => void;
  toggleDropdown: (id: string) => void;
  closeAllDropdowns: () => void;
  setSelectedIndicatorType: (type: IndicatorKind | null) => void;
  setSnapshotDataUrl: (url: string | null) => void;
  showToast: (message: string, type?: ToastType, duration?: number) => string;
  removeToast: (id: string) => void;
  clearToasts: () => void;
}

/** Pending dismissal timers, so they can be cancelled on manual removal. */
const dismissTimers = new Map<string, ReturnType<typeof setTimeout>>();

function cancelTimer(id: string): void {
  const timer = dismissTimers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    dismissTimers.delete(id);
  }
}

export const useUIStore = create<UIState>((set, get) => ({
  activeModal: null,
  activeDropdown: null,
  selectedIndicatorType: null,
  snapshotDataUrl: null,
  toasts: [],
  timeframeCoverage: null,

  openModal: (modal) => set({ activeModal: modal, activeDropdown: null }),
  closeModal: () => set({ activeModal: null }),

  setTimeframeCoverage: (timeframeCoverage) => set({ timeframeCoverage }),

  toggleDropdown: (id) =>
    set((state) => ({ activeDropdown: state.activeDropdown === id ? null : id })),

  closeAllDropdowns: () => set({ activeDropdown: null }),
  setSelectedIndicatorType: (selectedIndicatorType) => set({ selectedIndicatorType }),
  setSnapshotDataUrl: (snapshotDataUrl) => set({ snapshotDataUrl }),

  showToast: (message, type = 'info', duration = DEFAULT_TOAST_MS) => {
    const id = newId('toast');

    set((state) => {
      const next = [...state.toasts, { id, message, type, durationMs: duration }];
      // Drop the oldest beyond the cap, cancelling their timers as we go.
      while (next.length > MAX_TOASTS) {
        const evicted = next.shift();
        if (evicted) cancelTimer(evicted.id);
      }
      return { toasts: next };
    });

    dismissTimers.set(
      id,
      setTimeout(() => {
        dismissTimers.delete(id);
        get().removeToast(id);
      }, duration)
    );

    return id;
  },

  removeToast: (id) => {
    cancelTimer(id);
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },

  clearToasts: () => {
    for (const timer of dismissTimers.values()) clearTimeout(timer);
    dismissTimers.clear();
    set({ toasts: [] });
  },
}));
