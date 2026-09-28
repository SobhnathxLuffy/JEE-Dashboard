"use client";

// ─── CalendarView — a real Google-Calendar-grade calendar ────────────────────
// Day / week / month views on a time grid, drag-to-create time blocks,
// drag/resize events, all-day row, current-time line, .ics export — plus a
// genuine one-way sync to Google Calendar (app → Google) via the GIS token
// client, mirroring every item (events + optional study-plan items).
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Download,
  Pencil,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { PageTitle, SectionCard } from "./shared";
import { put, useLive } from "@/lib/idb";
import { downloadIcs, fmtMin, googleCalUrl, type CalEvent } from "@/lib/calendar";
import {
  assembleItems,
  buildSyncItems,
  indexByDate,
  itemsOn,
  type CalItem,
} from "@/lib/calitems";
import {
  ensureToken,
  getLastSync,
  getSyncOptions,
  isConnected,
  itemHash,
  mirrorSync,
  saveLastSync,
  setSyncOptions,
  type SyncOptions,
  type SyncResult,
} from "@/lib/gcal";
import { addDaysIso, addMonthsIso, KIND_LABEL, kindHint, periodLabel, weekStart } from "./calendar/calendar-shared";
import { TimeGridView } from "./calendar/TimeGridView";
import { MonthGridView } from "./calendar/MonthGridView";
import { EventDialog, type EventDialogState } from "./calendar/EventDialog";
import { GoogleSyncPanel } from "./calendar/GoogleSyncPanel";
import type { CalEventRecord } from "@/lib/types";

type CalViewMode = "day" | "week" | "month";

function nowMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

export function CalendarView() {
  const tests = useLive("tests");
  const syllabus = useLive("syllabus");
  const tasks = useLive("tasks");
  const events = useLive("cal_events");

  const today = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}`;
  }, []);
  const [view, setView] = useState<CalViewMode>("week");
  const [anchor, setAnchor] = useState(today);
  const [nowMin, setNowMin] = useState(nowMinutes);
  const [dialog, setDialog] = useState<EventDialogState>({ open: false, date: today, startMin: 540, endMin: 600 });
  const [infoItem, setInfoItem] = useState<CalItem | null>(null);

  // sync state is client-only (localStorage) — hydrate asynchronously to
  // avoid both SSR mismatch and setState-in-effect lint violations
  const [connected, setConnected] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<SyncResult | null>(null);
  const [options, setOptions] = useState<SyncOptions>({ includeStudyPlan: true, autoSync: true });
  const syncingRef = useRef(false);
  const firstSig = useRef(true);

  useEffect(() => {
    let alive = true;
    void Promise.resolve().then(() => {
      if (!alive) return;
      setConnected(isConnected());
      setLastSync(getLastSync());
      setOptions(getSyncOptions());
      if (window.innerWidth < 640) setView("day");
    });
    return () => {
      alive = false;
    };
  }, []);

  // current-time line ticks every 30s
  useEffect(() => {
    const t = window.setInterval(() => setNowMin(nowMinutes()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const input = useMemo(() => ({ events, tests, syllabus, tasks }), [events, tests, syllabus, tasks]);
  const items = useMemo(() => assembleItems(input), [input]);
  const dayIndex = useMemo(() => indexByDate(items), [items]);

  const days = useMemo(() => {
    if (view === "day") return [anchor];
    const start = weekStart(anchor);
    return Array.from({ length: 7 }, (_, i) => addDaysIso(start, i));
  }, [view, anchor]);

  function move(delta: number) {
    setAnchor((a) => (view === "month" ? addMonthsIso(a, delta) : addDaysIso(a, delta * (view === "week" ? 7 : 1))));
  }

  function openItem(item: CalItem) {
    if (item.editable && item.record) {
      setDialog({ open: true, record: item.record, date: item.date, startMin: item.startMin, endMin: item.endMin });
    } else {
      setInfoItem(item);
    }
  }

  async function saveMove(rec: CalEventRecord, startMin: number, endMin: number) {
    await put("cal_events", { ...rec, start_min: startMin, end_min: endMin, updated_at: Date.now() });
    toast.success(`Moved to ${fmtMin(startMin)}–${fmtMin(endMin)}`);
  }

  async function saveResize(rec: CalEventRecord, endMin: number) {
    await put("cal_events", { ...rec, end_min: endMin, updated_at: Date.now() });
    toast.success(`Ends at ${fmtMin(endMin)} now`);
  }

  function newItem() {
    const s = Math.min(Math.round(nowMinutes() / 15) * 15, 1380);
    setDialog({ open: true, date: anchor, startMin: s, endMin: s + 60 });
  }

  // ── Google sync ────────────────────────────────────────────────────────────
  const syncSig = useMemo(
    () =>
      buildSyncItems(input, { includeStudyPlan: options.includeStudyPlan })
        .map((i) => itemHash(i))
        .join("|"),
    [input, options.includeStudyPlan]
  );

  async function runSync(interactive: boolean) {
    if (syncingRef.current) return;
    if (!connected) {
      if (interactive) toast.error("Connect Google Calendar first");
      return;
    }
    syncingRef.current = true;
    setSyncing(true);
    try {
      const token = await ensureToken(interactive);
      const payload = buildSyncItems(input, { includeStudyPlan: options.includeStudyPlan });
      const res = await mirrorSync(payload, token);
      saveLastSync(res);
      setLastSync(res);
      if (res.errors.length > 0) {
        toast.warning(`Synced with ${res.errors.length} issue${res.errors.length === 1 ? "" : "s"}`, {
          description: res.errors[0],
        });
      } else {
        toast.success(
          res.created + res.updated + res.deleted === 0
            ? "Google Calendar is already up to date"
            : `Google Calendar updated — ${res.created} created · ${res.updated} updated · ${res.deleted} removed`
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const res: SyncResult = { at: Date.now(), created: 0, updated: 0, deleted: 0, errors: [msg] };
      saveLastSync(res);
      setLastSync(res);
      if (interactive) toast.error("Sync failed", { description: msg });
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }

  // auto-sync: debounced re-sync whenever the payload signature changes
  useEffect(() => {
    if (firstSig.current) {
      firstSig.current = false;
      return;
    }
    if (!connected || !options.autoSync || syncingRef.current) return;
    const t = window.setTimeout(() => void runSync(false), 4000);
    return () => window.clearTimeout(t);
  }, [syncSig, connected, options.autoSync]);

  function updateOptions(o: SyncOptions) {
    setOptions(o);
    setSyncOptions(o);
  }

  // ── .ics export ────────────────────────────────────────────────────────────
  function toCalEvent(i: CalItem): CalEvent {
    return {
      date: i.date,
      endDate: i.allDay ? i.endDate : undefined,
      title: i.title,
      detail: i.subtitle,
      kind: i.kind,
      allDay: i.allDay,
      startMin: i.allDay ? undefined : i.startMin,
      endMin: i.allDay ? undefined : i.endMin,
    };
  }

  function exportIcs(scope: "period" | "all") {
    const evs =
      scope === "all"
        ? items.map(toCalEvent)
        : Array.from(new Set(days.flatMap((d) => itemsOn(dayIndex, d).map((i) => i.key))))
            .map((k) => items.find((i) => i.key === k))
            .filter((i): i is CalItem => Boolean(i))
            .map(toCalEvent);
    const n = downloadIcs(evs, scope === "all" ? "jee-study-schedule.ics" : `jee-study-${anchor}.ics`);
    if (n === 0) return toast.error("Nothing to export in this period");
    toast.success(`${n} events exported — import the file in Google Calendar`);
  }

  const viewBtn = (m: CalViewMode, label: string) => (
    <button
      key={m}
      onClick={() => setView(m)}
      aria-pressed={view === m}
      className={cn(
        "press px-2.5 h-8 rounded-full text-xs font-medium transition-colors",
        view === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-5">
      <PageTitle
        title="Calendar"
        subtitle="Time-block your day on a real grid — then mirror everything to Google Calendar in one click."
      />

      <SectionCard
        title={periodLabel(view, anchor)}
        subtitle={
          view === "month"
            ? "click a day to open it · click a chip for details"
            : "drag on the grid to time-block · drag blocks to move · drag the bottom edge to resize"
        }
        action={
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <div className="flex items-center rounded-full border border-border p-0.5 mr-1">
              {viewBtn("day", "Day")}
              {viewBtn("week", "Week")}
              {viewBtn("month", "Month")}
            </div>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => move(-1)} aria-label="Previous period">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => {
                setAnchor(today);
              }}
            >
              Today
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => move(1)} aria-label="Next period">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button size="sm" className="h-8 gap-1.5" onClick={newItem}>
              <Plus className="h-3.5 w-3.5" /> New event
            </Button>
            <GoogleSyncPanel
              connected={connected}
              syncing={syncing}
              lastSync={lastSync}
              options={options}
              onOptionsChange={updateOptions}
              onSyncNow={() => void runSync(true)}
              onConnectedChange={setConnected}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1.5" aria-label="Export .ics">
                  <Download className="h-3.5 w-3.5" />
                  <span className="hidden lg:inline">.ics</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => exportIcs("period")}>This {view}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportIcs("all")}>Everything</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      >
        {view === "month" ? (
          <MonthGridView anchor={anchor} dayIndex={dayIndex} onDayClick={(d) => { setAnchor(d); setView("day"); }} onOpenItem={openItem} />
        ) : (
          <TimeGridView
            days={days}
            dayIndex={dayIndex}
            nowMin={nowMin}
            onOpenItem={openItem}
            onDayClick={(d) => { setAnchor(d); setView("day"); }}
            onCreateAt={(date, s, e) => setDialog({ open: true, date, startMin: s, endMin: e })}
            onMoveEvent={(rec, s, e) => void saveMove(rec, s, e)}
            onResizeEvent={(rec, e) => void saveResize(rec, e)}
          />
        )}
        <p className="text-[11px] text-muted-foreground/70 mt-3">
          coral = tests · kraft = revisions · plum = to-dos · your events carry the color you pick.
          Timed blocks are events you own; tests, revisions and to-dos stay in sync with their tabs.
        </p>
      </SectionCard>

      <EventDialog
        state={dialog}
        onClose={() => setDialog((d) => ({ ...d, open: false }))}
      />

      {/* item details (derived items + quick view) */}
      <Dialog open={infoItem !== null} onOpenChange={(o) => !o && setInfoItem(null)}>
        <DialogContent className="sm:max-w-sm" aria-describedby={undefined}>
          {infoItem ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 pr-6">
                  <span className={cn("h-2.5 w-2.5 rounded-full", infoItem.allDay ? "" : "")} />
                  {infoItem.title}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="text-[11px]">
                    {KIND_LABEL[infoItem.kind]}
                  </Badge>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {infoItem.allDay
                      ? infoItem.date
                      : `${infoItem.date} · ${fmtMin(infoItem.startMin)}–${fmtMin(infoItem.endMin)}`}
                  </span>
                </div>
                {infoItem.subtitle ? <p className="text-xs text-muted-foreground">{infoItem.subtitle}</p> : null}
                {infoItem.kind === "event" ? (
                  <p className="text-xs text-muted-foreground">Timed events sync to Google Calendar with their exact time.</p>
                ) : (
                  <p className="text-xs text-muted-foreground">{kindHint(infoItem.kind)}</p>
                )}
                <a
                  href={googleCalUrl(toCalEvent(infoItem) as CalEvent)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline font-medium"
                >
                  <CalendarPlus className="h-3 w-3" /> Add to Google (no sync setup needed)
                </a>
              </div>
              <DialogFooter className="gap-2">
                {infoItem.editable && infoItem.record ? (
                  <Button
                    size="sm"
                    className="gap-1.5"
                    onClick={() => {
                      const rec = infoItem.record!;
                      setInfoItem(null);
                      setDialog({ open: true, record: rec, date: rec.date, startMin: rec.start_min, endMin: rec.end_min });
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" /> Edit event
                  </Button>
                ) : null}
                <Button variant="outline" size="sm" onClick={() => setInfoItem(null)}>
                  Close
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
