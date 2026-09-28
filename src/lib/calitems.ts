// ─── Calendar item assembly (pure) ───────────────────────────────────────────
// Turns the four app sources (user events, tests, 1-3-7 revisions, dated
// to-dos) into one unified renderable item list, and into the Google sync
// payload. No React, no DOM — unit-tested in scripts/gcal.test.ts.
import type { CalEventRecord, SyllabusRow, Task, TestRecord, EventColor } from "./types";
import { addDays } from "./types";
import type { SyncItem } from "./gcal";

export type CalItemKind = "event" | "test" | "revision" | "task";

/** One row on the calendar grid — timed (start_min/end_min) or all-day. */
export interface CalItem {
  key: string; // evt:… | test:… | rev:… | task:…
  kind: CalItemKind;
  title: string;
  subtitle?: string; // score, stage, notes first line…
  date: string; // YYYY-MM-DD start
  endDate: string; // YYYY-MM-DD exclusive
  allDay: boolean;
  startMin: number;
  endMin: number;
  color: EventColor;
  editable: boolean; // user events only
  record?: CalEventRecord; // set for editable items
  syncedAt?: number; // google sync stamp (events only)
}

/** events span [date, end_date) — iterate the covered dates for grid lookup */
export function eventDates(ev: CalEventRecord): string[] {
  if (!ev.allDay || !ev.end_date) return [ev.date];
  const dates: string[] = [];
  const cur = new Date(`${ev.date}T12:00:00`);
  const end = new Date(`${ev.end_date}T12:00:00`);
  for (let i = 0; i < 62 && cur < end; i++) {
    dates.push(`${cur.getFullYear()}-${`${cur.getMonth() + 1}`.padStart(2, "0")}-${`${cur.getDate()}`.padStart(2, "0")}`);
    cur.setDate(cur.getDate() + 1);
  }
  return dates.length > 0 ? dates : [ev.date];
}

function sub(notes?: string): string | undefined {
  const first = notes?.split("\n")[0]?.trim();
  return first ? first : undefined;
}

export interface AssemblyInput {
  events: CalEventRecord[];
  tests: TestRecord[];
  syllabus: SyllabusRow[];
  tasks: Task[];
}

/** Build every calendar item, sorted: timed by start, then all-day. */
export function assembleItems(input: AssemblyInput): CalItem[] {
  const items: CalItem[] = [];

  for (const ev of input.events) {
    items.push({
      key: `evt:${ev.id}`,
      kind: "event",
      title: ev.title || "Untitled",
      subtitle: sub(ev.notes),
      date: ev.date,
      endDate: ev.allDay ? (ev.end_date ?? addDays(ev.date, 1)) : ev.date,
      allDay: ev.allDay,
      startMin: ev.start_min,
      endMin: ev.end_min,
      color: ev.color,
      editable: true,
      record: ev,
    });
  }

  for (const t of input.tests) {
    items.push({
      key: `test:${t.id}`,
      kind: "test",
      title: t.name,
      subtitle:
        t.score !== null ? `Score ${t.score}/${t.max_score}` : `${t.source} · awaiting key`,
      date: t.date,
      endDate: addDays(t.date, 1),
      allDay: true,
      startMin: 0,
      endMin: 0,
      color: "coral",
      editable: false,
    });
  }

  for (const r of input.syllabus) {
    if (!r.next_revision || r.status === "Maintenance") continue;
    items.push({
      key: `rev:${r.id}`,
      kind: "revision",
      title: `Revise: ${r.chapter}`,
      subtitle: `${r.subject} · stage ${r.revision_stage + 1} of 4`,
      date: r.next_revision,
      endDate: addDays(r.next_revision, 1),
      allDay: true,
      startMin: 0,
      endMin: 0,
      color: "kraft",
      editable: false,
    });
  }

  for (const t of input.tasks) {
    // done to-dos stay in the Dashboard list but drop off the calendar grid
    // (and off Google — the mirror deletes their event on the next sync)
    if (!t.due_date || t.done) continue;
    items.push({
      key: `task:${t.id}`,
      kind: "task",
      title: t.text,
      date: t.due_date,
      endDate: addDays(t.due_date, 1),
      allDay: true,
      startMin: 0,
      endMin: 0,
      color: "plum",
      editable: false,
    });
  }

  return items.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.allDay !== b.allDay) return a.allDay ? 1 : -1; // timed above all-day
    if (!a.allDay && !b.allDay && a.startMin !== b.startMin) return a.startMin - b.startMin;
    return a.key.localeCompare(b.key);
  });
}

/** Index: date → items overlapping that date (multi-day events included). */
export function indexByDate(items: CalItem[]): Map<string, CalItem[]> {
  const map = new Map<string, CalItem[]>();
  const push = (date: string, it: CalItem) => {
    (map.get(date) ?? map.set(date, []).get(date)!).push(it);
  };
  for (const it of items) {
    if (it.allDay) {
      // all-day: walk date..endDate (exclusive), bounded at 62 days
      const cur = new Date(`${it.date}T12:00:00`);
      const end = new Date(`${it.endDate}T12:00:00`);
      for (let i = 0; i < 62 && cur < end; i++) {
        push(
          `${cur.getFullYear()}-${`${cur.getMonth() + 1}`.padStart(2, "0")}-${`${cur.getDate()}`.padStart(2, "0")}`,
          it
        );
        cur.setDate(cur.getDate() + 1);
      }
    } else {
      push(it.date, it);
    }
  }
  return map;
}

/** The item's presence on a specific date (first covered date = canonical). */
export function itemsOn(map: Map<string, CalItem[]>, date: string): CalItem[] {
  return (map.get(date) ?? []).filter((it) => it.allDay || it.date === date);
}

// ─── sync payload ────────────────────────────────────────────────────────────

export const SYNC_KEYS = {
  test: (id: string) => `test:${id}`,
  rev: (id: string) => `rev:${id}`,
  task: (id: string) => `task:${id}`,
  evt: (id: string) => `evt:${id}`,
};

/** Local-only provenance footer so events on Google trace back to the app. */
const SOURCE_TAG = "— sent from JEE Study App";

/**
 * Build the Google sync payload.
 * - user events always sync (any event missing here = delete on Google)
 * - study-plan items (tests / revisions / dated to-dos) sync when opted in;
 *   completed to-dos drop out, so their Google event is cleaned up too.
 */
export function buildSyncItems(
  input: AssemblyInput,
  opts: { includeStudyPlan: boolean }
): SyncItem[] {
  const out: SyncItem[] = [];

  for (const ev of input.events) {
    out.push({
      key: `evt:${ev.id}`,
      title: ev.title || "Untitled",
      description: [ev.notes, SOURCE_TAG].filter(Boolean).join("\n"),
      date: ev.date,
      endDate: ev.allDay ? ev.end_date : undefined,
      allDay: ev.allDay,
      startMin: ev.start_min,
      endMin: ev.end_min,
      color: ev.color,
    });
  }

  if (!opts.includeStudyPlan) return out;

  for (const t of input.tests) {
    out.push({
      key: `test:${t.id}`,
      title: t.name,
      description: [
        t.score !== null ? `Score ${t.score}/${t.max_score}` : `${t.source} · awaiting key`,
        `JEE ${t.type} test`,
        SOURCE_TAG,
      ].join("\n"),
      date: t.date,
      allDay: true,
      color: "coral",
    });
  }

  for (const r of input.syllabus) {
    if (!r.next_revision || r.status === "Maintenance") continue;
    out.push({
      key: `rev:${r.id}`,
      title: `Revise: ${r.chapter}`,
      description: `${r.subject} · 1-3-7 revision loop, stage ${r.revision_stage + 1} of 4\n${SOURCE_TAG}`,
      date: r.next_revision,
      allDay: true,
      color: "kraft",
    });
  }

  for (const t of input.tasks) {
    if (!t.due_date || t.done) continue;
    out.push({
      key: `task:${t.id}`,
      title: t.text,
      description: `To-do due this day\n${SOURCE_TAG}`,
      date: t.due_date,
      allDay: true,
      color: "plum",
    });
  }

  return out;
}
