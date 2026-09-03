import Dexie, { Table } from 'dexie';
import { DatasetMeta, BacktestSession } from '../types/market';

class TradingDB extends Dexie {
  datasets!: Table<DatasetMeta, string>;
  sessions!: Table<BacktestSession, string>;

  constructor() {
    super('tv_pro_db');
    this.version(1).stores({
      datasets: '&symbol, createdAt',
    });
    this.version(2).stores({
      datasets: '&symbol, createdAt',
      sessions: '&id, symbol, updatedAt, createdAt',
    });
  }
}

export const db = new TradingDB();

// ── DATASETS CRUD ──────────────────────────────────────────
export async function saveDataset(meta: DatasetMeta): Promise<void> {
  try {
    await db.datasets.put(meta);
  } catch (e) {
    console.warn('Failed to save dataset to IndexedDB:', e);
  }
}

export async function getDataset(symbol: string): Promise<DatasetMeta | undefined> {
  try {
    return await db.datasets.get(symbol);
  } catch (e) {
    console.warn('Failed to read dataset from IndexedDB:', e);
    return undefined;
  }
}

export async function getAllDatasets(): Promise<DatasetMeta[]> {
  try {
    return await db.datasets.orderBy('createdAt').reverse().toArray();
  } catch (e) {
    console.warn('Failed to list datasets from IndexedDB:', e);
    return [];
  }
}

export async function deleteDataset(symbol: string): Promise<void> {
  try {
    await db.datasets.delete(symbol);
  } catch (e) {
    console.warn('Failed to delete dataset from IndexedDB:', e);
  }
}

// ── BACKTEST SESSIONS CRUD ─────────────────────────────────
export async function saveBacktestSession(session: BacktestSession): Promise<void> {
  try {
    await db.sessions.put(session);
  } catch (e) {
    console.warn('Failed to save session to IndexedDB:', e);
  }
}

export async function getBacktestSession(id: string): Promise<BacktestSession | undefined> {
  try {
    return await db.sessions.get(id);
  } catch (e) {
    console.warn('Failed to read session from IndexedDB:', e);
    return undefined;
  }
}

export async function getAllBacktestSessions(): Promise<BacktestSession[]> {
  try {
    return await db.sessions.orderBy('updatedAt').reverse().toArray();
  } catch (e) {
    console.warn('Failed to list sessions from IndexedDB:', e);
    return [];
  }
}

export async function deleteBacktestSession(id: string): Promise<void> {
  try {
    await db.sessions.delete(id);
  } catch (e) {
    console.warn('Failed to delete session from IndexedDB:', e);
  }
}
