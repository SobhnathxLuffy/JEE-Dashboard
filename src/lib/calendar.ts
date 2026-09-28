// ─── Calendar helpers (local-first) ──────────────────────────────────────────
// Pure functions shared by the calendar UI and the Google sync engine:
//   • Google "Add to Calendar" template links (no setup needed)
//   • RFC 5545 .ics export (Google Calendar → Settings → Import)
// Both understand all-day AND timed events. Times are minutes-from-midnight —
// no timezone math; floating local times are the correct RFC/Google encoding.
import { addDays } from "./types";

export type CalKind = "test" | "revision" | "task" | "event";

export interface CalEvent {
  date: string; // YYYY-MM-DD (start)
  title: string;
  detail?: string;
  kind: CalKind;
  /** true (or undefined) → all-day; false → timed block */
  allDay?: boolean;
  startMin?: number; // minutes from midnight
  endMin?: number; // minutes from midnight (exclusive end of the block)
  /** exclusive end date for multi-day all-day events (default: date + 1) */
  endDate?: string;
}

function pad(n: number): string {
  return `${n}`.padStart(2, "0");
}

function minsToHHMM(min: number): string {
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}

/** "2026-09-28" + 540 → "2026-09-28T09:00:00" (floating local time) */
export function localStamp(date: string, min: number): string {
  return `${date}T${minsToHHMM(min)}:00`;
}

/** All-day "Add to Google Calendar" pre-filled link (end date is exclusive).
 *  Timed events use floating local datetimes — Google renders them in the
 *  viewer's calendar timezone, which is exactly what we want. */
export function googleCalUrl(ev: CalEvent): string {
  const enc = encodeURIComponent;
  if (ev.allDay === false && typeof ev.startMin === "number" && typeof ev.endMin === "number") {
    const s = localStamp(ev.date, ev.startMin).replace(/[-:]/g, "");
    const e = localStamp(ev.date, ev.endMin).replace(/[-:]/g, "");
    const details = ev.detail ? `&details=${enc(ev.detail)}` : "";
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${enc(ev.title)}&dates=${s}/${e}${details}`;
  }
  const start = ev.date.replace(/-/g, "");
  const end = (ev.endDate ?? addDays(ev.date, 1)).replace(/-/g, "");
  const details = ev.detail ? `&details=${enc(ev.detail)}` : "";
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${enc(ev.title)}&dates=${start}/${end}${details}`;
}

function icsEsc(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** RFC 5545 VCALENDAR text — Google Calendar imports it losslessly.
 *  All-day: VALUE=DATE. Timed: floating local DATETIME (no Z, no TZID) —
 *  every compliant client interprets floating times in local time. */
export function buildIcs(evs: CalEvent[]): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, ""); // 20260928T093844Z — already UTC-suffixed
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//JEE Study App//Schedule//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:JEE Study Plan",
  ];
  evs.forEach((ev, i) => {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${ev.date}-${ev.kind}-${i}-${stamp}@jee-study-app`);
    lines.push(`DTSTAMP:${stamp}`);
    if (ev.allDay === false && typeof ev.startMin === "number" && typeof ev.endMin === "number") {
      const dur = Math.max(0, ev.endMin - ev.startMin);
      lines.push(`DTSTART:${localStamp(ev.date, ev.startMin).replace(/[-:]/g, "")}`);
      const endAbs = ev.startMin + dur;
      const endDate = endAbs >= 1440 ? addDays(ev.date, Math.floor(endAbs / 1440)) : ev.date;
      lines.push(`DTEND:${localStamp(endDate, endAbs % 1440).replace(/[-:]/g, "")}`);
    } else {
      const end = ev.endDate ?? addDays(ev.date, 1);
      lines.push(`DTSTART;VALUE=DATE:${ev.date.replace(/-/g, "")}`);
      lines.push(`DTEND;VALUE=DATE:${end.replace(/-/g, "")}`);
    }
    lines.push(`SUMMARY:${icsEsc(ev.title)}`);
    if (ev.detail) lines.push(`DESCRIPTION:${icsEsc(ev.detail)}`);
    lines.push("END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

export function downloadIcs(evs: CalEvent[], filename: string): number {
  if (evs.length === 0) return 0;
  const blob = new Blob([buildIcs(evs)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return evs.length;
}

/** "09:30" from minutes-from-midnight. */
export function fmtMin(min: number): string {
  return minsToHHMM(min);
}

/** minutes-from-midnight from "HH:MM" (or null when malformed). */
export function parseHHMM(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}
