// ─── Google Calendar bridge (local-first) ────────────────────────────────────
// The app has no backend / OAuth (deliberate), so "syncing with Google
// Calendar" is done the two ways Google officially supports without an API
// key:
//   1. per-event "Add to Google Calendar" template links (calendar.google.com/
//      calendar/render?action=TEMPLATE...) — one click, event pre-filled;
//   2. .ics export — download once, then Google Calendar → Settings →
//      Import & export (or add the .ics as a URL feed anywhere that hosts it).
import { addDays } from "./types";

export type CalKind = "test" | "revision" | "task";

export interface CalEvent {
  date: string; // YYYY-MM-DD
  title: string;
  detail?: string;
  kind: CalKind;
}

/** All-day "Add to Google Calendar" pre-filled link (end date is exclusive). */
export function googleCalUrl(ev: CalEvent): string {
  const start = ev.date.replace(/-/g, "");
  const end = addDays(ev.date, 1).replace(/-/g, "");
  const details = ev.detail ? `&details=${encodeURIComponent(ev.detail)}` : "";
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(ev.title)}&dates=${start}/${end}${details}`;
}

function icsDate(d: string): string {
  return d.replace(/-/g, "");
}

function icsEsc(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** RFC 5545 VCALENDAR text — Google Calendar imports it losslessly. */
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
    lines.push(
      "BEGIN:VEVENT",
      `UID:${ev.date}-${ev.kind}-${i}-${stamp}@jee-study-app`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(ev.date)}`,
      `DTEND;VALUE=DATE:${icsDate(addDays(ev.date, 1))}`,
      `SUMMARY:${icsEsc(ev.title)}`
    );
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
