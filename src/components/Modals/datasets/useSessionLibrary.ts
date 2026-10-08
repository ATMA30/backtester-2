import React, { useEffect, useRef, useState } from 'react';
import { useUIStore } from '../../../store/useUIStore';
import { useMarketStore } from '../../../store/useMarketStore';
import { detachImportedSession, parseBacktestSession } from '../../../domain/session';
import { newId } from '../../../utils/id';
import { useDrawingStore } from '../../../store/useDrawingStore';
import { useTradeStore } from '../../../store/useTradeStore';
import { useReplayStore } from '../../../store/useReplayStore';
import {
  getAllDatasets,
  deleteDataset,
  getAllBacktestSessions,
  saveBacktestSession,
  deleteBacktestSession,
} from '../../../services/db';
import { DatasetMeta, BacktestSession } from '../../../types/market';

/** Plafond d'un fichier de session importé. */
const MAX_SESSION_BYTES = 50 * 1024 * 1024;

/**
 * Saved sessions and cached candle sets: listing them when the dialog opens,
 * saving the current state, restoring, exporting, importing and deleting.
 */
export function useSessionLibrary() {
  const { activeModal, closeModal, showToast } = useUIStore();
  const {
    currentSymbol,
    baseCandles,
    baseTF,
    activeTF,
    setSymbol,
    setBaseCandles,
    setTimeframe,
    triggerFitContent,
  } = useMarketStore();
  const { drawings, restoreDrawings, removeSymbolData } = useDrawingStore();
  const {
    balance,
    initialBalance,
    riskPercent,
    quantity,
    closedPositions,
    openPositions,
    accountCurrency,
    pendingOrders,
    restoreTradeState,
    getMetrics,
  } = useTradeStore();
  const { isActive: isReplayActive, currentIndex: replayIndex, setIsActive: setReplayActive, setCurrentIndex: setReplayCurrentIndex } = useReplayStore();

  const [sessions, setSessions] = useState<BacktestSession[]>([]);
  const [datasets, setDatasets] = useState<DatasetMeta[]>([]);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [sessionNameInput, setSessionNameInput] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (activeModal !== 'datasets') return;
    getAllBacktestSessions().then((s) => {
      setSessions(s);
      setIsCreatingSession(false);
    });
    getAllDatasets().then(setDatasets);
  }, [activeModal]);

  // ── SAUVEGARDER LA SESSION ACTUELLE ─────────────────────────
  const handleSaveCurrentSession = async () => {
    const defaultName = `${currentSymbol} • ${new Date().toLocaleDateString('fr-FR')} ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
    const name = sessionNameInput.trim() || defaultName;
    const metrics = getMetrics();

    const newSession: BacktestSession = {
      id: newId('sess'),
      name,
      symbol: currentSymbol,
      baseTF,
      activeTF,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      replayIndex,
      replayActive: isReplayActive,
      balance,
      initialBalance,
      riskPercent,
      quantity,
      accountCurrency,
      closedPositions,
      openPositions,
      pendingOrders,
      drawings,
      candlesCount: baseCandles.length,
      timeRange:
        baseCandles.length > 0
          ? `${new Date(baseCandles[0].time * 1000).toISOString().slice(0, 10)} -> ${new Date(baseCandles[baseCandles.length - 1].time * 1000).toISOString().slice(0, 10)}`
          : '',
      winRate: metrics.winRate,
      totalPnL: metrics.totalPnL,
      totalTrades: metrics.totalTrades,
      data: baseCandles,
    };

    // Sessions embed the full candle series and routinely weigh several
    // megabytes, so `QuotaExceededError` is a realistic outcome. The result was
    // discarded here — unlike in `handleImportJson` — and the user was told the
    // save had succeeded while nothing had been written.
    const write = await saveBacktestSession(newSession);
    if (!write.ok) {
      showToast(`Sauvegarde impossible : ${write.message}`, 'error', 6000);
      return;
    }

    setSessions((prev) => [newSession, ...prev]);
    setIsCreatingSession(false);
    setSessionNameInput('');
    showToast(`Session "${name}" sauvegardée avec succès !`, 'success', 3500);
  };

  // ── CHARGER UNE SESSION COMPLÈTE ────────────────────────────
  const handleLoadSession = (rawSession: BacktestSession) => {
    const parsed = parseBacktestSession(rawSession);
    if (!parsed) {
      showToast('Session illisible : données corrompues.', 'error', 4000);
      return;
    }
    const session = parsed.session;

    // 1. Restaurer les bougies de marché
    if (session.data && session.data.length > 0) {
      setSymbol(session.symbol);
      setBaseCandles(session.data, session.baseTF);
      setTimeframe(session.activeTF || session.baseTF);
    } else {
      setSymbol(session.symbol);
      setTimeframe(session.activeTF || session.baseTF);
    }

    // 2. Restaurer le Replay
    if (session.replayActive) {
      setReplayActive(true);
      // Clamp against the series that was actually restored: a saved index from
      // a longer dataset would otherwise point past the end.
      setReplayCurrentIndex(session.replayIndex || 0, session.data?.length);
    } else {
      setReplayActive(false);
    }

    // 3. Restaurer les dessins
    restoreDrawings(session.drawings || [], session.symbol);

    // 4. Restaurer le compte de trading
    restoreTradeState({
      balance: session.balance,
      initialBalance: session.initialBalance,
      riskPercent: session.riskPercent,
      quantity: session.quantity,
      accountCurrency: session.accountCurrency,
      closedPositions: session.closedPositions || [],
      // `parseBacktestSession` has already turned a legacy `activePosition`
      // into `openPositions`.
      openPositions: session.openPositions,
      pendingOrders: session.pendingOrders || [],
    }, session.symbol);

    triggerFitContent();
    closeModal();
    showToast(`Session "${session.name}" restaurée avec succès !`, 'success', 3500);
  };

  // ── SUPPRIMER UNE SESSION ───────────────────────────────────
  const handleDeleteSession = async (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation();
    await deleteBacktestSession(id);
    setSessions((prev) => prev.filter((s) => s.id !== id));
    showToast(`Session "${name}" supprimée`, 'info');
  };

  // ── EXPORTER UNE SESSION EN JSON ────────────────────────────
  const handleExportSession = (e: React.MouseEvent, session: BacktestSession) => {
    e.stopPropagation();
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(session, null, 2));
    const a = document.createElement('a');
    a.setAttribute('href', dataStr);
    a.setAttribute('download', `backtest_${session.symbol}_${session.name.replace(/[^a-z0-9]/gi, '_')}.json`);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Le fichier est fait pour être partagé : dire qu'il emporte les notes.
    const annotated = [...session.closedPositions, ...session.openPositions].some((p) => p.annotation);
    showToast(
      annotated
        ? `Session "${session.name}" exportée. Le fichier contient vos notes de journal : relisez-les avant de le partager.`
        : `Session "${session.name}" exportée`,
      'success',
      annotated ? 6000 : 2500
    );
  };

  // ── IMPORTER UNE SESSION JSON ───────────────────────────────
  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Une session embarque au plus 200 000 bougies (~30 Mo de JSON) : au-delà,
    // `readAsText` puis `JSON.parse` matérialisent le fichier deux fois.
    if (file.size > MAX_SESSION_BYTES) {
      showToast(
        `${file.name} fait ${Math.round(file.size / 1_048_576)} Mo : une session dépasse rarement 50 Mo. Ce n’est probablement pas un fichier de session.`,
        'error',
        6000
      );
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        // Session files travel between users, so the payload is untrusted:
        // validate every field before it reaches IndexedDB and the stores.
        const result = parseBacktestSession(JSON.parse(ev.target?.result as string));
        if (!result) {
          showToast('Fichier session JSON invalide', 'error', 4000);
          return;
        }

        const session: BacktestSession = {
          ...detachImportedSession(result.session, () => newId('trade')),
          id: newId('sess'),
          updatedAt: Date.now(),
        };

        const write = await saveBacktestSession(session);
        if (!write.ok) {
          showToast(`Import impossible : ${write.message}`, 'error', 6000);
          return;
        }

        setSessions((prev) => [session, ...prev]);
        showToast(
          result.warnings.length > 0
            ? `Session "${session.name}" importée — ${result.warnings.join(', ')}.`
            : `Session "${session.name}" importée avec succès !`,
          result.warnings.length > 0 ? 'warning' : 'success',
          result.warnings.length > 0 ? 6000 : 3500
        );
      } catch {
        showToast("Erreur lors de l'import de la session", 'error', 4000);
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── GESTION DES DATASETS BRUTS ──────────────────────────────
  const handleLoadDataset = (dataset: DatasetMeta) => {
    if (!dataset.data || dataset.data.length === 0) return;
    useReplayStore.getState().resetReplay();
    setSymbol(dataset.symbol);
    setBaseCandles(dataset.data, dataset.baseTF);
    setTimeframe(dataset.baseTF);
    triggerFitContent();
    closeModal();
    showToast(`${dataset.symbol} : dataset rechargé (${dataset.data.length.toLocaleString()} bougies)`, 'success', 3500);
  };

  const handleDeleteDataset = async (e: React.MouseEvent, symbol: string) => {
    e.stopPropagation();
    if (symbol === currentSymbol) {
      showToast('Impossible de supprimer le dataset actif', 'warning');
      return;
    }
    await deleteDataset(symbol);
    removeSymbolData(symbol);
    setDatasets((prev) => prev.filter((d) => d.symbol !== symbol));
    showToast(`Dataset ${symbol} supprimé`, 'info');
  };

  return {
    sessions, datasets, isCreatingSession, setIsCreatingSession, sessionNameInput, setSessionNameInput, fileInputRef,
    handleSaveCurrentSession, handleLoadSession, handleDeleteSession, handleExportSession, handleImportJson,
    handleLoadDataset, handleDeleteDataset,
  };
}

export type SessionLibrary = ReturnType<typeof useSessionLibrary>;
