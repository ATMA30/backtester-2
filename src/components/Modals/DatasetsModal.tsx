import React, { useEffect, useState, useRef } from 'react';
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

  if (activeModal !== 'datasets') return null;

  // ── SAUVEGARDER LA SESSION ACTUELLE ─────────────────────────
  const handleSaveCurrentSession = async () => {
    const defaultName = `${currentSymbol} • ${new Date().toLocaleDateString('fr-FR')} ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
    const name = sessionNameInput.trim() || defaultName;
    const metrics = getMetrics();

    const newSession: BacktestSession = {
      id: `sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
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

    await saveBacktestSession(newSession);
    setSessions((prev) => [newSession, ...prev]);
    setIsCreatingSession(false);
    setSessionNameInput('');
    showToast(`Session "${name}" sauvegardée avec succès !`, 'success', 3500);
  };

  // ── CHARGER UNE SESSION COMPLÈTE ────────────────────────────
  const handleLoadSession = (session: BacktestSession) => {
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
      setReplayCurrentIndex(session.replayIndex || 0);
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
    });

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

    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string) as BacktestSession;
        if (!parsed.symbol || typeof parsed.balance !== 'number') {
          showToast('Fichier session JSON invalide', 'error');
          return;
        }
        parsed.id = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        parsed.updatedAt = Date.now();
        await saveBacktestSession(parsed);
        setSessions((prev) => [parsed, ...prev]);
        showToast(`Session "${parsed.name}" importée avec succès !`, 'success', 3500);
      } catch {
        showToast("Erreur lors de l'import de la session", 'error');
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── GESTION DES DATASETS BRUTS ──────────────────────────────
  const handleLoadDataset = (dataset: DatasetMeta) => {
    if (!dataset.data || dataset.data.length === 0) return;
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
      className="custom-modal open"
      style={{ display: 'flex', opacity: 1 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) closeModal();
      }}
    >
      <div className="custom-modal-box" style={{ maxWidth: '720px', width: '95%' }}>
        {/* Header */}
        <div className="custom-modal-header" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="custom-modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Database size={16} strokeWidth={2} style={{ color: '#38BDF8' }} />
            <span>Gestionnaire de Sessions &amp; Datasets</span>
          </div>
          <button
            className="custom-modal-close"
            onClick={closeModal}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <X size={15} strokeWidth={2.4} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div
          style={{
            display: 'flex',
            gap: '8px',
            padding: '10px 16px 0 16px',
            background: 'var(--bg-card)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <button
            onClick={() => setActiveTab('sessions')}
            style={{
              padding: '8px 14px',
              borderBottom: activeTab === 'sessions' ? '2px solid var(--accent)' : '2px solid transparent',
              background: 'transparent',
              color: activeTab === 'sessions' ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontWeight: activeTab === 'sessions' ? 600 : 400,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '13px',
            }}
          >
            <Layers size={14} />
            <span>Sessions de Backtest ({sessions.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('datasets')}
            style={{
              padding: '8px 14px',
              borderBottom: activeTab === 'datasets' ? '2px solid var(--accent)' : '2px solid transparent',
              background: 'transparent',
              color: activeTab === 'datasets' ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontWeight: activeTab === 'datasets' ? 600 : 400,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '13px',
            }}
          >
            <Database size={14} />
            <span>Données Brutes ({datasets.length})</span>
          </button>
        </div>

        {/* Body Content */}
        <div className="custom-modal-body" style={{ padding: '16px' }}>
          {activeTab === 'sessions' ? (
            <div>
              {/* Top Action Bar */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '14px',
                  gap: '10px',
                  flexWrap: 'wrap',
                }}
              >
                {!isCreatingSession ? (
                  <button
                    className="btn-sm btn-primary"
                    onClick={() => setIsCreatingSession(true)}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <Save size={14} strokeWidth={2} />
                    <span>Sauvegarder l'état actuel</span>
                  </button>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                    <input
                      type="text"
                      className="form-input"
                      value={sessionNameInput}
                      onChange={(e) => setSessionNameInput(e.target.value)}
                      placeholder={`Nom (ex: ${currentSymbol} SMC Scalping)...`}
                      autoFocus
                      style={{ fontSize: '12px', padding: '6px 10px', flex: 1 }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveCurrentSession();
                        if (e.key === 'Escape') setIsCreatingSession(false);
                      }}
                    />
                    <button
                      className="btn-sm btn-primary"
                      onClick={handleSaveCurrentSession}
                      style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                      <CheckCircle2 size={13} />
                      <span>Valider</span>
                    </button>
                    <button
                      className="btn-sm"
                      onClick={() => setIsCreatingSession(false)}
                      style={{ padding: '6px 8px' }}
                    >
                      Annuler
                    </button>
                  </div>
                )}

                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept=".json"
                    style={{ display: 'none' }}
                    onChange={handleImportJson}
                  />
                  <button
                    className="btn-sm"
                    onClick={() => fileInputRef.current?.click()}
                    title="Importer une session JSON sauvegardée"
                    style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <FileJson size={13} />
                    <span>Importer JSON</span>
                  </button>
                </div>
              </div>

              {/* Sessions List */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  maxHeight: '44vh',
                  overflowY: 'auto',
                  paddingRight: '4px',
                }}
              >
                {sessions.length === 0 ? (
                  <div
                    style={{
                      textAlign: 'center',
                      padding: '30px 20px',
                      color: 'var(--text-secondary)',
                      fontSize: '13px',
                      background: 'var(--bg-elevated)',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px dashed var(--border)',
                    }}
                  >
                    <Layers size={32} strokeWidth={1.5} style={{ opacity: 0.5, marginBottom: '8px' }} />
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                      Aucune session de backtest enregistrée
                    </div>
                    <div style={{ fontSize: '11px', maxWidth: '400px', margin: '0 auto' }}>
                      Cliquez sur <strong>"Sauvegarder l'état actuel"</strong> pour immortaliser votre solde, votre journal de trades, vos positions en cours, vos tracés graphiques et votre position de replay.
                    </div>
                  </div>
                ) : (
                  sessions.map((s) => {
                    const pnl = (s.totalPnL !== undefined ? s.totalPnL : s.balance - s.initialBalance) || 0;
                    const isProfitable = pnl >= 0;
                    const tradeCount = s.closedPositions?.length || s.totalTrades || 0;
                    const drawingsCount = s.drawings?.length || 0;

                    return (
                      <div
                        key={s.id}
                        style={{
                          background: 'var(--bg-elevated)',
                          border: '1px solid var(--border)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '12px 14px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                          transition: 'border-color 0.2s',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <strong style={{ fontSize: '14px', color: 'var(--text-primary)' }}>{s.name}</strong>
                              <span className="badge-type long" style={{ fontSize: '10px', padding: '2px 6px' }}>
                                {s.symbol}
                              </span>
                              {s.replayActive && (
                                <span
                                  style={{
                                    fontSize: '10px',
                                    color: 'var(--gold)',
                                    background: 'rgba(234, 179, 8, 0.1)',
                                    padding: '2px 6px',
                                    borderRadius: '4px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                  }}
                                >
                                  <Play size={9} fill="currentColor" /> Replay #{s.replayIndex}
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                              Sauvegardé le {new Date(s.updatedAt || s.createdAt).toLocaleDateString('fr-FR')} à {new Date(s.updatedAt || s.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>

                          {/* Quick Actions */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <button
                              className="btn-sm btn-primary"
                              onClick={() => handleLoadSession(s)}
                              title="Restaurer entièrement ce backtest"
                              style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 10px' }}
                            >
                              <Play size={11} fill="currentColor" />
                              <span>Charger</span>
                            </button>
                            <button
                              className="tv-icon-btn"
                              onClick={(e) => handleExportSession(e, s)}
                              title="Télécharger la session (JSON)"
                              style={{ width: '28px', height: '28px' }}
                            >
                              <Download size={13} />
                            </button>
                            <button
                              className="tv-icon-btn danger"
                              onClick={(e) => handleDeleteSession(e, s.id, s.name)}
                              title="Supprimer cette session"
                              style={{ width: '28px', height: '28px', color: 'var(--red)' }}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>

                        {/* Session Metrics Bar */}
                        <div
                          style={{
                            display: 'flex',
                            gap: '16px',
                            background: 'var(--bg-card)',
                            padding: '6px 10px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            flexWrap: 'wrap',
                          }}
                        >
                          <div>
                            <span style={{ color: 'var(--text-secondary)' }}>Solde: </span>
                            <strong style={{ fontFamily: 'var(--mono)' }}>${s.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
                          </div>
                          <div>
                            <span style={{ color: 'var(--text-secondary)' }}>P&amp;L: </span>
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
                            <span style={{ color: 'var(--text-secondary)' }}>Trades: </span>
                            <strong style={{ fontFamily: 'var(--mono)' }}>{tradeCount}</strong>
                          </div>
                          {s.winRate !== undefined && tradeCount > 0 && (
                            <div>
                              <span style={{ color: 'var(--text-secondary)' }}>Win Rate: </span>
                              <strong style={{ color: 'var(--gold)', fontFamily: 'var(--mono)' }}>{s.winRate.toFixed(1)}%</strong>
                            </div>
                          )}
                          <div>
                            <span style={{ color: 'var(--text-secondary)' }}>Dessins: </span>
                            <strong style={{ fontFamily: 'var(--mono)' }}>{drawingsCount}</strong>
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  Données de chandeliers brutes stockées en cache local IndexedDB.
                </span>
                <button
                  className="btn-sm btn-primary"
                  onClick={() => {
                    closeModal();
                    openModal('import');
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <UploadCloud size={13} />
                  <span>Importer CSV</span>
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '42vh', overflowY: 'auto' }}>
                {datasets.length === 0 ? (
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', padding: '16px', textAlign: 'center' }}>
                    Aucun dataset brut en cache.
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
                          <strong style={{ fontSize: '13px', fontFamily: 'var(--mono)' }}>{d.symbol}</strong>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                            {d.candlesCount.toLocaleString()} bougies • {d.timeRange || 'Historique'}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span className={`badge-type ${isActive ? 'long' : ''}`}>{isActive ? 'Actif' : 'En cache'}</span>
                          {!isActive && (
                            <button
                              className="btn-sm btn-danger"
                              onClick={(e) => handleDeleteDataset(e, d.symbol)}
                              title="Supprimer ce dataset"
                              style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px' }}
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
        <div className="custom-modal-actions" style={{ borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn-sm" onClick={closeModal}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};
