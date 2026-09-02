// ========================================================
//  DB — IndexedDB Asynchronous Storage for Datasets & Sessions
//  High-performance, non-blocking storage for large CSV/JSON sets
// ========================================================

const DB_NAME = "TradeViewPro_DB";
const DB_VERSION = 1;
const STORE_DATASETS = "datasets";
const STORE_SESSIONS = "sessions";

let _dbInstance = null;

function getDB() {
  if (_dbInstance) return Promise.resolve(_dbInstance);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => {
      console.error("IndexedDB error:", request.error);
      reject(request.error);
    };
    request.onsuccess = () => {
      _dbInstance = request.result;
      resolve(_dbInstance);
    };
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_DATASETS)) {
        const dsStore = db.createObjectStore(STORE_DATASETS, { keyPath: "id" });
        dsStore.createIndex("symbol", "symbol", { unique: false });
        dsStore.createIndex("updatedAt", "updatedAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
        const sessStore = db.createObjectStore(STORE_SESSIONS, { keyPath: "id" });
        sessStore.createIndex("updatedAt", "updatedAt", { unique: false });
      }
    };
  });
}

// ── DATASET OPERATIONS ────────────────────────────────────
async function dbSaveDataset(dataset) {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_DATASETS, "readwrite");
      const store = tx.objectStore(STORE_DATASETS);
      const record = {
        id: dataset.id || `ds_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        symbol: dataset.symbol || "UNKNOWN",
        name: dataset.name || dataset.symbol || "Dataset",
        candleCount: dataset.candles ? dataset.candles.length : 0,
        baseTF: dataset.baseTF || 86400,
        candles: dataset.candles || [],
        updatedAt: Date.now(),
      };
      const req = store.put(record);
      req.onsuccess = () => resolve(record);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error("Failed to save dataset in IndexedDB:", err);
    throw err;
  }
}

async function dbGetDataset(id) {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_DATASETS, "readonly");
      const store = tx.objectStore(STORE_DATASETS);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error("Failed to get dataset:", err);
    return null;
  }
}

async function dbListDatasets() {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_DATASETS, "readonly");
      const store = tx.objectStore(STORE_DATASETS);
      const req = store.getAll();
      req.onsuccess = () => {
        // Return summary without heavy candles array to save memory
        const list = (req.result || []).map((ds) => ({
          id: ds.id,
          symbol: ds.symbol,
          name: ds.name,
          candleCount: ds.candleCount,
          baseTF: ds.baseTF,
          updatedAt: ds.updatedAt,
        }));
        list.sort((a, b) => b.updatedAt - a.updatedAt);
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error("Failed to list datasets:", err);
    return [];
  }
}

async function dbDeleteDataset(id) {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_DATASETS, "readwrite");
      const store = tx.objectStore(STORE_DATASETS);
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error("Failed to delete dataset:", err);
    return false;
  }
}

// ── SESSION OPERATIONS ────────────────────────────────────
async function dbSaveSession(sessionData = {}) {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SESSIONS, "readwrite");
      const store = tx.objectStore(STORE_SESSIONS);
      const record = {
        id: sessionData.id || "active_session",
        name: sessionData.name || (sessionData.id === "active_session" ? "Session active" : `Session ${currentSymbol}`),
        symbol: currentSymbol,
        activeTF,
        activeTFType,
        drawings: drawings || [],
        customIndicators: (customIndicators || []).map((ind) => ({
          id: ind.id,
          type: ind.type,
          period: ind.period,
          color: ind.color,
          fastP: ind.fastP,
          slowP: ind.slowP,
          signalP: ind.signalP,
          multiplier: ind.multiplier,
        })),
        tradeSim: {
          balance: tradeSim.balance,
          positions: tradeSim.positions.map((p) => ({
            id: p.id,
            type: p.type,
            entry: p.entry,
            sl: p.sl,
            tp: p.tp,
            qty: p.qty,
            time: p.time,
          })),
          pendingOrders: tradeSim.pendingOrders.map((p) => ({
            id: p.id,
            type: p.type,
            entry: p.entry,
            sl: p.sl,
            tp: p.tp,
            qty: p.qty,
            time: p.time,
          })),
          history: tradeSim.history || [],
        },
        replay: {
          active: replay.active,
          idx: replay.idx,
          startIdx: replay.startIdx,
          speed: replay.speed,
        },
        activeDatasetId: window._currentDatasetId || null,
        updatedAt: Date.now(),
        ...sessionData,
      };
      const req = store.put(record);
      req.onsuccess = () => resolve(record);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("Session save failed:", err);
  }
}

async function dbLoadSession(id = "active_session") {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SESSIONS, "readonly");
      const store = tx.objectStore(STORE_SESSIONS);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("Session load failed:", err);
    return null;
  }
}

async function dbListSessions() {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SESSIONS, "readonly");
      const store = tx.objectStore(STORE_SESSIONS);
      const req = store.getAll();
      req.onsuccess = () => {
        const list = (req.result || []).map((s) => ({
          id: s.id,
          name: s.name || s.id,
          symbol: s.symbol,
          tradeCount: s.tradeSim ? s.tradeSim.history.length : 0,
          drawingsCount: s.drawings ? s.drawings.length : 0,
          balance: s.tradeSim ? s.tradeSim.balance : 10000,
          totalPnl: s.tradeSim && s.tradeSim.history.length ? s.tradeSim.history.reduce((a, b) => a + (b.pnl || 0), 0) : 0,
          updatedAt: s.updatedAt,
        }));
        list.sort((a, b) => b.updatedAt - a.updatedAt);
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error("Failed to list sessions:", err);
    return [];
  }
}

async function dbDeleteSession(id) {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SESSIONS, "readwrite");
      const store = tx.objectStore(STORE_SESSIONS);
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error("Failed to delete session:", err);
    return false;
  }
}

