// ─── Google Calendar one-way sync (app → Google) ─────────────────────────────
// The same architecture Super Productivity uses for its Google Calendar sync,
// adapted to a local-first web app with no backend:
//
//   1. Google Identity Services (GIS) token client — implicit OAuth 2.0 that
//      runs entirely in the browser. No client secret, no server. The user
//      supplies their own OAuth Client ID (Web application) once; Google
//      requires the app origin to be listed as an authorized JavaScript
//      origin on that client, so a shared/hardcoded ID cannot exist.
//   2. Calendar API v3 over plain fetch — POST/PATCH/DELETE to
//      calendars/primary/events with the bearer token.
//   3. One-way mirror: every item that exists in the app (events + optional
//      study-plan items) is created/updated/deleted on Google so Google ends
//      up matching the app. A stable content hash per item means untouched
//      items cost zero API calls, and remote edits by the user are repaired
//      on the next sync (that is what one-way means — the app wins).
//
// All persisted state lives in localStorage: client id, access token (+
// expiry), the localKey→googleEventId sync map, last sync result, options.

import type { EventColor } from "./types";

const API_BASE = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
export const GCAL_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const GSI_SRC = "https://accounts.google.com/gsi/client";

const LS = {
  clientId: "gcal-client-id",
  token: "gcal-token", // { access_token, expires_at }
  map: "gcal-sync-map", // { [localKey]: { gid, hash } }
  last: "gcal-last-sync", // { at, created, updated, deleted, errors }
  opts: "gcal-sync-opts", // { includeStudyPlan, autoSync }
} as const;

// ─── persisted settings (SSR-safe) ───────────────────────────────────────────

function lsGet<T>(key: string): T | undefined {
  try {
    if (typeof window === "undefined") return undefined;
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function lsSet(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full / private mode — sync keeps working this session
  }
}

function lsDel(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function getClientId(): string | null {
  const v = lsGet<string>(LS.clientId);
  return typeof v === "string" && v.includes(".apps.googleusercontent.com") ? v : null;
}

export function setClientId(id: string): void {
  lsSet(LS.clientId, id.trim());
}

/** Every stored sync artifact — token, sync map, options (keeps client id). */
export function resetSyncState(): void {
  lsDel(LS.token);
  lsDel(LS.map);
  lsDel(LS.last);
}

export interface SyncOptions {
  /** also push tests, 1-3-7 revisions and dated to-dos (recommended) */
  includeStudyPlan: boolean;
  /** re-sync a few seconds after any calendar-relevant change */
  autoSync: boolean;
}

const DEFAULT_OPTS: SyncOptions = { includeStudyPlan: true, autoSync: true };

export function getSyncOptions(): SyncOptions {
  return { ...DEFAULT_OPTS, ...lsGet<Partial<SyncOptions>>(LS.opts) };
}

export function setSyncOptions(o: SyncOptions): void {
  lsSet(LS.opts, o);
}

export interface SyncResult {
  at: number;
  created: number;
  updated: number;
  deleted: number;
  errors: string[];
}

export function getLastSync(): SyncResult | null {
  return lsGet<SyncResult>(LS.last) ?? null;
}

export function saveLastSync(r: SyncResult): void {
  lsSet(LS.last, r);
}

// ─── GIS token client ────────────────────────────────────────────────────────

interface GTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  requestAccessToken: (overrides?: { prompt?: string }) => void;
}

interface GTokenClientCtor {
  client_id: string;
  scope: string;
  callback: (resp: GTokenResponse) => void;
  error_callback?: (err: { type?: string; message?: string }) => void;
}

type GTokenClientFactory = (cfg: GTokenClientCtor) => TokenClient;

/** Minimal typing for the GIS `google.accounts.oauth2` surface we use. */
interface Gioauth2 {
  initTokenClient: GTokenClientFactory;
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: Gioauth2 } };
  }
}

let gsiPromise: Promise<Gioauth2> | null = null;

/** Inject https://accounts.google.com/gsi/client once. */
export function loadGsi(): Promise<Gioauth2> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.google?.accounts?.oauth2) return Promise.resolve(window.google.accounts.oauth2);
  if (gsiPromise) return gsiPromise;
  gsiPromise = new Promise<Gioauth2>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = GSI_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => {
      if (window.google?.accounts?.oauth2) resolve(window.google.accounts.oauth2);
      else reject(new Error("Google Identity Services failed to initialize"));
    };
    s.onerror = () => {
      gsiPromise = null;
      reject(new Error("Could not load Google Identity Services (offline or blocked)"));
    };
    document.head.appendChild(s);
  });
  return gsiPromise;
}

interface CachedToken {
  access_token: string;
  expires_at: number;
}

function getCachedToken(): string | null {
  const t = lsGet<CachedToken>(LS.token);
  return t && t.access_token && Date.now() < t.expires_at - 60_000 ? t.access_token : null;
}

function cacheToken(resp: GTokenResponse): string {
  if (!resp.access_token) throw new Error(resp.error_description || resp.error || "No access token returned");
  const expires_at = Date.now() + (resp.expires_in ?? 3600) * 1000;
  lsSet(LS.token, { access_token: resp.access_token, expires_at } satisfies CachedToken);
  return resp.access_token;
}

/**
 * Get a usable access token:
 *   1. cached token still fresh → use it (no UI)
 *   2. GIS silent attempt (prompt: "") → works while a Google session lives
 *   3. interactive popup — only allowed when `interactive` (a user gesture
 *      chain exists); throws otherwise so silent callers back off.
 */
export async function ensureToken(interactive: boolean): Promise<string> {
  const cached = getCachedToken();
  if (cached) return cached;
  const clientId = getClientId();
  if (!clientId) throw new Error("Google Calendar is not set up yet — add your OAuth Client ID first.");
  const oauth2 = await loadGsi();

  const attempt = (prompt?: string) =>
    new Promise<GTokenResponse>((resolve, reject) => {
      const tc = oauth2.initTokenClient({
        client_id: clientId,
        scope: GCAL_SCOPE,
        callback: (resp) => resolve(resp),
        error_callback: (err) => reject(new Error(err.message || err.type || "Google sign-in was interrupted")),
      });
      tc.requestAccessToken(prompt === undefined ? undefined : { prompt });
      // Safety net: GIS can silently drop the request if the popup is blocked.
      window.setTimeout(() => reject(new Error("Google sign-in timed out")), 120_000);
    });

  // silent first (never shows UI, needs no gesture)
  if (!interactive) {
    try {
      return cacheToken(await attempt(""));
    } catch {
      throw new Error("Google session expired — click Sync now to reconnect.");
    }
  }
  // interactive path: silent, then popup fallback
  try {
    return cacheToken(await attempt(""));
  } catch {
    return cacheToken(await attempt(undefined));
  }
}

export function disconnectGoogle(): void {
  lsDel(LS.token);
}

export function isConnected(): boolean {
  return getClientId() !== null;
}

// ─── Google event bodies (pure — unit-tested) ────────────────────────────────

/** An item in the sync payload — one Google event per item. */
export interface SyncItem {
  key: string; // stable local key: evt:… | test:… | rev:… | task:…
  title: string;
  description?: string;
  date: string; // YYYY-MM-DD start
  endDate?: string; // exclusive end date (all-day multi-day)
  allDay: boolean;
  startMin?: number;
  endMin?: number;
  color?: EventColor;
}

function pad(n: number): string {
  return `${n}`.padStart(2, "0");
}

/** Local timezone as "+05:30" (Google uses it to anchor floating times). */
export function tzOffsetString(d = new Date()): string {
  const off = -d.getTimezoneOffset(); // minutes east of UTC
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function gDate(date: string, min?: number): string {
  if (min === undefined) return date;
  return `${date}T${pad(Math.floor(min / 60))}:${pad(min % 60)}:00${tzOffsetString()}`;
}

/** Google Calendar colorId per warm-palette event color. */
const GCOLOR: Record<EventColor, string> = {
  coral: "11", // red (closest to terracotta)
  kraft: "5", // yellow / giraffe
  sage: "2", // sage — literally named that
  plum: "3", // grape
  slate: "7", // peacock / gray-blue
  brick: "6", // tangerine→flamingo; brick reads warm-red
};

export interface GoogleEventBody {
  summary: string;
  description?: string;
  start: { date: string } | { dateTime: string };
  end: { date: string } | { dateTime: string };
  colorId?: string;
  reminders: { useDefault: boolean };
  extendedProperties: { private: { jeeApp: string; localKey: string } };
  source: { title: string; url?: string };
}

/** Build the Calendar API v3 event body for a sync item. */
export function buildGoogleEvent(item: SyncItem): GoogleEventBody {
  const body: GoogleEventBody = {
    summary: item.title,
    description: item.description,
    start: { date: item.date }, // replaced below for timed events
    end: { date: item.endDate ?? item.date },
    reminders: { useDefault: true },
    extendedProperties: {
      private: { jeeApp: "jee-study-app", localKey: item.key },
    },
    source: { title: "JEE Study App" },
  };
  if (item.color && item.color in GCOLOR) body.colorId = GCOLOR[item.color];
  if (!item.allDay) {
    body.start = { dateTime: gDate(item.date, item.startMin ?? 0) };
    body.end = { dateTime: gDate(item.date, item.endMin ?? (item.startMin ?? 0) + 60) };
  }
  return body;
}

/** Stable content hash — items whose relevant fields never change are skipped. */
export function itemHash(item: SyncItem): string {
  const spec = item.allDay
    ? `D:${item.date}/${item.endDate ?? item.date}`
    : `T:${item.date} ${item.startMin}-${item.endMin}`;
  return `${spec}|${item.title}|${item.description ?? ""}|${item.color ?? ""}`;
}

// ─── the one-way mirror ──────────────────────────────────────────────────────

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface SyncMapEntry {
  gid: string;
  hash: string;
}

export type SyncMap = Record<string, SyncMapEntry>;

export function loadSyncMap(): SyncMap {
  return lsGet<SyncMap>(LS.map) ?? {};
}

export function saveSyncMap(m: SyncMap): void {
  lsSet(LS.map, m);
}

async function apiJson(
  fetcher: Fetcher,
  token: string,
  method: "POST" | "PATCH" | "DELETE",
  gid: string | null,
  body?: unknown
): Promise<{ gid: string | null }> {
  const url = gid ? `${API_BASE}/${encodeURIComponent(gid)}` : API_BASE;
  const res = await fetcher(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (method === "DELETE" && (res.status === 404 || res.status === 410)) {
      return { gid: null }; // already gone on Google → treat as success
    }
    if (res.status === 401) throw new Error("Google access expired — click Sync now to reconnect.");
    if (res.status === 403 && /rate/i.test(text)) throw new Error("Google rate limit hit — retry in a minute.");
    throw new Error(`Google API ${res.status}${text ? `: ${text.slice(0, 160)}` : ""}`);
  }
  const data = (await res.json().catch(() => null)) as { id?: string } | null;
  return { gid: data?.id ?? gid };
}

/**
 * Mirror the app's items onto Google Calendar (one-way, app wins).
 * - new items → created
 * - items whose content hash changed → updated (remote edits get repaired)
 * - items removed from the app → deleted from Google
 * Per-item failures are collected and do not abort the run.
 */
export async function mirrorSync(
  items: SyncItem[],
  token: string,
  opts?: { fetcher?: Fetcher }
): Promise<SyncResult> {
  const fetcher: Fetcher = opts?.fetcher ?? ((u, i) => fetch(u, i));
  const old = loadSyncMap();
  const next: SyncMap = { ...old };
  const result: SyncResult = { at: Date.now(), created: 0, updated: 0, deleted: 0, errors: [] };

  const payload = new Map(items.map((i) => [i.key, i]));

  for (const [key, item] of payload) {
    const hash = itemHash(item);
    const entry = old[key];
    try {
      if (!entry) {
        const { gid } = await apiJson(fetcher, token, "POST", null, buildGoogleEvent(item));
        if (gid) next[key] = { gid, hash };
        result.created++;
      } else if (entry.hash !== hash) {
        const { gid } = await apiJson(fetcher, token, "PATCH", entry.gid, buildGoogleEvent(item));
        if (gid) next[key] = { gid, hash };
        result.updated++;
      } else {
        next[key] = entry; // untouched
      }
    } catch (e) {
      result.errors.push(`${item.title}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  for (const [key, entry] of Object.entries(old)) {
    if (payload.has(key)) continue;
    try {
      await apiJson(fetcher, token, "DELETE", entry.gid);
      delete next[key];
      result.deleted++;
    } catch (e) {
      result.errors.push(`Remove "${key}": ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  saveSyncMap(next);
  return result;
}
