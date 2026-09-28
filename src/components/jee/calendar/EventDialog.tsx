"use client";

// ─── EventDialog — create / edit a calendar event (time block) ───────────────
// Times are minutes-from-midnight; the dialog enforces end > start (15-min
// steps) and caps blocks at 24h. Multi-day support for all-day spans.
// The form is a child component mounted only while the dialog is open, so its
// state initializes from props directly — no setState-in-effect syncing.
import { useState } from "react";
import { Trash2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { del, put } from "@/lib/idb";
import { fmtMin, parseHHMM } from "@/lib/calendar";
import { addDaysIso, EVENT_COLORS, EVENT_COLOR_KEYS } from "./calendar-shared";
import { uid, type CalEventRecord, type EventColor } from "@/lib/types";

export interface EventDialogState {
  open: boolean;
  record?: CalEventRecord; // edit mode when set
  date: string; // create-mode defaults
  startMin: number;
  endMin: number;
}

interface Props {
  state: EventDialogState;
  onClose: () => void;
  onSaved?: (rec: CalEventRecord) => void;
}

export function EventDialog({ state, onClose, onSaved }: Props) {
  const rec = state.record;
  // remount the form per target — even a same-slot reopen starts fresh
  const formKey = `${rec?.id ?? "new"}-${state.date}-${state.startMin}-${state.endMin}`;
  return (
    <Dialog open={state.open} onOpenChange={(o) => !o && onClose()}>
      {state.open ? (
        <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{rec ? "Edit event" : "New event"}</DialogTitle>
          </DialogHeader>
          <EventForm
            key={formKey}
            rec={rec}
            init={{ date: state.date, startMin: state.startMin, endMin: state.endMin }}
            onClose={onClose}
            onSaved={onSaved}
          />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

interface FormProps {
  rec?: CalEventRecord;
  init: { date: string; startMin: number; endMin: number };
  onClose: () => void;
  onSaved?: (rec: CalEventRecord) => void;
}

function EventForm({ rec, init, onClose, onSaved }: FormProps) {
  const [title, setTitle] = useState(rec?.title ?? "");
  const [notes, setNotes] = useState(rec?.notes ?? "");
  const [allDay, setAllDay] = useState(rec?.allDay ?? false);
  const [date, setDate] = useState(rec?.date ?? init.date);
  const [endDate, setEndDate] = useState(rec?.end_date ?? addDaysIso(rec?.date ?? init.date, 1));
  const [start, setStart] = useState(fmtMin(rec?.start_min ?? init.startMin));
  const [end, setEnd] = useState(fmtMin(rec?.end_min ?? init.endMin));
  const [color, setColor] = useState<EventColor>(rec?.color ?? "coral");

  async function save() {
    const startMin = parseHHMM(start) ?? 540;
    let endMin = parseHHMM(end) ?? 600;
    if (!allDay && endMin <= startMin) {
      endMin = Math.min(1440, startMin + 60);
      toast.info("End time was before the start — bumped to a 1-hour block");
    }
    const now = Date.now();
    const record: CalEventRecord = {
      id: rec?.id ?? uid(),
      title: title.trim() || "Untitled",
      notes: notes.trim() || undefined,
      date,
      start_min: allDay ? 0 : startMin,
      end_min: allDay ? 0 : endMin,
      allDay,
      end_date: allDay ? (endDate > date ? endDate : undefined) : undefined,
      color,
      created_at: rec?.created_at ?? now,
      updated_at: now,
    };
    await put("cal_events", record);
    onSaved?.(record);
    toast.success(rec ? "Event updated" : "Event added to calendar");
    onClose();
  }

  async function remove() {
    if (!rec) return;
    await del("cal_events", rec.id);
    toast.success("Event deleted");
    onClose();
  }

  return (
    <>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="ev-title">Title</Label>
          <Input
            id="ev-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Rotational motion — problem set"
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && void save()}
          />
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
          <Label htmlFor="ev-allday" className="text-sm font-normal cursor-pointer">
            All day
          </Label>
          <Switch id="ev-allday" checked={allDay} onCheckedChange={setAllDay} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="ev-date">{allDay ? "From" : "Date"}</Label>
            <Input id="ev-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          {allDay ? (
            <div className="space-y-1.5">
              <Label htmlFor="ev-enddate">Until (exclusive)</Label>
              <Input
                id="ev-enddate"
                type="date"
                value={endDate}
                min={addDaysIso(date, 1)}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="ev-start">Start</Label>
                <Input id="ev-start" type="time" step={900} value={start} onChange={(e) => setStart(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ev-end">End</Label>
                <Input id="ev-end" type="time" step={900} value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>
            </>
          )}
        </div>
        {!allDay && parseHHMM(end) !== null && parseHHMM(end)! <= (parseHHMM(start) ?? 0) ? (
          <p className="text-[11px] text-red-600 dark:text-red-400 -mt-2">
            End must be after start — saving bumps it to a 1-hour block.
          </p>
        ) : null}

        <div className="space-y-1.5">
          <Label>Color</Label>
          <div className="flex gap-2">
            {EVENT_COLOR_KEYS.map((k) => (
              <button
                key={k}
                type="button"
                aria-label={EVENT_COLORS[k].label}
                aria-pressed={color === k}
                onClick={() => setColor(k)}
                className={cn(
                  "h-7 w-7 rounded-full transition-transform press",
                  EVENT_COLORS[k].swatch,
                  color === k
                    ? "ring-2 ring-offset-2 ring-foreground/50 scale-110 ring-offset-background"
                    : "hover:scale-105 opacity-80"
                )}
              />
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ev-notes">Notes</Label>
          <Textarea
            id="ev-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional details — formulas to cover, pages, reminders…"
            className="min-h-[64px] text-sm"
          />
        </div>
      </div>
      <DialogFooter className="gap-2 sm:justify-between">
        {rec ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-red-600 hover:text-red-700 hover:bg-red-500/10"
            onClick={() => void remove()}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void save()}>
            {rec ? "Save changes" : "Add event"}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}
