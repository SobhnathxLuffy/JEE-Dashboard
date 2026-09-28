"use client";

// ─── MonthGridView — month grid with Google-Calendar-style chips ────────────
// Click a day → day view (Google behavior). Click a chip → item details.
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { fmtMin } from "@/lib/calendar";
import { EVENT_COLORS, isoDay } from "./calendar-shared";
import type { CalItem } from "@/lib/calitems";

interface Props {
  anchor: string; // any date inside the month to show
  dayIndex: Map<string, CalItem[]>;
  onDayClick: (date: string) => void;
  onOpenItem: (item: CalItem) => void;
}

export function MonthGridView({ anchor, dayIndex, onDayClick, onOpenItem }: Props) {
  const today = isoDay(new Date());

  const cells = useMemo(() => {
    const first = new Date(`${anchor}T12:00:00`);
    first.setDate(1);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return { iso: isoDay(d), day: d.getDate(), inMonth: d.getMonth() === first.getMonth() };
    });
  }, [anchor]);

  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden select-none">
      <div className="grid grid-cols-7 border-b border-border bg-muted/40">
        {DOW.map((d) => (
          <div key={d} className="py-1.5 text-center text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px bg-border">
        {cells.map((c) => {
          const items = (dayIndex.get(c.iso) ?? []).slice().sort((a, b) => (a.allDay === b.allDay ? 0 : a.allDay ? 1 : -1));
          const isToday = c.iso === today;
          return (
            <div
              key={c.iso}
              className={cn(
                "min-h-[72px] md:min-h-[96px] bg-card p-1 text-left align-top flex flex-col",
                !c.inMonth && "bg-muted/40",
                c.inMonth && "hover:bg-accent/40"
              )}
            >
              <button
                onClick={() => onDayClick(c.iso)}
                className="w-fit press rounded-full"
                aria-label={`Open day view for ${c.iso}`}
              >
                <span
                  className={cn(
                    "inline-grid place-items-center h-5 w-5 rounded-full text-[11px] font-medium tabular-nums",
                    isToday ? "bg-primary text-primary-foreground" : c.inMonth ? "text-foreground hover:bg-accent" : "text-muted-foreground/50"
                  )}
                >
                  {c.day}
                </span>
              </button>
              <div className="mt-0.5 space-y-0.5 min-h-0">
                {items.slice(0, 3).map((it) => (
                  <button
                    key={it.key}
                    onClick={() => onOpenItem(it)}
                    className={cn(
                      "hidden md:block w-full truncate rounded px-1 py-px text-left text-[9.5px] leading-3.5 press",
                      it.allDay ? EVENT_COLORS[it.color].chip : cn(EVENT_COLORS[it.color].block, "border")
                    )}
                    title={it.title}
                  >
                    {!it.allDay ? <span className="font-semibold tabular-nums">{fmtMin(it.startMin)} </span> : null}
                    {it.title}
                  </button>
                ))}
                {/* mobile dots */}
                {items.length > 0 ? (
                  <div className="md:hidden flex flex-wrap gap-0.5 px-0.5">
                    {items.slice(0, 5).map((it) => (
                      <span key={it.key} className={cn("h-1.5 w-1.5 rounded-full", EVENT_COLORS[it.color].dot)} />
                    ))}
                  </div>
                ) : null}
                {items.length > 3 ? (
                  <button
                    onClick={() => onDayClick(c.iso)}
                    className="hidden md:block text-[9px] font-medium text-muted-foreground hover:text-primary px-1"
                  >
                    +{items.length - 3} more
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
