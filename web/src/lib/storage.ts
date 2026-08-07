import { openDB, type IDBPDatabase } from "idb";

export type LocalScan = {
  id?: number;
  timestamp: string;
  rawText?: string;
  batchNo?: string | null;
  mfgDate?: string | null;
  expiryDate?: string | null;
  flavour?: string | null;
  rackNo?: string | null;
  shelfNo?: string | null;
  movement?: string;
  confidence?: Record<string, string>;
  synced?: boolean;
  imageData?: string;
};

const DB_NAME = "LabelScanner";
const STORE = "scans";

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 2, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        }
      },
    });
  }
  return dbPromise;
}

export const Storage = {
  async save(scan: LocalScan) {
    const db = await getDb();
    return db.add(STORE, { synced: false, ...scan });
  },
  async put(scan: LocalScan) {
    if (scan.id == null) throw new Error("Scan id required for put");
    const db = await getDb();
    return db.put(STORE, scan);
  },
  async getAll(): Promise<LocalScan[]> {
    const db = await getDb();
    const all = await db.getAll(STORE);
    return (all as LocalScan[]).reverse();
  },
  async get(id: number): Promise<LocalScan | undefined> {
    const db = await getDb();
    return db.get(STORE, id) as Promise<LocalScan | undefined>;
  },
  async delete(id: number) {
    const db = await getDb();
    await db.delete(STORE, id);
  },
  async clearAll() {
    const db = await getDb();
    await db.clear(STORE);
  },
  async markSynced(id: number) {
    const scan = await this.get(id);
    if (!scan) return;
    await this.put({ ...scan, synced: true });
  },
};
