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

/**
 * Outcome of a write.
 *
 * Writes used to return `void` and swallow every failure into a `console.warn`.
 * Datasets here weigh several megabytes, so `QuotaExceededError` is a realistic
 * outcome — and the user was never told their work had not been saved.
 */
export type WriteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'quota' | 'unavailable' | 'unknown'; readonly message: string };

function classify(error: unknown): WriteResult {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);

  if (name === 'QuotaExceededError' || /quota/i.test(message)) {
    return {
      ok: false,
      reason: 'quota',
      message: 'Espace de stockage local saturé : supprimez des jeux de données pour libérer de la place.',
    };
  }
  if (name === 'InvalidStateError' || /database|indexeddb/i.test(message)) {
    return {
      ok: false,
      reason: 'unavailable',
      message: 'Stockage local indisponible (navigation privée ou stockage désactivé).',
    };
  }
  return { ok: false, reason: 'unknown', message };
}

const SUCCESS: WriteResult = { ok: true };

async function write(operation: () => Promise<unknown>, context: string): Promise<WriteResult> {
  try {
    await operation();
    return SUCCESS;
  } catch (error) {
    console.warn(`[db] ${context} failed:`, error);
    return classify(error);
  }
}

async function read<T>(operation: () => Promise<T>, fallback: T, context: string): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    console.warn(`[db] ${context} failed:`, error);
    return fallback;
  }
}

// ── DATASETS ──────────────────────────────────────────────────
export function saveDataset(meta: DatasetMeta): Promise<WriteResult> {
  return write(() => db.datasets.put(meta), `save dataset ${meta.symbol}`);
}

/**
 * Cache a provider series, unless the slot holds a file the user imported.
 *
 * Datasets are keyed by symbol. Loading EURUSD from the catalogue after
 * importing one's own `EURUSD.csv` overwrote the file — and the next session
 * restore silently brought back the provider data instead.
 */
export function saveProviderDataset(meta: DatasetMeta): Promise<WriteResult> {
  return write(
    () =>
      db.transaction('rw', db.datasets, async () => {
        const existing = await db.datasets.get(meta.symbol);
        if (existing?.source === 'import') return;
        await db.datasets.put({ ...meta, source: 'provider' });
      }),
    `save provider dataset ${meta.symbol}`
  );
}

export function getDataset(symbol: string): Promise<DatasetMeta | undefined> {
  return read(() => db.datasets.get(symbol), undefined, `read dataset ${symbol}`);
}

export function getAllDatasets(): Promise<DatasetMeta[]> {
  return read(() => db.datasets.orderBy('createdAt').reverse().toArray(), [], 'list datasets');
}

export function deleteDataset(symbol: string): Promise<WriteResult> {
  return write(() => db.datasets.delete(symbol), `delete dataset ${symbol}`);
}

// ── BACKTEST SESSIONS ─────────────────────────────────────────
export function saveBacktestSession(session: BacktestSession): Promise<WriteResult> {
  return write(() => db.sessions.put(session), `save session ${session.id}`);
}

export function getBacktestSession(id: string): Promise<BacktestSession | undefined> {
  return read(() => db.sessions.get(id), undefined, `read session ${id}`);
}

export function getAllBacktestSessions(): Promise<BacktestSession[]> {
  return read(() => db.sessions.orderBy('updatedAt').reverse().toArray(), [], 'list sessions');
}

export function deleteBacktestSession(id: string): Promise<WriteResult> {
  return write(() => db.sessions.delete(id), `delete session ${id}`);
}
