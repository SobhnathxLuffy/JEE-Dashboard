// ─── IndexedDB wrapper — the entire "backend" of the app ────────────────────
import { useEffect, useState } from "react";
import type {
  ActiveSession,
  AiCacheRecord,
  AiUsageRecord,
  CalEventRecord,
  DailyLog,
  FormulaEntry,
  PaperRecord,
  Question,
  ResponseRecord,
  SyllabusRow,
  Task,
  TestRecord,
} from "./types";

const DB_NAME_BASE = "jee-study-app";
// v5: adds "ai_cache" (explanations / coach reports — re-views never re-bill)
// and "ai_usage" (per-call token + ₹ estimate log). onupgradeneeded creates
// any missing store from STORES, so v1–v4 installs upgrade in place — no
// data loss.
// v6: adds "sync_tombstones" — delete markers the sync engine replays so a
// deletion on one device removes the record on every other device.
const DB_VERSION = 6;

// ?device=<name> opens a separate IndexedDB under the same origin — used by
// the two-tab sync E2E (two "devices" in one browser) and by anyone who wants
// an isolated scratch profile. Invisible in normal use. Sync state that
// logically belongs to the database (pull/push cursors) keys off this too.
const DB_DEVICE = (() => {
  if (typeof window === "undefined") return null;
  try {
    const d = new URLSearchParams(window.location.search).get("device");
    return d && /^[a-z0-9-]{1,24}$/i.test(d) ? d.toLowerCase() : null;
  } catch {
    return null;
  }
})();

const DB_NAME = DB_DEVICE ? `${DB_NAME_BASE}-${DB_DEVICE}` : DB_NAME_BASE;

/** Identity of THIS device's database — sync cursors are namespaced with it. */
export const DB_DEVICE_ID = DB_DEVICE;

export const STORES = [
  "questions",
  "tests",
  "responses",
  "syllabus",
  "formula",
  "daily_log",
  "kv",
  "papers",
  "tasks",
  "cal_events",
  "ai_cache",
  "ai_usage",
  "sync_tombstones",
] as const;

export type StoreName = (typeof STORES)[number];

/**
 * Stores replicated by the optional Supabase sync. Papers sync WITH their
 * PDF as a base64 data URL (codec in sync.ts) up to ~4.8 MB — bigger PDFs
 * travel metadata-only and stay re-uploadable. kv / ai_* are device-local by
 * design (session state, provider keys, token accounting).
 */
export const SYNCED_STORES = [
  "questions",
  "tests",
  "responses",
  "syllabus",
  "formula",
  "daily_log",
  "tasks",
  "cal_events",
  "papers",
] as const;

type SyncedStore = (typeof SYNCED_STORES)[number];

export function isSyncedStore(s: StoreName): s is SyncedStore {
  return (SYNCED_STORES as readonly string[]).includes(s);
}

/** Delete marker — replayed by the sync engine so deletes propagate. */
export interface TombstoneRow {
  key: string; // `${store}:${id}`
  store: SyncedStore;
  id: string;
  deleted_at: number; // epoch ms — doubles as the row's updated_at upstream
}

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
  papers: PaperRecord;
  tasks: Task;
  cal_events: CalEventRecord;
  ai_cache: AiCacheRecord;
  ai_usage: AiUsageRecord;
  sync_tombstones: TombstoneRow;
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

/**
 * Sync timestamp policy for synced stores:
 *  - default (touch): every app write bumps `updated_at` → the sync engine
 *    sees it as a change to push.
 *  - `{ touch: false }`: keeps the incoming stamp and only stamps if missing —
 *    used by the sync engine (applying remote rows must not re-stamp, or
 *    changes ping-pong forever) and by backup restore (a backup is history,
 *    not a new edit).
 */
export interface PutOptions {
  touch?: boolean;
}

function stamp<T>(store: StoreName, value: T, opts?: PutOptions): T {
  if (!isSyncedStore(store)) return value;
  const rec = value as { updated_at?: number };
  if (opts?.touch === false) {
    if (typeof rec.updated_at !== "number") rec.updated_at = Date.now();
  } else {
    rec.updated_at = Date.now();
  }
  return value;
}

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
  value: StoreValueMap[S],
  opts?: PutOptions
): Promise<void> {
  await tx(store, "readwrite", (os) => os.put(stamp(store, value, opts)));
  notify();
}

export async function bulkPut<S extends StoreName>(
  store: S,
  values: StoreValueMap[S][],
  opts?: PutOptions
): Promise<void> {
  const db = await openDB();
  const stamped = values.map((v) => stamp(store, v, opts));
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(store, "readwrite");
    const os = t.objectStore(store);
    for (const v of stamped) os.put(v);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
  notify();
}

/**
 * Delete a record. On synced stores a tombstone is recorded first so the
 * sync engine can replay the deletion to other devices (a plain remote
 * absence is indistinguishable from "created on another device later").
 */
export async function del(store: StoreName, id: string): Promise<void> {
  if (isSyncedStore(store)) {
    await tx("sync_tombstones", "readwrite", (os) =>
      os.put({
        key: `${store}:${id}`,
        store,
        id,
        deleted_at: Date.now(),
      } satisfies TombstoneRow)
    );
  }
  await tx(store, "readwrite", (os) => os.delete(id));
  notify();
}

/**
 * Remote-delete apply path (sync engine only): removes the record and plants
 * the tombstone with the REMOTE timestamp, so this deletion isn't re-pushed
 * as a newer local event.
 */
export async function applyRemoteDelete(
  store: SyncedStore,
  id: string,
  deletedAtMs: number
): Promise<void> {
  await tx("sync_tombstones", "readwrite", (os) =>
    os.put({
      key: `${store}:${id}`,
      store,
      id,
      deleted_at: deletedAtMs,
    } satisfies TombstoneRow)
  );
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

// ─── one-time migration: stamp legacy rows so LWW sync has a baseline ───────
const MIGRATE_KEY = "sync-updated-at-migrated";

/**
 * Records written before sync existed have no `updated_at`. Stamp them once
 * (staggered by a few ms so per-record ordering stays stable) and remember
 * the migration in kv. Safe to call on every boot — the kv guard makes it a
 * no-op after the first run, and rows already stamped are left alone.
 */
export async function ensureUpdatedAtStamps(): Promise<void> {
  const done = await kvGet<boolean>(MIGRATE_KEY).catch(() => false);
  if (done) return;
  const base = Date.now();
  let touched = 0;
  for (const store of SYNCED_STORES) {
    const rows = await getAll(store);
    const missing = rows.filter((r) => typeof (r as { updated_at?: number }).updated_at !== "number");
    if (missing.length === 0) continue;
    const stamped = missing.map((r, i) => ({
      ...(r as { updated_at?: number }),
      updated_at: base + i,
    }));
    await bulkPut(store, stamped as never[], { touch: false });
    touched += stamped.length;
  }
  await kvSet(MIGRATE_KEY, true);
  if (touched > 0) console.info(`[sync] stamped ${touched} legacy record(s) with updated_at`);
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

// ─── session helpers (legacy sessions are normalized on read) ────────────────
export async function saveSession(s: ActiveSession): Promise<void> {
  await kvSet("active-session", s);
}

/** Defensively normalize legacy session shapes so old data resumes without crashing. */
function normalizeSession(raw: ActiveSession): ActiveSession {
  const s: ActiveSession = {
    ...raw,
    answers: raw.answers ?? {},
    marked: Array.isArray(raw.marked) ? raw.marked : [],
    q_times: raw.q_times ?? {},
    current: typeof raw.current === "number" ? raw.current : 0,
  };
  const meta = s.pdf_meta;
  if (s.mode === "pdf" && meta) {
    const key = Array.isArray(meta.key) ? meta.key : [];
    s.pdf_meta = {
      ...meta,
      // legacy key entries {no, answer} → {no, answer, answers:[answer]}
      key: key
        .filter((k) => k && typeof k.no === "number")
        .map((k) => {
          const answer =
            typeof k.answer === "string" ? k.answer : (k.answers?.[0] ?? "");
          return {
            ...k,
            answer,
            answers:
              Array.isArray(k.answers) && k.answers.length > 0 ? k.answers : [answer],
          };
        }),
      first_q: typeof meta.first_q === "number" ? meta.first_q : 1,
      // legacy pdf_meta without sections → synthesize the single-section equivalent
      sections:
        Array.isArray(meta.sections) && meta.sections.length > 0
          ? meta.sections
          : [
              {
                subject: meta.subject,
                chapter: meta.chapter,
                first_q: 1,
                last_q: meta.total_questions,
                start_page: meta.start_page,
                end_page: meta.end_page,
              },
            ],
    };
  }
  return s;
}

export async function loadSession(): Promise<ActiveSession | undefined> {
  const s = await kvGet<ActiveSession>("active-session");
  return s ? normalizeSession(s) : undefined;
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
