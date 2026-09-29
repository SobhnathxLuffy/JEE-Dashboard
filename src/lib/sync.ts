// ─── Optional cross-device sync — Supabase-backed, privacy-first ────────────
//
// Model (mirrors what Super Productivity converged on for its self-hosted
// sync): a free Supabase project owned by the USER acts as the relay. Every
// synced record becomes one row in `sync_data` protected by Row-Level
// Security — only the signed-in account can read or write its own rows. The
// anon key is public by design; the security boundary is the user's auth.
//
// Merge strategy: per-record last-write-wins on `updated_at` (epoch ms,
// stamped by the idb write layer). Deletes are tombstones so a deletion on
// device A removes the record on device B. Server-side LWW guard
// (`sync_push` SQL function) keeps concurrent pushes from different devices
// monotone: an older timestamp can never overwrite a newer one.
//
// Privacy posture: data lives in the user's own project, RLS-isolated, over
// HTTPS. AI provider keys, Google tokens and in-progress sessions stay
// device-local (never synced). Papers sync with their PDF up to ~4.8 MB
// (base64 data URL); bigger PDFs travel metadata-only.

import { useSyncExternalStore } from "react";
import {
  applyRemoteDelete,
  bulkPut,
  DB_DEVICE_ID,
  del,
  ensureUpdatedAtStamps,
  getAll,
  isSyncedStore,
  subscribeLive,
  SYNCED_STORES,
  type StoreName,
} from "./idb";
import { IS_NATIVE } from "./native";

// ─── types ───────────────────────────────────────────────────────────────────

/** One replicated row — the wire format both directions. */
export interface SyncRow {
  store: string; // synced store name
  rec_id: string;
  payload: unknown; // the record itself (null-ish for deletes)
  updated_at: string; // ISO timestamp
  deleted: boolean;
}

export interface SyncSession {
  userId: string;
  email: string;
}

export interface SyncBackend {
  getSession(): Promise<SyncSession | null>;
  /** Passwordless sign-in — sends the magic link (or instant in mock mode). */
  signInOtp(email: string): Promise<void>;
  /**
   * Complete sign-in from a pasted magic-link URL or 6-digit code — the path
   * the Android APK uses, where tapping the link opens a browser instead of
   * this app and the session would land in the wrong storage.
   */
  verifyOtp(tokenInput: string, email: string): Promise<void>;
  signOut(): Promise<void>;
  onSession(cb: () => void): () => void;
  /** Rows changed after `sinceIso` (ascending). */
  pullDelta(sinceIso: string): Promise<SyncRow[]>;
  pushRows(rows: SyncRow[]): Promise<void>;
}

export type SyncPhase =
  | "unconfigured" // no Supabase URL/key saved yet
  | "signed-out" // configured, no session
  | "idle" // signed in, nothing happening
  | "syncing"
  | "error" // last sync failed
  | "offline";

export interface SyncStatusSnapshot {
  phase: SyncPhase;
  email: string | null;
  lastSyncAt: number | null;
  lastResult: { pulled: number; pushed: number } | null;
  lastError: string | null;
  /** rough count of local changes not yet pushed (best-effort) */
  dirty: number;
  auto: boolean;
  mock: boolean;
}

// ─── config + cursors (localStorage — device-local, never synced) ───────────

const CFG_KEY = "jee-sync-config";
// Cursors belong to the DEVICE DATABASE, not the browser: two tabs sharing
// one origin share localStorage, but ?device=<name> tabs use separate
// IndexedDBs — each must keep its own pull/push position.
const CURSOR_KEY = DB_DEVICE_ID ? `jee-sync-cursors-${DB_DEVICE_ID}` : "jee-sync-cursors";
const AUTO_KEY = "jee-sync-auto";
const DEVICE_KEY = DB_DEVICE_ID ? `jee-sync-device-id-${DB_DEVICE_ID}` : "jee-sync-device-id";
const MOCK_ROWS_KEY = "jee-sync-mock-rows";
const MOCK_SESSION_KEY = "jee-sync-mock-session";

export interface SyncConfig {
  url: string;
  anonKey: string;
}

export function loadSyncConfig(): SyncConfig | null {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as SyncConfig;
    return typeof c.url === "string" && typeof c.anonKey === "string" && c.url && c.anonKey ? c : null;
  } catch {
    return null;
  }
}

export function saveSyncConfig(cfg: SyncConfig): void {
  localStorage.setItem(
    CFG_KEY,
    JSON.stringify({ url: cfg.url.trim().replace(/\/+$/, ""), anonKey: cfg.anonKey.trim() })
  );
}

export function clearSyncConfig(): void {
  localStorage.removeItem(CFG_KEY);
  localStorage.removeItem(CURSOR_KEY);
}

function readCursors(): { pull: string; push: number } {
  try {
    const raw = localStorage.getItem(CURSOR_KEY);
    if (raw) {
      const c = JSON.parse(raw) as { pull?: string; push?: number };
      return { pull: typeof c.pull === "string" ? c.pull : "1970-01-01T00:00:00.000Z", push: c.push ?? 0 };
    }
  } catch {
    // fall through
  }
  return { pull: "1970-01-01T00:00:00.000Z", push: 0 };
}

function writeCursors(c: { pull: string; push: number }): void {
  localStorage.setItem(CURSOR_KEY, JSON.stringify(c));
}

function loadAuto(): boolean {
  return localStorage.getItem(AUTO_KEY) !== "0";
}

function deviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = `dev-${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

// ─── status external store (useSyncExternalStore-friendly) ──────────────────

let status: SyncStatusSnapshot = {
  phase: "unconfigured",
  email: null,
  lastSyncAt: null,
  lastResult: null,
  lastError: null,
  dirty: 0,
  auto: true,
  mock: false,
};

const statusListeners = new Set<() => void>();

function publishStatus(patch: Partial<SyncStatusSnapshot>): void {
  status = { ...status, ...patch };
  statusListeners.forEach((l) => l());
}

function subscribeStatus(cb: () => void): () => void {
  statusListeners.add(cb);
  return () => statusListeners.delete(cb);
}

export function getSyncStatus(): SyncStatusSnapshot {
  return status;
}

export function useSyncStatus(): SyncStatusSnapshot {
  return useSyncExternalStore(subscribeStatus, getSyncStatus, getSyncStatus);
}

export function setAutoSync(on: boolean): void {
  localStorage.setItem(AUTO_KEY, on ? "1" : "0");
  publishStatus({ auto: on });
}

// ─── error mapping (friendly, action-oriented) ──────────────────────────────

export function mapSyncError(e: unknown): string {
  const msg = String((e as { message?: string })?.message ?? e ?? "");
  const low = msg.toLowerCase();
  if (low.includes("failed to fetch") || low.includes("networkerror") || low.includes("load failed")) {
    return "Can't reach the Supabase project — check your internet or the project URL (paused projects act offline).";
  }
  if (low.includes("sync_push") || low.includes("pgrst202") || low.includes("could not find the function")) {
    return "The sync_push function is missing — re-run the setup SQL (step 2), it creates it.";
  }
  if (low.includes("does not exist") || low.includes("pgrst205") || low.includes("schema cache")) {
    return "The sync_data table is missing — run the setup SQL (step 2) in the Supabase SQL editor.";
  }
  if (low.includes("invalid api key") || low.includes("401")) {
    return "The anon key was rejected — re-copy both the Project URL and the anon public key.";
  }
  if (low.includes("over_email_send_rate_limit") || low.includes("rate limit")) {
    return "Too many magic-link emails — wait about a minute and try again.";
  }
  if (low.includes("signup requires confirmation") || low.includes("signups not allowed")) {
    return "This project rejects sign-ins — check Authentication → Providers → Email in Supabase.";
  }
  if (low.includes("row-level security") || low.includes("42501") || low.includes("violates")) {
    return "Blocked by Row-Level Security — make sure the RLS policy from the setup SQL exists and you're signed in.";
  }
  return msg.slice(0, 220) || "Unknown sync error";
}

/** Quick wizard check: does this URL+key point at a live project? */
export async function probeProject(
  url: string,
  anonKey: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/auth/v1/health`, {
      headers: { apikey: anonKey },
    });
    if (res.ok) return { ok: true };
    return {
      ok: false,
      error: res.status === 401 || res.status === 403
        ? "The anon key was rejected by this project."
        : `Project answered with HTTP ${res.status}.`,
    };
  } catch {
    return { ok: false, error: "Can't reach that URL — check it (and that the project isn't paused)." };
  }
}

// ─── Supabase backend (loaded lazily — keeps it out of the initial bundle) ──

let sbPromise: Promise<import("@supabase/supabase-js").SupabaseClient> | null = null;

async function supabaseClient(cfg: SyncConfig) {
  if (!sbPromise) {
    sbPromise = import("@supabase/supabase-js").then(({ createClient }) =>
      createClient(cfg.url, cfg.anonKey, {
        auth: {
          storageKey: "jee-sync-auth",
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: "pkce",
        },
      })
    );
  }
  return sbPromise;
}

function makeSupabaseBackend(cfg: SyncConfig): SyncBackend {
  let changeCb: (() => void) | null = null;
  return {
    async getSession() {
      const sb = await supabaseClient(cfg);
      const { data } = await sb.auth.getSession();
      const u = data.session?.user;
      return u ? { userId: u.id, email: u.email ?? "" } : null;
    },
    async signInOtp(email) {
      const sb = await supabaseClient(cfg);
      // On the web the link opens back into this same origin (PKCE completes
      // here). In the APK a redirect target would open the phone's browser —
      // useless — so no redirect is requested; sign-in completes via
      // verifyOtp with the pasted link/code instead.
      const { error } = IS_NATIVE
        ? await sb.auth.signInWithOtp({ email })
        : await sb.auth.signInWithOtp({
            email,
            options: { emailRedirectTo: `${window.location.origin}${window.location.pathname}` },
          });
      if (error) throw error;
    },
    async verifyOtp(tokenInput, email) {
      const sb = await supabaseClient(cfg);
      const input = tokenInput.trim();
      if (/^https?:\/\//i.test(input)) {
        // the whole magic-link URL — carry the token_hash over to THIS device
        let u: URL;
        try {
          u = new URL(input);
        } catch {
          throw new Error("That doesn't look like a URL — copy the full link from the email.");
        }
        const tokenHash = u.searchParams.get("token_hash");
        const type = (u.searchParams.get("type") ?? "magiclink") as
          | "magiclink"
          | "signup"
          | "recovery"
          | "invite"
          | "email";
        if (!tokenHash) {
          throw new Error(
            "That link has no token in it — long-press the link in the email and copy the FULL address."
          );
        }
        const { error } = await sb.auth.verifyOtp({ type, token_hash: tokenHash });
        if (error) throw error;
        return;
      }
      const digits = input.replace(/[\s-]/g, "");
      if (/^\d{6}$/.test(digits)) {
        // 6-digit code (only sent when the project uses the Email OTP template)
        const { error } = await sb.auth.verifyOtp({ email, token: digits, type: "email" });
        if (error) throw error;
        return;
      }
      throw new Error(
        "Paste the full link from the email (long-press → Copy link address), or the 6-digit code."
      );
    },
    async signOut() {
      const sb = await supabaseClient(cfg);
      await sb.auth.signOut();
    },
    onSession(cb) {
      changeCb = cb;
      let unsub: (() => void) | null = null;
      void supabaseClient(cfg).then((sb) => {
        const sub = sb.auth.onAuthStateChange(() => cb());
        unsub = () => sub.data.subscription.unsubscribe();
      });
      return () => {
        changeCb = null;
        unsub?.();
      };
    },
    async pullDelta(sinceIso) {
      const sb = await supabaseClient(cfg);
      const out: SyncRow[] = [];
      let from = 0;
      for (;;) {
        const { data, error } = await sb
          .from("sync_data")
          .select("store,rec_id,payload,updated_at,deleted")
          .gt("updated_at", sinceIso)
          .order("updated_at", { ascending: true })
          .range(from, from + 999);
        if (error) throw error;
        for (const r of (data ?? []) as SyncRow[]) out.push(r);
        if (!data || data.length < 1000) break;
        from += 1000;
      }
      return out;
    },
    async pushRows(rows) {
      if (rows.length === 0) return;
      const sb = await supabaseClient(cfg);
      // chunk by count AND estimated body size — a 4 MB paper payload must
      // travel alone, not inside a 200-row batch (Supabase caps request size)
      const chunks: SyncRow[][] = [];
      let cur: SyncRow[] = [];
      let curSize = 0;
      for (const r of rows) {
        let sz = 64;
        try {
          sz = JSON.stringify(r.payload ?? null)?.length ?? 64;
        } catch {
          /* unserializable payload — let the rpc call surface it */
        }
        if (cur.length >= 200 || (cur.length > 0 && curSize + sz > 1_500_000)) {
          chunks.push(cur);
          cur = [];
          curSize = 0;
        }
        cur.push(r);
        curSize += sz;
      }
      if (cur.length > 0) chunks.push(cur);
      for (const chunk of chunks) {
        const body = chunk.map((r) => ({
          store: r.store,
          rec_id: r.rec_id,
          payload: r.payload ?? null,
          updated_at: r.updated_at,
          deleted: r.deleted,
        }));
        const { error } = await sb.rpc("sync_push", { p_rows: body, p_device: deviceId() });
        if (error) {
          // fallback: function missing → plain upsert (still RLS-safe, weaker
          // against same-instant races from two devices)
          if (String(error.message).toLowerCase().includes("sync_push")) {
            const sess = await this.getSession();
            if (!sess) throw new Error("Signed out mid-sync");
            const withUser = body.map((r) => ({ ...r, user_id: sess.userId, device: deviceId() }));
            const up = await sb
              .from("sync_data")
              .upsert(withUser, { onConflict: "user_id,store,rec_id" });
            if (up.error) throw up.error;
            continue;
          }
          throw error;
        }
      }
    },
  };
}

// ─── mock backend (?syncMock=1) — two tabs = two devices, rows in localStorage
//
// Powers the E2E verification without a live project: localStorage is shared
// between tabs of the same origin, so tab A (?syncMock=1) and tab B
// (?syncMock=1&device=b — separate IndexedDB) sync against the same fake
// server. Mirrors the real contract incl. the server-side LWW guard.

function isMockMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("syncMock") === "1";
  } catch {
    return false;
  }
}

function makeMockBackend(): SyncBackend {
  const readRows = (): SyncRow[] => {
    try {
      return JSON.parse(localStorage.getItem(MOCK_ROWS_KEY) ?? "[]") as SyncRow[];
    } catch {
      return [];
    }
  };
  const writeRows = (rows: SyncRow[]) => localStorage.setItem(MOCK_ROWS_KEY, JSON.stringify(rows));
  let changeCb: (() => void) | null = null;

  return {
    async getSession() {
      try {
        const raw = localStorage.getItem(MOCK_SESSION_KEY);
        return raw ? (JSON.parse(raw) as SyncSession) : null;
      } catch {
        return null;
      }
    },
    async signInOtp(email) {
      const sess = { userId: "mock-user", email };
      localStorage.setItem(MOCK_SESSION_KEY, JSON.stringify(sess));
      changeCb?.();
    },
    async verifyOtp() {
      // mock mode signs in instantly inside signInOtp — nothing to verify
    },
    async signOut() {
      localStorage.removeItem(MOCK_SESSION_KEY);
      changeCb?.();
    },
    onSession(cb) {
      changeCb = cb;
      const storageCb = (e: StorageEvent) => {
        if (e.key === MOCK_SESSION_KEY || e.key === MOCK_ROWS_KEY) cb();
      };
      window.addEventListener("storage", storageCb);
      return () => {
        changeCb = null;
        window.removeEventListener("storage", storageCb);
      };
    },
    async pullDelta(sinceIso) {
      return readRows()
        .filter((r) => r.updated_at > sinceIso)
        .sort((a, b) => a.updated_at.localeCompare(b.updated_at));
    },
    async pushRows(rows) {
      if (rows.length === 0) return;
      const existing = readRows();
      const idx = new Map(existing.map((r, i) => [`${r.store}:${r.rec_id}`, i]));
      for (const r of rows) {
        const k = `${r.store}:${r.rec_id}`;
        const at = idx.get(k);
        // server-side LWW guard — same rule as sync_push in SQL
        if (at === undefined) {
          idx.set(k, existing.length);
          existing.push(r);
        } else if (existing[at].updated_at < r.updated_at) {
          existing[at] = r;
        }
      }
      writeRows(existing);
      // cross-tab poke so the "other device" notices promptly
      localStorage.setItem(`${MOCK_ROWS_KEY}-tick`, String(Date.now()));
    },
  };
}

// ─── per-store wire codecs ────────────────────────────────────────────────
// IndexedDB records can carry Blobs; JSON over the wire cannot. Papers store
// the PDF as a Blob locally, so it travels as a base64 data URL and is
// decoded back on pull. PDFs beyond the cap sync metadata-only (pdf_sync_
// skipped flag) — the receiving device shows the entry minus the file.

const PAPER_BLOB_CAP = 4_800_000; // bytes of PDF binary that still syncs

async function blobToB64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < buf.length; i += CH) {
    bin += String.fromCharCode(...buf.subarray(i, i + CH));
  }
  return btoa(bin);
}

function b64ToBlob(b64: string, type = "application/pdf"): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

const PDF_DATA_URL = /^data:application\/pdf;base64,/;

/** Local record → JSON-safe wire payload. */
async function toWire(store: string, rec: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (store !== "papers") return rec;
  const data = (rec as { data?: unknown }).data;
  if (data instanceof Blob) {
    if (data.size > PAPER_BLOB_CAP) {
      return { ...rec, data: undefined, pdf_sync_skipped: `PDF too large to sync (${(data.size / 1_048_576).toFixed(1)} MB > ~4.8 MB)` };
    }
    try {
      return { ...rec, data: `data:application/pdf;base64,${await blobToB64(data)}` };
    } catch {
      return { ...rec, data: undefined, pdf_sync_skipped: "PDF could not be read" };
    }
  }
  return rec; // already wire-shaped (metadata-only sync or re-push)
}

/** Wire payload → local record (restores the PDF Blob). */
function fromWire(store: string, payload: Record<string, unknown>): Record<string, unknown> {
  if (store !== "papers") return payload;
  const data = (payload as { data?: unknown }).data;
  if (typeof data === "string" && PDF_DATA_URL.test(data)) {
    try {
      return { ...payload, data: b64ToBlob(data.slice(PDF_DATA_URL.source.length - 1)) };
    } catch {
      return { ...payload, data: undefined, pdf_sync_skipped: "PDF failed to decode on arrival" };
    }
  }
  return payload;
}

// ─── pure merge helpers (unit-tested in scripts/sync.test.ts) ───────────────

/** Should the remote row win over the local record? (LWW, strict-newer) */
export function remoteWins(localUpdatedAtMs: number | undefined, remoteMs: number): boolean {
  return remoteMs > (localUpdatedAtMs ?? 0);
}

/**
 * Push-cursor advance: remote-applied stamps must be surpassed so freshly
 * applied rows aren't echoed back, but never beyond "now" (a clock-skewed
 * device must not freeze the push pipeline).
 */
export function nextPushCursor(prevPushMs: number, maxRemoteSeenMs: number, maxPushedMs: number, nowMs: number): number {
  return Math.min(Math.max(prevPushMs, maxRemoteSeenMs, maxPushedMs), nowMs);
}

export function chunkFor<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ─── the engine ──────────────────────────────────────────────────────────────

let backend: SyncBackend | null = null;
let backendKind: "supabase" | "mock" | null = null;
let syncing = false;
let initStarted = false;
let unsubSession: (() => void) | null = null;
let dirtyCounter = 0;
let debouncer: ReturnType<typeof setTimeout> | null = null;

function getBackend(): SyncBackend | null {
  return backend;
}

/** Apply a pulled page of rows. Returns {applied, maxRemoteMs}. */
async function applyRemote(rows: SyncRow[]): Promise<{ applied: number; maxRemoteMs: number }> {
  // group per store to keep it to one bulkPut per store (fewer live-refetches)
  const byStore = new Map<
    string,
    { upserts: { payload: Record<string, unknown>; ms: number }[]; deletes: { id: string; ms: number }[] }
  >();
  let maxRemoteMs = 0;
  let applied = 0;
  for (const r of rows) {
    if (!isSyncedStore(r.store as StoreName)) continue;
    const ms = Date.parse(r.updated_at);
    if (!Number.isFinite(ms)) continue;
    if (ms > maxRemoteMs) maxRemoteMs = ms;
    const g = byStore.get(r.store) ?? { upserts: [], deletes: [] };
    if (r.deleted) {
      g.deletes.push({ id: r.rec_id, ms });
    } else if (r.payload && typeof r.payload === "object") {
      g.upserts.push({ payload: fromWire(r.store, r.payload as Record<string, unknown>), ms });
    }
    byStore.set(r.store, g);
  }
  for (const [storeName, g] of byStore) {
    const store = storeName as (typeof SYNCED_STORES)[number];
    const local = new Map((await getAll(store)).map((x) => [x.id, (x as { updated_at?: number }).updated_at]));
    // LWW: the row's ISO timestamp (server truth) decides, not the payload's
    const wins = g.upserts.filter((u) => remoteWins(local.get(String(u.payload.id)), u.ms));
    // deletes only when the tombstone beats the local record
    for (const d of g.deletes) {
      if (remoteWins(local.get(d.id), d.ms)) {
        await applyRemoteDelete(store, d.id, d.ms);
        applied += 1;
      }
    }
    if (wins.length > 0) {
      await bulkPut(store, wins.map((u) => u.payload) as never[], { touch: false });
      applied += wins.length;
    }
  }
  return { applied, maxRemoteMs };
}

/** Local records + tombstones newer than `effPushMs`, as wire rows. */
async function collectDirty(effPushMs: number): Promise<SyncRow[]> {
  const rows: SyncRow[] = [];
  for (const store of SYNCED_STORES) {
    const all = await getAll(store);
    for (const r of all) {
      const ms = (r as { updated_at?: number }).updated_at ?? 0;
      if (ms > effPushMs) {
        rows.push({
          store,
          rec_id: r.id,
          payload: await toWire(store, r as unknown as Record<string, unknown>),
          updated_at: new Date(ms).toISOString(),
          deleted: false,
        });
      }
    }
  }
  const tombs = await getAll("sync_tombstones");
  for (const t of tombs) {
    if (t.deleted_at > effPushMs) {
      rows.push({
        store: t.store,
        rec_id: t.id,
        payload: null,
        updated_at: new Date(t.deleted_at).toISOString(),
        deleted: true,
      });
    }
  }
  return rows;
}

async function purgeOldTombstones(keptAfterMs: number): Promise<void> {
  const tombs = await getAll("sync_tombstones");
  for (const t of tombs) {
    if (t.deleted_at < keptAfterMs) {
      // sync_tombstones is not a synced store, so del() plants no new tombstone
      await del("sync_tombstones", t.key);
    }
  }
}

/**
 * One full sync cycle: pull → merge (LWW) → push. Idempotent and safe to
 * call from any trigger; concurrent calls collapse into the running one.
 */
export async function syncNow(reason: string): Promise<void> {
  if (syncing || !backend) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    publishStatus({ phase: "offline" });
    return;
  }
  const cfg = loadSyncConfig();
  if (!cfg) {
    publishStatus({ phase: "unconfigured" });
    return;
  }
  syncing = true;
  publishStatus({ phase: "syncing", lastError: null });
  try {
    await ensureUpdatedAtStamps();
    const sess = await backend.getSession();
    if (!sess) {
      publishStatus({ phase: "signed-out", email: null });
      return;
    }
    publishStatus({ email: sess.email });

    // 1 · pull everything newer than our pull cursor
    const cursors = readCursors();
    const rows = await backend.pullDelta(cursors.pull);

    // 2 · merge into IndexedDB (remote rows applied with their own stamps)
    const { applied, maxRemoteMs } = await applyRemote(rows);

    // 3 · push local changes (cursor math prevents echoing remote data back)
    const effPushMs = nextPushCursor(cursors.push, maxRemoteMs, 0, Date.now());
    const dirty = await collectDirty(effPushMs);
    const maxLocalMs = dirty.reduce((a, r) => Math.max(a, Date.parse(r.updated_at)), effPushMs);
    await backend.pushRows(dirty);

    // 4 · advance cursors + bookkeeping
    writeCursors({
      pull: maxRemoteMs > Date.parse(cursors.pull) ? new Date(maxRemoteMs).toISOString() : cursors.pull,
      push: nextPushCursor(cursors.push, maxRemoteMs, maxLocalMs, Date.now()),
    });
    dirtyCounter = 0;
    void purgeOldTombstones(Date.now() - 120 * 86400000);
    publishStatus({
      phase: "idle",
      lastSyncAt: Date.now(),
      lastResult: { pulled: applied, pushed: dirty.length },
      lastError: null,
      dirty: 0,
    });
    if (applied > 0 || dirty.length > 0) {
      console.info(`[sync] ${reason}: pulled ${applied}, pushed ${dirty.length}`);
    }
  } catch (e) {
    console.warn(`[sync] ${reason} failed:`, e);
    publishStatus({ phase: "error", lastError: mapSyncError(e) });
  } finally {
    syncing = false;
  }
}

// ─── lifecycle ───────────────────────────────────────────────────────────────

/** Sign in (magic link, or instantly in mock mode). Throws mapped errors. */
export async function signIn(email: string): Promise<void> {
  if (!backend) throw new Error("Sync is not configured yet");
  await backend.signInOtp(email.trim().toLowerCase());
  // mock backend is already signed in here; real one waits for the email link
  const sess = await backend.getSession();
  if (sess) {
    publishStatus({ phase: "idle", email: sess.email });
    void syncNow("sign-in");
  }
}

/**
 * Complete sign-in with a pasted magic-link URL or 6-digit code — how the
 * Android APK signs in, since tapping the link there opens a browser.
 */
export async function verifySignIn(tokenInput: string, email: string): Promise<void> {
  if (!backend) throw new Error("Sync is not configured yet");
  await backend.verifyOtp(tokenInput, email.trim().toLowerCase());
  const sess = await backend.getSession();
  if (sess) {
    publishStatus({ phase: "idle", email: sess.email });
    void syncNow("sign-in");
  } else {
    throw new Error("That link didn't sign you in — generate a fresh one and try again.");
  }
}

export async function signOutSync(): Promise<void> {
  if (backend) await backend.signOut().catch(() => {});
  dirtyCounter = 0;
  publishStatus({ phase: "signed-out", email: null, lastResult: null, dirty: 0 });
}

/** Remove the project config on this device (remote data is untouched). */
export function disconnectSync(): void {
  clearSyncConfig();
  backend = null;
  backendKind = null;
  if (unsubSession) {
    unsubSession();
    unsubSession = null;
  }
  publishStatus({ phase: "unconfigured", email: null, lastResult: null, lastError: null });
}

/**
 * Wire the engine up — safe to call once per page load (and again after the
 * wizard saves a config). Sets up auto-sync triggers:
 *   writes → debounced 6s · tab focus · back online · every 5 min · session changes
 */
export function initSync(): void {
  const mock = isMockMode();
  const cfgExisting = loadSyncConfig();
  if (mock && !cfgExisting) {
    saveSyncConfig({ url: "mock://local-device-sync", anonKey: "mock-anon-key" });
  }
  // A config saved by mock-mode testing must not poison normal mode
  // (createClient would throw "Invalid supabaseUrl" on mock:// URLs).
  if (!mock && cfgExisting && cfgExisting.url.startsWith("mock:")) {
    clearSyncConfig();
  }
  const cfg = loadSyncConfig();
  publishStatus({ auto: loadAuto(), mock });
  if (!cfg) {
    publishStatus({ phase: "unconfigured" });
    return;
  }
  if (backend && backendKind === (mock ? "mock" : "supabase")) {
    void syncNow("re-init");
    return;
  }
  backend = mock ? makeMockBackend() : makeSupabaseBackend(cfg);
  backendKind = mock ? "mock" : "supabase";

  if (unsubSession) unsubSession();
  unsubSession = backend.onSession(() => {
    void (async () => {
      const sess = backend ? await backend.getSession() : null;
      if (sess) {
        publishStatus({ phase: "idle", email: sess.email });
        void syncNow("session");
      } else {
        publishStatus({ phase: "signed-out", email: null });
      }
    })();
  });

  // local writes → debounced auto-sync (counts as dirty for the status chip)
  subscribeLive(() => {
    if (!status.auto) return;
    dirtyCounter += 1;
    publishStatus({ dirty: dirtyCounter });
    if (debouncer) clearTimeout(debouncer);
    debouncer = setTimeout(() => void syncNow("write"), 6000);
  });

  if (typeof window !== "undefined") {
    window.addEventListener("online", () => void syncNow("online"));
    window.addEventListener("offline", () => publishStatus({ phase: "offline" }));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && status.auto) void syncNow("focus");
    });
    setInterval(() => {
      if (status.auto) void syncNow("interval");
    }, 5 * 60 * 1000);
  }

  void syncNow("startup");
}
