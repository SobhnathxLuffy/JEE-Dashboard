"use client";

// ─── CalendarView: tests + 1-3-7 revisions + to-dos on one month grid ───────
// Google Calendar sync, local-first style:
//   • every item has an "Add to Google" pre-filled template link
//   • .ics export (month or everything) → Google Calendar → Settings → Import
import { useMemo, useState } from "react";
import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  ListTree,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { EmptyNote, PageTitle, SectionCard } from "./shared";
import { put, del, useLive } from "@/lib/idb";
import { downloadIcs, googleCalUrl, type CalEvent } from "@/lib/calendar";
import { SUBJECT_SHORT, todayStr, uid, type Task } from "@/lib/types";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmtDay(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

export function CalendarView() {
  const tests = useLive("tests");
  const syllabus = useLive("syllabus");
  const tasks = useLive("tasks");

  const today = todayStr();
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const [selected, setSelected] = useState(today);
  const [newTask, setNewTask] = useState("");

  // ── events per day ────────────────────────────────────────────────────────
  const eventsByDate = useMemo(() => {
    const map: Record<string, CalEvent[]> = {};
    const push = (ev: CalEvent) => {
      (map[ev.date] ??= []).push(ev);
    };
    for (const t of tests) {
      push({
        date: t.date,
        title: t.name,
        detail:
          t.score !== null
            ? `Score ${t.score}/${t.max_score} · ${t.source}`
            : `${t.source} · awaiting key`,
        kind: "test",
      });
    }
    for (const row of syllabus) {
      if (!row.next_revision || row.status === "Maintenance") continue;
      push({
        date: row.next_revision,
        title: `Revise: ${row.chapter}`,
        detail: `${row.subject} · 1-3-7 loop, stage ${row.revision_stage + 1}`,
        kind: "revision",
      });
    }
    for (const t of tasks) {
      if (!t.due_date || t.done) continue;
      push({ date: t.due_date, title: t.text, kind: "task" });
    }
    return map;
  }, [tests, syllabus, tasks]);

  // all events sorted by date (for "export everything")
  const allEvents = useMemo(
    () => Object.values(eventsByDate).flat().sort((a, b) => a.date.localeCompare(b.date)),
    [eventsByDate]
  );

  // month events = everything in the visible month (tests regardless of month
  // boundary are naturally filtered by date prefix)
  const monthPrefix = `${cursor.y}-${`${cursor.m + 1}`.padStart(2, "0")}`;
  const monthEvents = useMemo(
    () => allEvents.filter((e) => e.date.startsWith(monthPrefix)),
    [allEvents, monthPrefix]
  );

  // ── grid cells (Sunday-first, 6 weeks) ───────────────────────────────────
  const cells = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const iso = `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}`;
      return { iso, day: d.getDate(), inMonth: d.getMonth() === cursor.m };
    });
  }, [cursor]);

  function moveMonth(delta: number) {
    setCursor((c) => {
      const d = new Date(c.y, c.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  }

  // ── selected-day slices ──────────────────────────────────────────────────
  const dayTests = tests.filter((t) => t.date === selected);
  const dayRevisions = syllabus.filter(
    (r) => r.next_revision === selected && r.status !== "Maintenance"
  );
  const dayTasks = tasks.filter((t) => t.due_date === selected);

  async function addTask() {
    const text = newTask.trim();
    if (!text) return;
    const task: Task = { id: uid(), text, done: false, created_at: Date.now(), due_date: selected };
    await put("tasks", task);
    setNewTask("");
    toast.success("Task added");
  }

  async function toggleTask(t: Task) {
    await put("tasks", { ...t, done: !t.done, done_at: !t.done ? Date.now() : undefined });
  }

  function exportMonth() {
    const n = downloadIcs(monthEvents, `jee-study-${monthPrefix}.ics`);
    if (n === 0) return toast.error("Nothing scheduled this month");
    toast.success(`${n} events exported — import the file in Google Calendar`);
  }

  function exportAll() {
    const n = downloadIcs(allEvents, "jee-study-schedule.ics");
    if (n === 0) return toast.error("Nothing scheduled yet");
    toast.success(`${n} events exported — import the file in Google Calendar`);
  }

  const kindChip: Record<CalEvent["kind"], string> = {
    test: "border-primary/30 bg-primary/10 text-primary",
    revision: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300",
    task: "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-300",
  };
  const kindDot: Record<CalEvent["kind"], string> = {
    test: "bg-primary",
    revision: "bg-amber-500",
    task: "bg-violet-500",
  };

  return (
    <div className="space-y-6">
      <PageTitle
        title="Calendar"
        subtitle="Tests, 1-3-7 revisions and to-dos on one grid — push any item to Google Calendar."
      />

      <SectionCard
        title={`${MONTHS[cursor.m]} ${cursor.y}`}
        subtitle="coral = tests · kraft = revisions · plum = tasks"
        action={
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => moveMonth(-1)} aria-label="Previous month">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => {
                const d = new Date();
                setCursor({ y: d.getFullYear(), m: d.getMonth() });
                setSelected(today);
              }}
            >
              Today
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => moveMonth(1)} aria-label="Next month">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={exportMonth}>
              <Download className="h-3.5 w-3.5" /> .ics (month)
            </Button>
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={exportAll}>
              <Download className="h-3.5 w-3.5" /> .ics (all)
            </Button>
          </div>
        }
      >
        <div className="grid grid-cols-7 gap-px rounded-lg border border-border bg-border overflow-hidden">
          {DOW.map((d) => (
            <div key={d} className="bg-muted/60 py-1.5 text-center text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
              {d}
            </div>
          ))}
          {cells.map((c) => {
            const evs = eventsByDate[c.iso] ?? [];
            const isToday = c.iso === today;
            return (
              <button
                key={c.iso}
                onClick={() => setSelected(c.iso)}
                className={cn(
                  "min-h-[64px] md:min-h-[84px] bg-card p-1 md:p-1.5 text-left align-top transition-colors press",
                  !c.inMonth && "bg-muted/30",
                  c.inMonth && "hover:bg-accent/50",
                  selected === c.iso && "ring-2 ring-inset ring-primary"
                )}
              >
                <span
                  className={cn(
                    "inline-grid place-items-center h-5 w-5 rounded-full text-[11px] font-medium tabular-nums",
                    isToday ? "bg-primary text-primary-foreground" : c.inMonth ? "text-foreground" : "text-muted-foreground/50"
                  )}
                >
                  {c.day}
                </span>
                <div className="mt-0.5 space-y-0.5">
                  {evs.slice(0, 2).map((ev, i) => (
                    <div
                      key={i}
                      className={cn(
                        "hidden md:block truncate rounded border px-1 py-px text-[9px] leading-3.5",
                        kindChip[ev.kind]
                      )}
                    >
                      {ev.title}
                    </div>
                  ))}
                  {evs.length > 0 ? (
                    <div className="md:hidden flex gap-0.5">
                      {evs.slice(0, 3).map((ev, i) => (
                        <span key={i} className={cn("h-1.5 w-1.5 rounded-full", kindDot[ev.kind])} />
                      ))}
                    </div>
                  ) : null}
                  {evs.length > 2 ? (
                    <div className="hidden md:block text-[9px] text-muted-foreground">+{evs.length - 2} more</div>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground/70 mt-3">
          Google Calendar, the local-first way — click{" "}
          <span className="font-medium">Add to Google</span> on any item, or download an{" "}
          <span className="font-medium">.ics</span> and import it (calendar.google.com → Settings →
          Import &amp; export). Re-export after rescheduling; a live two-way sync needs Google
          OAuth, which this offline app deliberately does not have.
        </p>
      </SectionCard>

      {/* selected day panel */}
      <SectionCard title={fmtDay(selected)} subtitle="everything scheduled for this day">
        <div className="grid md:grid-cols-3 gap-5">
          {/* tests */}
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground/70 font-medium mb-2 flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" /> Tests
            </div>
            {dayTests.length === 0 ? (
              <p className="text-xs text-muted-foreground/70">No tests logged.</p>
            ) : (
              <ul className="space-y-2">
                {dayTests.map((t) => (
                  <li key={t.id} className="rounded-lg border border-border px-3 py-2 text-sm">
                    <div className="font-medium truncate">{t.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {t.score !== null ? `${t.score}/${t.max_score} · ` : "awaiting key · "}
                      {t.source}
                    </div>
                    <GoogleLink event={{ date: t.date, title: t.name, detail: `JEE Study App — ${t.source}`, kind: "test" }} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* revisions */}
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground/70 font-medium mb-2 flex items-center gap-1.5">
              <ListTree className="h-3.5 w-3.5" /> 1-3-7 revisions
            </div>
            {dayRevisions.length === 0 ? (
              <p className="text-xs text-muted-foreground/70">Nothing due.</p>
            ) : (
              <ul className="space-y-2">
                {dayRevisions.map((r) => (
                  <li key={r.id} className="rounded-lg border border-border px-3 py-2 text-sm">
                    <div className="font-medium truncate">{r.chapter}</div>
                    <div className="text-xs text-muted-foreground">
                      {SUBJECT_SHORT[r.subject]} · stage {r.revision_stage + 1} of 4
                    </div>
                    <GoogleLink
                      event={{ date: r.next_revision!, title: `Revise: ${r.chapter}`, detail: `${r.subject} · 1-3-7 revision loop`, kind: "revision" }}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* tasks */}
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground/70 font-medium mb-2">To-dos</div>
            {dayTasks.length === 0 ? (
              <p className="text-xs text-muted-foreground/70">No tasks for this day yet.</p>
            ) : (
              <ul className="space-y-1.5 mb-2">
                {dayTasks.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5">
                    <input
                      type="checkbox"
                      checked={t.done}
                      onChange={() => void toggleTask(t)}
                      className="h-3.5 w-3.5 accent-[#c15f3c] dark:accent-[#d97757]"
                      aria-label={t.text}
                    />
                    <span className={cn("text-xs flex-1 min-w-0 truncate", t.done && "line-through text-muted-foreground/60")}>
                      {t.text}
                    </span>
                    <a
                      href={googleCalUrl({ date: t.due_date!, title: t.text, kind: "task" })}
                      target="_blank"
                      rel="noreferrer"
                      className="text-muted-foreground/60 hover:text-primary transition-colors shrink-0"
                      aria-label={`Add "${t.text}" to Google Calendar`}
                      title="Add to Google Calendar"
                    >
                      <CalendarPlus className="h-3.5 w-3.5" />
                    </a>
                    <button
                      onClick={() => void del("tasks", t.id)}
                      className="text-[10px] text-muted-foreground/60 hover:text-red-500"
                      aria-label="Delete task"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-1.5">
              <Input
                value={newTask}
                onChange={(e) => setNewTask(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void addTask()}
                placeholder="Add a to-do for this day…"
                className="h-8 text-xs"
              />
              <Button size="sm" className="h-8 px-2.5" onClick={() => void addTask()} aria-label="Add task">
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
        {allEvents.length === 0 ? (
          <div className="mt-4">
            <EmptyNote>
              Your calendar is empty — take a test, mark revisions in the syllabus tracker, or add
              to-dos and the grid fills itself.
            </EmptyNote>
          </div>
        ) : null}
      </SectionCard>
    </div>
  );
}

function GoogleLink({ event }: { event: CalEvent }) {
  return (
    <a
      href={googleCalUrl(event)}
      target="_blank"
      rel="noreferrer"
      className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-primary hover:underline font-medium"
    >
      <CalendarPlus className="h-3 w-3" aria-hidden="true" />
      Add to Google
    </a>
  );
}
