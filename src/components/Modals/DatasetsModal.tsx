import React, { useEffect, useState, useRef } from 'react';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import {
  Database,
  X,
  Trash2,
  UploadCloud,
  Save,
  Download,
  Play,
  CheckCircle2,
  Layers,
  FileJson,
} from 'lucide-react';
import { useUIStore } from '../../store/useUIStore';
import { useMarketStore } from '../../store/useMarketStore';
import { parseBacktestSession } from '../../domain/session';
import { newId } from '../../utils/id';
import { useDrawingStore } from '../../store/useDrawingStore';
import { useTradeStore } from '../../store/useTradeStore';
import { useReplayStore } from '../../store/useReplayStore';
import {
  getAllDatasets,
  deleteDataset,
  getAllBacktestSessions,
  saveBacktestSession,
  deleteBacktestSession,
} from '../../services/db';
import { DatasetMeta, BacktestSession } from '../../types/market';

/** Plafond d'un fichier de session importé. */
const MAX_SESSION_BYTES = 50 * 1024 * 1024;

export const DatasetsModal: React.FC = () => {
  const { activeModal, closeModal, openModal, showToast } = useUIStore();
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
    activePosition,
    pendingOrders,
    restoreTradeState,
    getMetrics,
  } = useTradeStore();
  const { isActive: isReplayActive, currentIndex: replayIndex, setIsActive: setReplayActive, setCurrentIndex: setReplayCurrentIndex } = useReplayStore();

  const [activeTab, setActiveTab] = useState<'sessions' | 'datasets'>('sessions');
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

  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, activeModal === 'datasets');

  if (activeModal !== 'datasets') return null;

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
      closedPositions,
      activePosition,
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
      closedPositions: session.closedPositions || [],
      activePosition: session.activePosition || null,
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
    showToast(`Session "${session.name}" exportée`, 'success', 2500);
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
          ...result.session,
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

  return (
    <div
      id="datasets-modal"
      className="custom-modal open u-display-flex u-opacity-1"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeModal();
      }}
    >
      <div className="custom-modal-box u-max-width-720px u-width-95pct" ref={dialogRef} role="dialog" aria-modal="true" aria-label="Données et sessions">
        {/* Header */}
        <div className="custom-modal-header u-border-bottom-1px-solid-border">
          <div className="custom-modal-title u-display-flex u-align-items-center u-gap-8px">
            <Database size={16} strokeWidth={2} className="u-color-38bdf8" />
            <span>Sauvegardes et jeux de données</span>
          </div>
          <button
            className="custom-modal-close u-display-flex u-align-items-center u-justify-content-center"
            onClick={closeModal}
          >
            <X size={15} strokeWidth={2.4} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="u-padding-12px-16px u-border-bottom-1px-solid-border"
        >
          <div className="seg-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'sessions'}
              className={`seg-tab ${activeTab === 'sessions' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('sessions')}
            >
              <Layers size={13} />
              <span>Sessions sauvegardées</span>
              <span className="seg-tab-count">{sessions.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'datasets'}
              className={`seg-tab ${activeTab === 'datasets' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('datasets')}
            >
              <Database size={13} />
              <span>Jeux de bougies</span>
              <span className="seg-tab-count">{datasets.length}</span>
            </button>
          </div>
        </div>

        {/* Body Content */}
        <div className="custom-modal-body u-padding-16px">
          {activeTab === 'sessions' ? (
            <div>
              {/* Top Action Bar */}
              <div className="modal-toolbar">
                {!isCreatingSession ? (
                  // Quand la liste est vide, l'action principale vit dans
                  // l'état vide : la répéter ici ferait deux fois le même
                  // appel à l'action dans un écran qui n'a rien à montrer.
                  sessions.length > 0 && (
                    <button
                      className="btn-sm btn-primary u-display-flex u-align-items-center u-gap-6px"
                      onClick={() => setIsCreatingSession(true)}
                    >
                      <Save size={14} strokeWidth={2} />
                      <span>Enregistrer la session</span>
                    </button>
                  )
                ) : (
                  <div className="u-display-flex u-align-items-center u-gap-8px u-flex-1">
                    <input
                      type="text"
                      className="form-input u-font-size-12px u-padding-6px-10px u-flex-1"
                      value={sessionNameInput}
                      onChange={(e) => setSessionNameInput(e.target.value)}
                      placeholder={`Nommez cette session — ex. ${currentSymbol} scalping Londres`}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveCurrentSession();
                        if (e.key === 'Escape') setIsCreatingSession(false);
                      }}
                    />
                    <button
                      className="btn-sm btn-primary u-display-flex u-align-items-center u-gap-4px"
                      onClick={handleSaveCurrentSession}
                    >
                      <CheckCircle2 size={13} />
                      <span>Enregistrer</span>
                    </button>
                    <button
                      className="btn-sm u-padding-6px-8px"
                      onClick={() => setIsCreatingSession(false)}
                    >
                      Annuler
                    </button>
                  </div>
                )}

                <div className="u-display-flex u-gap-8px">
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept=".json" className="u-display-none"
                    onChange={handleImportJson}
                  />
                  <button
                    className="btn-sm btn-ghost u-display-flex u-align-items-center u-gap-6px"
                    onClick={() => fileInputRef.current?.click()}
                    title="Importer une sauvegarde"
                  >
                    <FileJson size={13} />
                    <span>Importer</span>
                  </button>
                </div>
              </div>

              {/* Sessions List */}
              <div className="u-display-flex u-flex-direction-column u-gap-10px u-max-height-44vh u-overflow-y-auto u-padding-right-4px"
              >
                {sessions.length === 0 ? (
                  <div className="modal-empty">
                    <Layers size={30} strokeWidth={1.5} className="modal-empty-icon" aria-hidden />
                    <div className="modal-empty-title">Aucune session enregistrée</div>
                    <p className="modal-empty-text">
                      Sauvegardez l’état de votre graphique, vos indicateurs et vos positions en
                      cours pour les retrouver plus tard.
                    </p>
                    <button
                      className="btn-sm btn-primary u-display-flex u-align-items-center u-gap-6px"
                      onClick={() => setIsCreatingSession(true)}
                    >
                      <Save size={13} strokeWidth={2} />
                      <span>Enregistrer maintenant</span>
                    </button>
                  </div>
                ) : (
                  sessions.map((s) => {
                    const pnl = (s.totalPnL !== undefined ? s.totalPnL : s.balance - s.initialBalance) || 0;
                    const isProfitable = pnl >= 0;
                    const tradeCount = s.closedPositions?.length || s.totalTrades || 0;
                    const drawingsCount = s.drawings?.length || 0;

                    return (
                      <div
                        key={s.id} className="u-background-bg-elevated u-border-1px-solid-border u-border-radius-radius-sm u-padding-12px-14px u-display-flex u-flex-direction-column u-gap-8px u-transition-border-color-0_2s"
                      >
                        <div className="u-display-flex u-justify-content-space-between u-align-items-flex-start">
                          <div>
                            <div className="u-display-flex u-align-items-center u-gap-8px">
                              <strong className="u-font-size-14px u-color-text-primary">{s.name}</strong>
                              <span className="badge-type long u-font-size-10px u-padding-2px-6px">
                                {s.symbol}
                              </span>
                              {s.replayActive && (
                                <span className="u-font-size-10px u-color-gold u-background-rgba-234-179-8-0_1 u-padding-2px-6px u-border-radius-4px u-display-flex u-align-items-center u-gap-3px"
                                >
                                  <Play size={9} fill="currentColor" /> Replay #{s.replayIndex}
                                </span>
                              )}
                            </div>
                            <div className="u-font-size-11px u-color-text-secondary u-margin-top-2px">
                              Sauvegardé le {new Date(s.updatedAt || s.createdAt).toLocaleDateString('fr-FR')} à {new Date(s.updatedAt || s.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>

                          {/* Quick Actions */}
                          <div className="u-display-flex u-align-items-center u-gap-6px">
                            <button
                              className="btn-sm btn-primary u-display-flex u-align-items-center u-gap-4px u-padding-4px-10px"
                              onClick={() => handleLoadSession(s)}
                              title="Reprendre ce backtest"
                            >
                              <Play size={11} fill="currentColor" />
                              <span>Reprendre</span>
                            </button>
                            <button
                              className="tv-icon-btn u-width-28px u-height-28px"
                              onClick={(e) => handleExportSession(e, s)}
                              title="Exporter cette sauvegarde"
                            >
                              <Download size={13} />
                            </button>
                            <button
                              className="tv-icon-btn danger u-width-28px u-height-28px u-color-red"
                              onClick={(e) => handleDeleteSession(e, s.id, s.name)}
                              title="Supprimer cette sauvegarde"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>

                        {/* Session Metrics Bar */}
                        <div className="u-display-flex u-gap-16px u-background-bg-card u-padding-6px-10px u-border-radius-4px u-font-size-11px u-flex-wrap-wrap"
                        >
                          <div>
                            <span className="u-color-text-secondary">Solde </span>
                            <strong className="u-font-family-mono">${s.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
                          </div>
                          <div>
                            <span className="u-color-text-secondary">Résultat </span>
                            <strong
                              style={{
                                color: isProfitable ? 'var(--green)' : 'var(--red)',
                                fontFamily: 'var(--mono)',
                              }}
                            >
                              {isProfitable ? '+' : ''}${pnl.toFixed(2)}
                            </strong>
                          </div>
                          <div>
                            <span className="u-color-text-secondary">Trades </span>
                            <strong className="u-font-family-mono">{tradeCount}</strong>
                          </div>
                          {s.winRate !== undefined && tradeCount > 0 && (
                            <div>
                              <span className="u-color-text-secondary">Réussite </span>
                              <strong className="u-color-gold u-font-family-mono">{s.winRate.toFixed(1)}%</strong>
                            </div>
                          )}
                          <div>
                            <span className="u-color-text-secondary">Tracés </span>
                            <strong className="u-font-family-mono">{drawingsCount}</strong>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ) : (
            /* Datasets Tab */
            <div className="u-display-flex u-flex-direction-column u-gap-10px">
              <div className="u-display-flex u-justify-content-space-between u-align-items-center u-margin-bottom-6px">
                <span className="u-font-size-12px u-color-text-secondary">
                  Données de chandeliers brutes stockées en cache local IndexedDB.
                </span>
                <button
                  className="btn-sm btn-primary u-display-flex u-align-items-center u-gap-6px"
                  onClick={() => {
                    closeModal();
                    openModal('import');
                  }}
                >
                  <UploadCloud size={13} />
                  <span>Importer un fichier</span>
                </button>
              </div>

              <div className="u-display-flex u-flex-direction-column u-gap-8px u-max-height-42vh u-overflow-y-auto">
                {datasets.length === 0 ? (
                  <div className="modal-empty">
                    <Database size={30} strokeWidth={1.5} className="modal-empty-icon" aria-hidden />
                    <div className="modal-empty-title">Aucun jeu de bougies</div>
                    <p className="modal-empty-text">
                      Importez un fichier CSV ou JSON pour conserver ses bougies en cache et les
                      recharger sans réseau.
                    </p>
                    <button
                      className="btn-sm btn-primary u-display-flex u-align-items-center u-gap-6px"
                      onClick={() => {
                        closeModal();
                        openModal('import');
                      }}
                    >
                      <UploadCloud size={13} strokeWidth={2} />
                      <span>Importer un fichier</span>
                    </button>
                  </div>
                ) : (
                  datasets.map((d) => {
                    const isActive = d.symbol === currentSymbol;
                    return (
                      <div
                        key={d.symbol}
                        className={`pair-card ${isActive ? 'selected' : ''}`}
                        onClick={() => !isActive && handleLoadDataset(d)}
                        style={{
                          background: isActive ? 'rgba(59, 130, 246, 0.15)' : 'var(--bg-elevated)',
                          border: isActive ? '1px solid var(--accent)' : '1px solid var(--border)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '12px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          cursor: isActive ? 'default' : 'pointer',
                        }}
                      >
                        <div>
                          <strong className="u-font-size-13px u-font-family-mono">{d.symbol}</strong>
                          <div className="u-font-size-11px u-color-text-secondary">
                            {d.candlesCount.toLocaleString()} bougies • {d.timeRange || 'Historique'}
                          </div>
                        </div>
                        <div className="u-display-flex u-align-items-center u-gap-8px">
                          <span className={`badge-type ${isActive ? 'long' : ''}`}>{isActive ? 'Actif' : 'En cache'}</span>
                          {!isActive && (
                            <button
                              className="btn-sm btn-danger u-display-flex u-align-items-center u-gap-4px u-padding-4px-8px"
                              onClick={(e) => handleDeleteDataset(e, d.symbol)}
                              title="Supprimer ce jeu de données"
                            >
                              <Trash2 size={12} strokeWidth={2} />
                              <span>Supprimer</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
      </div>
    </div>
  );
};
