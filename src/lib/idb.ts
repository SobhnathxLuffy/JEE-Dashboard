// ─── IndexedDB wrapper — the entire "backend" of the app ────────────────────
import { useEffect, useState } from "react";
import type {
  ActiveSession,
  DailyLog,
  FormulaEntry,
  Question,
  ResponseRecord,
  SyllabusRow,
  TestRecord,
} from "./types";

const DB_NAME = "jee-study-app";
const DB_VERSION = 1;

export const STORES = [
  "questions",
  "tests",
  "responses",
  "syllabus",
  "formula",
  "daily_log",
  "kv",
] as const;

export type StoreName = (typeof STORES)[number];

interface KVRow {
  key: string;
  value: unknown;
}

type StoreValueMap = {
  questions: Question;
  tests: TestRecord;
  responses: ResponseRecord;
  syllabus: SyllabusRow;
  formula: FormulaEntry;
  daily_log: DailyLog;
  kv: KVRow;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: name === "kv" ? "key" : "id" });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  fn: (os: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

// ─── change notification (all live hooks refetch on any write) ───────────────
type Listener = () => void;
const listeners = new Set<Listener>();
function notify() {
  listeners.forEach((l) => l());
}

export function subscribeLive(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ─── CRUD ────────────────────────────────────────────────────────────────────
export async function getAll<S extends StoreName>(
  store: S
): Promise<StoreValueMap[S][]> {
  const rows = await tx<StoreValueMap[S][]>(store, "readonly", (os) =>
    os.getAll()
  );
  return rows ?? [];
}

export async function get<S extends StoreName>(
  store: S,
  id: string
): Promise<StoreValueMap[S] | undefined> {
  return tx<StoreValueMap[S] | undefined>(store, "readonly", (os) =>
    os.get(id)
  );
}

export async function put<S extends StoreName>(
  store: S,
  value: StoreValueMap[S]
): Promise<void> {
  await tx(store, "readwrite", (os) => os.put(value));
  notify();
}

export async function bulkPut<S extends StoreName>(
  store: S,
  values: StoreValueMap[S][]
): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(store, "readwrite");
    const os = t.objectStore(store);
    for (const v of values) os.put(v);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
  notify();
}

export async function del(store: StoreName, id: string): Promise<void> {
  await tx(store, "readwrite", (os) => os.delete(id));
  notify();
}

export async function clearStore(store: StoreName): Promise<void> {
  await tx(store, "readwrite", (os) => os.clear());
  notify();
}

export async function wipeAll(): Promise<void> {
  for (const s of STORES) {
    await clearStore(s);
  }
}

// ─── kv helpers (active session etc.) ───────────────────────────────────────
export async function kvGet<T>(key: string): Promise<T | undefined> {
  const row = await get("kv", key);
  return row ? (row.value as T) : undefined;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await put("kv", { key, value } as KVRow);
}

export async function kvDel(key: string): Promise<void> {
  await del("kv", key);
}

// ─── session helpers ─────────────────────────────────────────────────────────
export async function saveSession(s: ActiveSession): Promise<void> {
  await kvSet("active-session", s);
}

export async function loadSession(): Promise<ActiveSession | undefined> {
  const s = await kvGet<ActiveSession>("active-session");
  return s;
}

export async function clearSession(): Promise<void> {
  await kvDel("active-session");
}

// ─── live hook ───────────────────────────────────────────────────────────────
export function useLive<S extends StoreName>(store: S): StoreValueMap[S][] {
  const [rows, setRows] = useState<StoreValueMap[S][]>([]);
  useEffect(() => {
    let alive = true;
    const refetch = () => {
      getAll(store).then((r) => {
        if (alive) setRows(r);
      });
    };
    refetch();
    const unsub = subscribeLive(refetch);
    return () => {
      alive = false;
      unsub();
    };
  }, [store]);
  return rows;
}

/** Re-render on any data change anywhere (for cross-store views). */
export function useDataVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    const unsub = subscribeLive(() => setV((x) => x + 1));
    return () => {
      unsub();
    };
  }, []);
  return v;
}
