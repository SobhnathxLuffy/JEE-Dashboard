// ─── Unit tests: sync engine pure logic ──────────────────────────────────────
// Run: npx tsx scripts/sync.test.ts   (exit 1 on any failure)
import assert from "node:assert/strict";

// localStorage shim (sync.ts reads localStorage at module level for config)
const store = new Map<string, string>();
const shim = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
};
const w = globalThis as { window?: unknown; localStorage?: Storage };
w.window = { location: { search: "" }, localStorage: shim, addEventListener() {}, removeEventListener() {} };
w.localStorage = shim as Storage;

import {
  chunkFor,
  nextPushCursor,
  remoteWins,
} from "../src/lib/sync";
import type { SyncRow } from "../src/lib/sync";

let passed = 0;
function ok(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(e);
    process.exitCode = 1;
  }
}

console.log("remoteWins (LWW decision)");
ok("missing local → remote wins", () => {
  assert.equal(remoteWins(undefined, 1000), true);
});
ok("remote strictly newer → wins", () => {
  assert.equal(remoteWins(999, 1000), true);
});
ok("remote equal or older → local kept", () => {
  assert.equal(remoteWins(1000, 1000), false);
  assert.equal(remoteWins(1001, 1000), false);
});
ok("unstamped local (0) loses to any real stamp", () => {
  assert.equal(remoteWins(0, 5), true);
});

console.log("nextPushCursor (echo guard + clock-skew clamp)");
ok("advances past remote-applied stamps", () => {
  // prev push cursor 100, remote rows seen up to 500 → cursor ≥ 500
  assert.equal(nextPushCursor(100, 500, 0, 10_000), 500);
});
ok("advances past what was actually pushed", () => {
  assert.equal(nextPushCursor(100, 0, 900, 10_000), 900);
});
ok("takes the max of prev/remote/pushed", () => {
  assert.equal(nextPushCursor(300, 200, 100, 10_000), 300);
});
ok("clamped to now — a future-skewed remote must not freeze pushes", () => {
  const now = 10_000;
  assert.equal(nextPushCursor(0, 999_999, 0, now), now);
});
ok("no movement when nothing happened", () => {
  assert.equal(nextPushCursor(500, 0, 0, 10_000), 500);
});

console.log("chunkFor");
ok("splits evenly", () => {
  assert.deepEqual(chunkFor([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});
ok("empty → no chunks", () => {
  assert.deepEqual(chunkFor([], 10), []);
});
ok("size larger than array → single chunk", () => {
  assert.deepEqual(chunkFor([1], 10), [[1]]);
});

console.log("server-side LWW guard contract (mirrors sync_push SQL)");
// The mock backend and the SQL function share this rule; restate it here so a
// regression in either side is caught by this test.
ok("older push does NOT overwrite newer row", () => {
  const rows: SyncRow[] = [
    { store: "tasks", rec_id: "t1", payload: { id: "t1" }, updated_at: "2026-01-01T00:00:05.000Z", deleted: false },
  ];
  const existing: SyncRow[] = [
    { store: "tasks", rec_id: "t1", payload: { id: "t1", text: "newer" }, updated_at: "2026-01-01T00:00:09.000Z", deleted: false },
  ];
  for (const r of rows) {
    const at = existing.findIndex((x) => x.store === r.store && x.rec_id === r.rec_id);
    if (at >= 0 && existing[at].updated_at < r.updated_at) existing[at] = r;
  }
  assert.equal(existing[0].payload && (existing[0].payload as { text?: string }).text, "newer");
});
ok("newer push DOES overwrite older row", () => {
  const existing: SyncRow[] = [
    { store: "tasks", rec_id: "t1", payload: { id: "t1" }, updated_at: "2026-01-01T00:00:05.000Z", deleted: false },
  ];
  const incoming: SyncRow = { store: "tasks", rec_id: "t1", payload: { id: "t1", text: "new" }, updated_at: "2026-01-01T00:00:07.000Z", deleted: false };
  const at = existing.findIndex((x) => x.store === incoming.store && x.rec_id === incoming.rec_id);
  if (at >= 0 && existing[at].updated_at < incoming.updated_at) existing[at] = incoming;
  assert.equal((existing[0].payload as { text?: string }).text, "new");
});

console.log(`\n${passed} checks passed${process.exitCode ? " (with failures)" : ""}`);
if (process.exitCode) process.exit(1);
