"use client";

// ─── TimeGridView — the Google-Calendar-style day & week grid ────────────────
// • hour lines 00:00–24:00, 48px/hour, 15-min snapping
// • drag on empty space → create a time block of exactly the dragged range
// • drag a block → move it in 15-min steps (same day, Google-style)
// • drag the bottom edge → resize
// • overlap layout: clusters of concurrent events share the column width
// • all-day row above the grid (tests, revisions, to-dos, all-day events)
// • current-time line on today's column
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { fmtMin } from "@/lib/calendar";
import { EVENT_COLORS, fmtDow, fmtDom } from "./calendar-shared";
import type { CalEventRecord } from "@/lib/types";
import type { CalItem } from "@/lib/calitems";

const HOUR_H = 48; // px per hour → 1152px day
const PX_PER_MIN = HOUR_H / 60;
const SNAP = 15; // minutes

export interface DragPreview {
  date: string;
  startMin: number;
  endMin: number;
  key: string; // evt:key when moving/resizing an existing event
  mode: "create" | "move" | "resize";
}

interface Props {
  days: string[];
  dayIndex: Map<string, CalItem[]>;
  nowMin: number;
  onOpenItem: (item: CalItem) => void;
  onDayClick: (date: string) => void;
  onCreateAt: (date: string, startMin: number, endMin: number) => void;
  onMoveEvent: (rec: CalEventRecord, startMin: number, endMin: number) => void;
  onResizeEvent: (rec: CalEventRecord, endMin: number) => void;
}

/** lane layout: cluster overlapping events, one lane each inside a cluster */
function layoutLanes(evts: CalItem[]): { lanes: number; laneOf: Map<string, number> } {
  const laneOf = new Map<string, number>();
  let lanes = 1;
  let cluster: CalItem[] = [];
  let clusterEnd = -1;
  const laneCount = (list: CalItem[]) => {
    const ends: number[] = [];
    let max = 1;
    for (const e of list) {
      const idx = ends.findIndex((t) => t <= e.startMin);
      if (idx === -1) {
        ends.push(e.endMin);
        max = Math.max(max, ends.length);
      } else {
        ends[idx] = e.endMin;
      }
    }
    return max;
  };
  const flush = () => {
    const n = laneCount(cluster);
    lanes = Math.max(lanes, n);
    cluster.forEach((e, i) => laneOf.set(e.key, i % n));
    cluster = [];
    clusterEnd = -1;
  };
  for (const e of evts) {
    if (cluster.length > 0 && e.startMin >= clusterEnd) flush();
    cluster.push(e);
    clusterEnd = Math.max(clusterEnd, e.endMin);
  }
  flush();
  return { lanes, laneOf };
}

export function TimeGridView({ days, dayIndex, nowMin, onOpenItem, onDayClick, onCreateAt, onMoveEvent, onResizeEvent }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragPreview | null>(null);
  const dragRef = useRef<DragPreview | null>(null);
  const meta = useRef<{ grab: number; origStart: number; origEnd: number; moved: boolean; y0: number; rec?: CalEventRecord } | null>(null);
  const today = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}`;
  }, []);

  const setBoth = (d: DragPreview | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  // always-fresh callbacks for the window-level drag listeners
  const cb = useRef({ onOpenItem, onCreateAt, onMoveEvent, onResizeEvent });
  useEffect(() => {
    cb.current = { onOpenItem, onCreateAt, onMoveEvent, onResizeEvent };
  });

  const itemByKey = useMemo(() => {
    const map = new Map<string, CalItem>();
    for (const date of days) for (const it of dayIndex.get(date) ?? []) if (!it.allDay) map.set(it.key, it);
    return map;
  }, [days, dayIndex]);
  const cbKey = useRef(itemByKey);
  useEffect(() => {
    cbKey.current = itemByKey;
  }, [itemByKey]);

  // auto-scroll to ~now (or 7am) once on mount
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const t = days.includes(today) ? Math.max(0, (nowMin - 90) * PX_PER_MIN) : 7 * HOUR_H;
    el.scrollTop = Math.min(t, 24 * HOUR_H - el.clientHeight);
  }, []);

  const yToMin = (clientY: number): number => {
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const min = ((clientY - rect.top) / PX_PER_MIN) | 0;
    return Math.max(0, Math.min(1440, min));
  };
  const snap = (min: number): number => Math.round(min / SNAP) * SNAP;

  // window-level move/up while a drag is active
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      const m = meta.current;
      if (!d || !m) return;
      const cur = snap(yToMin(e.clientY));
      if (Math.abs(e.clientY - m.y0) > 4) m.moved = true;
      if (d.mode === "create") {
        const start = Math.min(d.startMin, cur);
        const end = Math.max(Math.max(d.startMin, cur), start + SNAP);
        setBoth({ ...d, startMin: start, endMin: Math.min(end, 1440) });
      } else if (d.mode === "move" && m.rec) {
        const start = Math.max(0, Math.min(1440 - (m.origEnd - m.origStart), snap(cur - m.grab)));
        setBoth({ ...d, startMin: start, endMin: start + (m.origEnd - m.origStart) });
      } else if (d.mode === "resize" && m.rec) {
        const end = Math.max(m.origStart + SNAP, Math.min(1440, cur));
        setBoth({ ...d, endMin: end });
      }
    };
    const onUp = () => {
      const d = dragRef.current;
      const m = meta.current;
      setBoth(null);
      meta.current = null;
      if (!d || !m) return;
      if (d.mode === "create") {
        const s = Math.min(d.startMin, 1440 - 60);
        if (m.moved) cb.current.onCreateAt(d.date, d.startMin, d.endMin);
        else cb.current.onCreateAt(d.date, s, s + 60);
      } else if (m.rec) {
        const it = cbKey.current.get(d.key);
        if (!m.moved) {
          if (it) cb.current.onOpenItem(it);
        } else if (d.mode === "move") {
          cb.current.onMoveEvent(m.rec, d.startMin, d.endMin);
        } else {
          cb.current.onResizeEvent(m.rec, d.endMin);
        }
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [drag !== null]);

  const cols = `56px repeat(${days.length}, minmax(0, 1fr))`;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden select-none">
      {/* header: day names */}
      <div className="grid border-b border-border bg-muted/40" style={{ gridTemplateColumns: cols }}>
        <div className="border-r border-border" />
        {days.map((d) => {
          const isToday = d === today;
          return (
            <button
              key={d}
              onClick={() => onDayClick(d)}
              aria-label={`Open day view for ${d}`}
              className={cn(
                "py-1.5 text-center border-r last:border-r-0 border-border transition-colors hover:bg-accent/60",
                isToday && "bg-primary/5"
              )}
            >
              <div className={cn("text-[10px] uppercase tracking-wide", isToday ? "text-primary font-semibold" : "text-muted-foreground")}>
                {fmtDow(d)}
              </div>
              <div
                className={cn(
                  "mx-auto mt-0.5 grid h-6 w-6 place-items-center rounded-full text-sm font-medium tabular-nums",
                  isToday ? "bg-primary text-primary-foreground" : "text-foreground"
                )}
              >
                {fmtDom(d)}
              </div>
            </button>
          );
        })}
      </div>

      {/* all-day row */}
      <div className="grid border-b border-border bg-muted/20" style={{ gridTemplateColumns: cols }}>
        <div className="border-r border-border pt-2 pr-1 text-right text-[9px] uppercase tracking-wide text-muted-foreground/70">
          All day
        </div>
        {days.map((d) => {
          const allDay = (dayIndex.get(d) ?? []).filter((i) => i.allDay);
          return (
            <div key={d} className="border-r last:border-r-0 border-border px-1 py-1 space-y-1 min-h-[34px]">
              {allDay.map((it) => (
                <button
                  key={it.key}
                  onClick={() => onOpenItem(it)}
                  className={cn(
                    "block w-full truncate rounded border px-1.5 py-0.5 text-left text-[10px] leading-4 press",
                    EVENT_COLORS[it.color].block
                  )}
                  title={it.subtitle ? `${it.title} — ${it.subtitle}` : it.title}
                >
                  {it.title}
                </button>
              ))}
            </div>
          );
        })}
      </div>

      {/* scrollable time grid */}
      <div ref={scrollRef} className="overflow-y-auto max-h-[560px] overscroll-contain">
        <div ref={gridRef} className="relative grid" style={{ gridTemplateColumns: cols, height: 24 * HOUR_H }}>
          {/* hour gutter */}
          <div className="relative border-r border-border">
            {Array.from({ length: 24 }, (_, h) => (
              <div
                key={h}
                className="absolute right-1.5 -translate-y-1/2 text-[9px] tabular-nums text-muted-foreground/70"
                style={{ top: h * HOUR_H }}
              >
                {h === 0 ? "" : fmtMin(h * 60)}
              </div>
            ))}
          </div>
          {days.map((date) => {
            const timed = (dayIndex.get(date) ?? []).filter((i) => !i.allDay);
            const { lanes, laneOf } = layoutLanes(timed);
            const isToday = date === today;
            return (
              <div
                key={date}
                className={cn("relative border-r last:border-r-0 border-border", isToday && "bg-primary/[0.035]")}
                style={{ touchAction: "none" }}
                onPointerDown={(e) => {
                  if (e.pointerType === "mouse" && e.button !== 0) return;
                  const min = snap(yToMin(e.clientY));
                  meta.current = { grab: 0, origStart: min, origEnd: min, moved: false, y0: e.clientY };
                  setBoth({ key: "__new", mode: "create", date, startMin: min, endMin: min });
                }}
              >
                {/* hour + half-hour lines */}
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={`h${h}`} className="absolute inset-x-0 border-t border-border/60" style={{ top: h * HOUR_H }} />
                ))}
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={`hh${h}`} className="absolute inset-x-0 border-t border-border/25" style={{ top: h * HOUR_H + HOUR_H / 2 }} />
                ))}
                {/* current time line */}
                {isToday && (
                  <div className="absolute inset-x-0 z-30 pointer-events-none" style={{ top: nowMin * PX_PER_MIN }}>
                    <div className="relative border-t-2 border-red-500/80">
                      <span className="absolute -left-1 -top-[3.5px] h-2 w-2 rounded-full bg-red-500" />
                    </div>
                  </div>
                )}
                {/* timed events */}
                {timed.map((it) => {
                  const isDrag = drag !== null && drag.key === it.key;
                  const start = isDrag && drag ? drag.startMin : it.startMin;
                  const end = isDrag && drag ? drag.endMin : it.endMin;
                  const lane = laneOf.get(it.key) ?? 0;
                  const width = 100 / lanes;
                  const c = EVENT_COLORS[it.color];
                  return (
                    <div
                      key={it.key}
                      role="button"
                      aria-label={`${fmtMin(it.startMin)} ${it.title}`}
                      className={cn(
                        "absolute z-10 rounded-md border px-1.5 py-0.5 overflow-hidden cursor-grab active:cursor-grabbing transition-shadow hover:shadow-sm",
                        c.block,
                        isDrag && "opacity-80 z-20 shadow-md"
                      )}
                      style={{
                        top: start * PX_PER_MIN + 1,
                        height: Math.max(16, (end - start) * PX_PER_MIN - 2),
                        left: `calc(${lane * width}% + 2px)`,
                        width: `calc(${width}% - 4px)`,
                      }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        meta.current = {
                          grab: Math.round(((e.clientY - (gridRef.current?.getBoundingClientRect()?.top ?? 0)) / PX_PER_MIN - it.startMin) / SNAP) * SNAP,
                          origStart: it.startMin,
                          origEnd: it.endMin,
                          moved: false,
                          y0: e.clientY,
                          rec: it.record,
                        };
                        setBoth({ key: it.key, mode: "move", date, startMin: it.startMin, endMin: it.endMin });
                      }}
                    >
                      <div className="text-[10px] font-semibold leading-3.5 truncate tabular-nums opacity-80">
                        {fmtMin(it.startMin)}
                      </div>
                      <div className="text-[11px] leading-4 font-medium truncate">{it.title}</div>
                      {end - start >= 90 && it.subtitle ? (
                        <div className="text-[10px] leading-3.5 truncate opacity-70">{it.subtitle}</div>
                      ) : null}
                      {/* resize handle */}
                      {it.record ? (
                        <div
                          className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            meta.current = {
                              grab: 0,
                              origStart: it.startMin,
                              origEnd: it.endMin,
                              moved: false,
                              y0: e.clientY,
                              rec: it.record,
                            };
                            setBoth({ key: it.key, mode: "resize", date, startMin: it.startMin, endMin: it.endMin });
                          }}
                        />
                      ) : null}
                    </div>
                  );
                })}
                {/* drag preview */}
                {drag && drag.date === date ? (
                  <div
                    className={cn(
                      "absolute z-40 rounded-md border-2 border-dashed pointer-events-none",
                      drag.mode === "create" ? "border-primary bg-primary/10" : "border-current opacity-60"
                    )}
                    style={{
                      top: drag.startMin * PX_PER_MIN,
                      height: Math.max(10, (drag.endMin - drag.startMin) * PX_PER_MIN),
                      left: 2,
                      right: 2,
                    }}
                  >
                    {drag.mode === "create" ? (
                      <div className="px-1 pt-0.5 text-[9px] font-semibold tabular-nums text-primary">
                        {fmtMin(drag.startMin)} – {fmtMin(drag.endMin)}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
