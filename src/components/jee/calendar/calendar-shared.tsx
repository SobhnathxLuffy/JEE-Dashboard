"use client";

// ─── Calendar shared atoms: color system + tiny helpers ─────────────────────
// Warm-palette event colors (Google Calendar's color chips, Claude edition).
// `block` = soft translucent block in the day/week grid, `chip` = solid chip
// in the month grid, `swatch` = the color picker dot.
import { cn } from "@/lib/utils";
import type { EventColor } from "@/lib/types";

export const EVENT_COLORS: Record<
  EventColor,
  { label: string; block: string; chip: string; swatch: string; dot: string }
> = {
  coral: {
    label: "Coral",
    block:
      "bg-emerald-500/14 border-emerald-400/50 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-50 dark:border-emerald-400/25",
    chip: "bg-emerald-500 text-white",
    swatch: "bg-emerald-500",
    dot: "bg-emerald-500",
  },
  kraft: {
    label: "Kraft",
    block:
      "bg-amber-500/14 border-amber-400/50 text-amber-900 dark:bg-amber-500/20 dark:text-amber-50 dark:border-amber-400/25",
    chip: "bg-amber-500 text-white",
    swatch: "bg-amber-500",
    dot: "bg-amber-500",
  },
  sage: {
    label: "Sage",
    block:
      "bg-orange-500/14 border-orange-400/50 text-orange-900 dark:bg-orange-500/20 dark:text-orange-50 dark:border-orange-400/25",
    chip: "bg-orange-600 text-white",
    swatch: "bg-orange-500",
    dot: "bg-orange-500",
  },
  plum: {
    label: "Plum",
    block:
      "bg-violet-500/14 border-violet-400/50 text-violet-900 dark:bg-violet-500/20 dark:text-violet-50 dark:border-violet-400/25",
    chip: "bg-violet-500 text-white",
    swatch: "bg-violet-500",
    dot: "bg-violet-500",
  },
  slate: {
    label: "Dusty blue",
    block:
      "bg-sky-500/14 border-sky-400/50 text-sky-900 dark:bg-sky-500/20 dark:text-sky-50 dark:border-sky-400/25",
    chip: "bg-sky-600 text-white",
    swatch: "bg-sky-500",
    dot: "bg-sky-500",
  },
  brick: {
    label: "Brick",
    block:
      "bg-red-500/14 border-red-400/50 text-red-900 dark:bg-red-500/20 dark:text-red-50 dark:border-red-400/25",
    chip: "bg-red-500 text-white",
    swatch: "bg-red-500",
    dot: "bg-red-500",
  },
};

export const EVENT_COLOR_KEYS = Object.keys(EVENT_COLORS) as EventColor[];

export const KIND_LABEL: Record<string, string> = {
  event: "Event",
  test: "Test",
  revision: "1-3-7 revision",
  task: "To-do",
};

/** Where a derived (non-editable) item is managed. */
export function kindHint(kind: string): string {
  switch (kind) {
    case "test":
      return "Tests are logged in New CBT / PDF Test / Log External and scored in Results.";
    case "revision":
      return "Revisions are scheduled by the 1-3-7 loop — mark a chapter revised in the Syllabus tracker.";
    case "task":
      return "To-dos live in the Dashboard to-do list — add a due date to pin one here.";
    default:
      return "";
  }
}

/** ISO date of a Date at local noon (deterministic across DST). */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}`;
}

/** Sunday-start week containing `date`. */
export function weekStart(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() - d.getDay());
  return isoDay(d);
}

export function addDaysIso(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + n);
  return isoDay(d);
}

export function addMonthsIso(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  return isoDay(d);
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function fmtDow(date: string): string {
  return DOW[new Date(`${date}T12:00:00`).getDay()];
}

export function fmtDom(date: string): number {
  return new Date(`${date}T12:00:00`).getDate();
}

export function periodLabel(view: "day" | "week" | "month", anchor: string): string {
  const d = new Date(`${anchor}T12:00:00`);
  if (view === "day") {
    return d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }
  if (view === "month") {
    return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  }
  const start = new Date(`${weekStart(anchor)}T12:00:00`);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const sameMonth = start.getMonth() === end.getMonth();
  const sameYear = start.getFullYear() === end.getFullYear();
  const s = `${sameMonth ? start.getDate() : start.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`;
  const e = `${end.getDate()}`;
  if (sameYear) return `${s} – ${e} ${MONTHS[end.getMonth()]} ${end.getFullYear()}`;
  return `${s} ${MONTHS[start.getMonth()]} ${start.getFullYear()} – ${e} ${MONTHS[end.getMonth()]} ${end.getFullYear()}`;
}

export { cn };
