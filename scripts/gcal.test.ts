// ─── Unit tests: Google sync engine + calendar logic ─────────────────────────
// Run: npx tsx scripts/gcal.test.ts   (exit 1 on any failure)
import assert from "node:assert/strict";

// localStorage shim (gcal.ts persists settings there via window.localStorage)
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
w.window = { google: undefined, localStorage: shim };
w.localStorage = shim as Storage;

import type { CalEventRecord, SyllabusRow, Task, TestRecord } from "../src/lib/types";

let pass = 0;
async function ok(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(e);
    process.exitCode = 1;
  }
}

async function main() {
const { buildGoogleEvent, itemHash, mirrorSync, tzOffsetString, resetSyncState, loadSyncMap } = await import(
  "../src/lib/gcal"
);
const { assembleItems, buildSyncItems, indexByDate, itemsOn } = await import("../src/lib/calitems");
const { buildIcs, googleCalUrl, parseHHMM, fmtMin, localStamp } = await import("../src/lib/calendar");

console.log("— gcal: event bodies —");

await ok("timed event body has dateTime with local offset", () => {
  const b = buildGoogleEvent({
    key: "evt:1", title: "Physics block", description: "ch 5",
    date: "2026-09-28", allDay: false, startMin: 540, endMin: 630, color: "coral",
  });
  assert.equal(b.summary, "Physics block");
  assert.match((b.start as { dateTime: string }).dateTime, /^2026-09-28T09:00:00([+-]\d{2}:\d{2})$/);
  assert.match((b.end as { dateTime: string }).dateTime, /^2026-09-28T10:30:00/);
  assert.equal(b.colorId, "11");
  assert.equal(b.extendedProperties.private.localKey, "evt:1");
});

await ok("all-day body uses date and exclusive end", () => {
  const b = buildGoogleEvent({
    key: "test:9", title: "Mock 1", date: "2026-10-01", allDay: true, color: "kraft",
  });
  assert.deepEqual(b.start, { date: "2026-10-01" });
  assert.deepEqual(b.end, { date: "2026-10-01" }); // end == start → 1-day all-day
  assert.equal(b.colorId, "5");
});

await ok("multi-day all-day end is exclusive", () => {
  const b = buildGoogleEvent({
    key: "evt:2", title: "Trip", date: "2026-10-10", endDate: "2026-10-13", allDay: true,
  });
  assert.deepEqual(b.end, { date: "2026-10-13" }); // 3-day block
});

await ok("tz offset shape + values", () => {
  assert.match(tzOffsetString(), /^[+-]\d{2}:\d{2}$/);
  const utcNoon = new Date("2026-01-01T12:00:00Z");
  const off = new Date(utcNoon).getTimezoneOffset();
  const expected = `${off <= 0 ? "+" : "-"}${String(Math.floor(Math.abs(off) / 60)).padStart(2, "0")}:${String(Math.abs(off) % 60).padStart(2, "0")}`;
  assert.equal(tzOffsetString(utcNoon), expected);
});

await ok("sage maps to Google colorId 2", () => {
  const b = buildGoogleEvent({ key: "evt:3", title: "x", date: "2026-10-02", allDay: true, color: "sage" });
  assert.equal(b.colorId, "2");
});

console.log("— gcal: itemHash —");

await ok("hash changes when time changes, stable otherwise", () => {
  const a: Parameters<typeof itemHash>[0] = { key: "k", title: "T", date: "2026-10-01", allDay: false, startMin: 60, endMin: 120 };
  const b = { ...a, startMin: 90 };
  const c = { ...a, title: "T2" };
  const a2 = { ...a };
  assert.equal(itemHash(a), itemHash(a2));
  assert.notEqual(itemHash(a), itemHash(b));
  assert.notEqual(itemHash(a), itemHash(c));
});

console.log("— gcal: mirrorSync (mock fetch) —");

type Call = { method: string; url: string; body?: Record<string, unknown> };
function mockFetch(log: Call[], responses: Map<string, { status?: number; body?: unknown }>) {
  return async (url: string, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    log.push({ method: init?.method ?? "GET", url, body });
    const key = `${init?.method} ${url}`;
    const r = responses.get(key) ?? responses.get(url) ?? { status: 200, body: { id: `gid-${log.length}` } };
    return {
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      text: async () => JSON.stringify(r.body ?? {}),
      json: async () => r.body ?? {},
    } as Response;
  };
}

const item = (key: string, title: string, startMin = 540): Parameters<typeof mirrorSync>[0][number] => ({
  key, title, date: "2026-10-05", allDay: false, startMin, endMin: startMin + 60, color: "coral",
});

await ok("first sync creates everything", async () => {
  resetSyncState();
  const log: Call[] = [];
  const res = await mirrorSync([item("evt:a", "A"), item("evt:b", "B")], "tok", { fetcher: mockFetch(log, new Map()) });
  assert.equal(res.created, 2);
  assert.equal(res.updated, 0);
  assert.equal(res.deleted, 0);
  assert.equal(log.length, 2);
  assert.ok(log.every((c) => c.method === "POST"));
  assert.equal(Object.keys(loadSyncMap()).length, 2);
});

await ok("second sync with no changes is a no-op", async () => {
  const log: Call[] = [];
  const items = [item("evt:a", "A"), item("evt:b", "B")];
  const res = await mirrorSync(items, "tok", { fetcher: mockFetch(log, new Map()) });
  assert.equal(res.created + res.updated + res.deleted, 0);
  assert.equal(log.length, 0);
});

await ok("changed item → PATCH; removed item → DELETE", async () => {
  const log: Call[] = [];
  const res = await mirrorSync([item("evt:a", "A moved", 600)], "tok", { fetcher: mockFetch(log, new Map()) });
  assert.equal(res.updated, 1);
  assert.equal(res.deleted, 1);
  assert.equal(log[0].method, "PATCH");
  assert.equal(log[1].method, "DELETE");
  assert.ok(log[1].url.includes("/events/"), "DELETE hits the event endpoint");
  assert.ok(/gid-\d/.test(log[1].url), "DELETE targets the stored Google event id");
  const map = loadSyncMap();
  assert.deepEqual(Object.keys(map), ["evt:a"]);
  assert.match(map["evt:a"].gid, /^gid-/);
});

await ok("per-item error does not abort the run", async () => {
  resetSyncState();
  const responses = new Map<string, { status: number; body?: unknown }>();
  // item A → 500 once; B fine; deletion of unknown gid fine
  const log: Call[] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    log.push({ method, url, body });
    if (method === "POST" && (body as { summary?: string })?.summary === "A") {
      return { ok: false, status: 500, statusText: "boom", text: async () => "server error", json: async () => ({}) } as Response;
    }
    return { ok: true, status: 200, text: async () => "{}", json: async () => ({ id: `gid-${log.length}` }) } as Response;
  };
  const res = await mirrorSync([item("evt:a", "A"), item("evt:b", "B")], "tok", { fetcher });
  assert.equal(res.created, 1);
  assert.equal(res.errors.length, 1);
  assert.match(res.errors[0], /A: Google API 500/);
  assert.ok(loadSyncMap()["evt:b"]);
  assert.ok(!loadSyncMap()["evt:a"]);
});

await ok("DELETE 404/410 counts as success", async () => {
  const log: Call[] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    log.push({ method, url });
    if (method === "DELETE") {
      return { ok: false, status: 410, text: async () => "gone", json: async () => ({}) } as Response;
    }
    return { ok: true, status: 200, text: async () => "{}", json: async () => ({ id: `g-${log.length}` }) } as Response;
  };
  resetSyncState();
  await mirrorSync([item("evt:a", "A")], "tok", { fetcher });
  const res = await mirrorSync([], "tok", { fetcher });
  assert.equal(res.deleted, 1);
  assert.equal(res.errors.length, 0);
});

console.log("— calitems: assembly —");

const tests: TestRecord[] = [
  { id: "t1", date: "2026-10-05", created_at: 1, name: "Physics chapter test", source: "in-app", type: "chapter", duration_min: 60, score: 42, max_score: 60, subject_scores: {} },
];
const syllabus: SyllabusRow[] = [
  { id: "Physics:Kinematics", chapter: "Kinematics", subject: "Physics", tier: 1, status: "Learning", notes: "", last_revised: null, revision_stage: 1, next_revision: "2026-10-06" },
  { id: "Maths:Sets", chapter: "Sets", subject: "Mathematics", tier: 2, status: "Maintenance", notes: "", last_revised: null, revision_stage: 3, next_revision: "2026-10-06" }, // Maintenance → excluded
];
const tasks: Task[] = [
  { id: "k1", text: "Buy register", done: false, created_at: 1, due_date: "2026-10-05" },
  { id: "k2", text: "Done thing", done: true, created_at: 1, due_date: "2026-10-05" },
  { id: "k3", text: "No date", done: false, created_at: 1 },
];
const events: CalEventRecord[] = [
  { id: "e1", title: "Maths block", date: "2026-10-05", start_min: 540, end_min: 630, allDay: false, color: "coral", created_at: 1, updated_at: 1 },
  { id: "e2", title: "Trip", date: "2026-10-10", end_date: "2026-10-12", start_min: 0, end_min: 0, allDay: true, color: "plum", created_at: 1, updated_at: 1 },
];

const input = { events, tests, syllabus, tasks };

await ok("assembly: right items with right kinds/colors", () => {
  const items = assembleItems(input);
  assert.ok(items.find((i) => i.key === "evt:e1" && i.kind === "event" && i.allDay === false));
  assert.ok(items.find((i) => i.key === "test:t1" && i.color === "coral" && i.subtitle === "Score 42/60"));
  assert.ok(items.find((i) => i.key === "rev:Physics:Kinematics" && i.color === "kraft"));
  assert.ok(items.find((i) => i.key === "task:k1" && i.color === "plum"));
  assert.ok(!items.find((i) => i.key === "rev:Maths:Sets")); // Maintenance excluded
  const e1 = items.find((i) => i.key === "evt:e1")!;
  assert.equal(e1.editable, true);
  assert.equal(e1.record?.id, "e1");
});

await ok("indexByDate: multi-day all-day events appear on every covered day", () => {
  const map = indexByDate(assembleItems(input));
  assert.ok(itemsOn(map, "2026-10-10").find((i) => i.key === "evt:e2"));
  assert.ok(itemsOn(map, "2026-10-11").find((i) => i.key === "evt:e2"));
  assert.ok(!itemsOn(map, "2026-10-12").find((i) => i.key === "evt:e2")); // exclusive end
  const day = itemsOn(map, "2026-10-05");
  assert.ok(day.find((i) => i.key === "evt:e1"));
  assert.ok(day.find((i) => i.key === "task:k1"));
  assert.ok(!day.find((i) => i.key === "task:k2")); // done tasks hidden
  assert.ok(!day.find((i) => i.key === "task:k3")); // undated hidden
});

console.log("— calitems: sync payload —");

await ok("includeStudyPlan=false → events only", () => {
  const payload = buildSyncItems(input, { includeStudyPlan: false });
  assert.deepEqual(payload.map((p) => p.key).sort(), ["evt:e1", "evt:e2"]);
});

await ok("includeStudyPlan=true → tests, revisions, undone dated tasks", () => {
  const payload = buildSyncItems(input, { includeStudyPlan: true });
  const keys = payload.map((p) => p.key);
  assert.ok(keys.includes("test:t1"));
  assert.ok(keys.includes("rev:Physics:Kinematics"));
  assert.ok(keys.includes("task:k1"));
  assert.ok(!keys.includes("task:k2"), "done tasks drop out");
  assert.ok(!keys.includes("task:k3"), "undated tasks excluded");
});

console.log("— calendar.ts: template links + ics —");

await ok("timed template link uses floating datetimes", () => {
  const url = googleCalUrl({ date: "2026-09-28", title: "Block", kind: "event", allDay: false, startMin: 540, endMin: 630 });
  assert.ok(url.includes("dates=20260928T090000/20260928T103000"));
  assert.ok(url.includes("text=Block"));
});

await ok("all-day template link uses dates", () => {
  const url = googleCalUrl({ date: "2026-09-28", title: "Mock", kind: "test" });
  assert.ok(url.includes("dates=20260928/20260929"));
});

await ok("ics: timed event → floating DTSTART/DTEND", () => {
  const ics = buildIcs([{ date: "2026-09-28", title: "Block", kind: "event", allDay: false, startMin: 540, endMin: 630 }]);
  assert.ok(ics.includes("DTSTART:20260928T090000"));
  assert.ok(ics.includes("DTEND:20260928T103000"));
  assert.ok(ics.includes("SUMMARY:Block"));
  assert.ok(ics.includes("\r\n"), "CRLF line endings");
});

await ok("ics: multi-day all-day", () => {
  const ics = buildIcs([{ date: "2026-10-10", endDate: "2026-10-13", title: "Trip", kind: "event" }]);
  assert.ok(ics.includes("DTSTART;VALUE=DATE:20261010"));
  assert.ok(ics.includes("DTEND;VALUE=DATE:20261013"));
});

await ok("ics: commas/semicolons escaped", () => {
  const ics = buildIcs([{ date: "2026-10-10", title: "Hello, world; test", kind: "event" }]);
  assert.ok(ics.includes("SUMMARY:Hello\\, world\\; test"));
});

console.log("— time helpers —");

await ok("parseHHMM / fmtMin / localStamp round-trip", () => {
  assert.equal(parseHHMM("09:30"), 570);
  assert.equal(parseHHMM("9:05"), 545);
  assert.equal(parseHHMM("24:00"), null);
  assert.equal(parseHHMM("ab:cd"), null);
  assert.equal(fmtMin(570), "09:30");
  assert.equal(fmtMin(0), "00:00");
  assert.equal(localStamp("2026-09-28", 540), "2026-09-28T09:00:00");
  assert.equal(localStamp("2026-09-28", 1439), "2026-09-28T23:59:00");
});

console.log(`\n${pass} checks passed${process.exitCode === 1 ? " — WITH FAILURES" : ""}`);
if (process.exitCode === 1) process.exit(1);
}

void main();
