import Dexie, { Table } from 'dexie';
import { DatasetMeta } from '../types/market';

class TradingDB extends Dexie {
  datasets!: Table<DatasetMeta, string>;

  constructor() {
    super('tv_pro_db');
    this.version(1).stores({
      datasets: '&symbol, createdAt',
    });
  }
}

export const db = new TradingDB();

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
