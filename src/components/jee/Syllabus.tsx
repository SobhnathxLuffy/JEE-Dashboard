"use client";

// ─── Syllabus tracker: tiers, statuses, auto-color, revision loop, notes ────
// E4: mobile card layout (<md), overdue clarity ("DUE — N days ago"),
// per-row reschedule date input, debounce-saved notes.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  EmptyNote,
  HealthChip,
  PageTitle,
  SectionCard,
  StatusBadge,
  SubjectDot,
  TierBadge,
} from "./shared";
import { useLive, put } from "@/lib/idb";
import {
  CHAPTER_STATUSES,
  REVISION_INTERVALS_DAYS,
  addDays,
  todayStr,
  type ChapterStatus,
  type SyllabusRow,
} from "@/lib/types";
import { computeChapterHealth } from "@/lib/analytics";
import type { ChapterHealth } from "@/lib/analytics";

type SortMode = "tier" | "subject" | "due" | "risk";

export function SyllabusView() {
  const syllabus = useLive("syllabus");
  const responses = useLive("responses");
  const tests = useLive("tests");

  const [subjectFilter, setSubjectFilter] = useState<string>("all");
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortMode>("tier");
  const [notesOpen, setNotesOpen] = useState<string | null>(null);

  const health = useMemo(
    () => computeChapterHealth(responses, tests),
    [responses, tests]
  );

  const today = todayStr();

  const rows = useMemo(() => {
    let out = syllabus.filter((r) => {
      if (subjectFilter !== "all" && r.subject !== subjectFilter) return false;
      if (tierFilter !== "all" && String(r.tier) !== tierFilter) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (search.trim() && !r.chapter.toLowerCase().includes(search.trim().toLowerCase()))
        return false;
      return true;
    });
    const sorters: Record<SortMode, (a: SyllabusRow, b: SyllabusRow) => number> = {
      tier: (a, b) => a.tier - b.tier || a.subject.localeCompare(b.subject),
      subject: (a, b) => a.subject.localeCompare(b.subject) || a.tier - b.tier,
      due: (a, b) => {
        const ad = a.next_revision ? 1 : 0;
        const bd = b.next_revision ? 1 : 0;
        if (ad !== bd) return bd - ad;
        if (a.next_revision && b.next_revision)
          return a.next_revision.localeCompare(b.next_revision);
        return a.tier - b.tier;
      },
      risk: (a, b) => {
        const ha = health.get(`${a.subject}::${a.chapter}`);
        const hb = health.get(`${b.subject}::${b.chapter}`);
        const rank = (h: ChapterHealth | undefined) =>
          !h || h.accuracy === null ? 4 : h.accuracy < 40 ? 0 : h.accuracy < 70 ? 1 : h.accuracy < 85 ? 2 : 3;
        return rank(ha) - rank(hb) || a.tier - b.tier;
      },
    };
    out = [...out].sort(sorters[sort]);
    return out;
  }, [syllabus, subjectFilter, tierFilter, statusFilter, search, sort, health]);

  const counts = useMemo(() => {
    const green = [...health.values()].filter((h) => h.color === "green").length;
    const amber = [...health.values()].filter((h) => h.color === "amber").length;
    const red = [...health.values()].filter((h) => h.color === "red").length;
    const gated = syllabus.filter((s) => s.status === "70% Gate Passed" || s.status === "Maintenance").length;
    const due = syllabus.filter((s) => s.next_revision && s.next_revision <= today).length;
    return { green, amber, red, gated, due };
  }, [health, syllabus, today]);

  const update = useCallback(
    async (row: SyllabusRow, patch: Partial<SyllabusRow>) => {
      // starting work on a chapter arms the revision loop: first pass due SAME NIGHT
      if (patch.status && patch.next_revision === undefined && row.next_revision === null) {
        if (patch.status === "Learning" || patch.status === "PYQs Done") {
          await put("syllabus", {
            ...row,
            ...patch,
            revision_stage: 0,
            next_revision: todayStr(),
          });
          return;
        }
      }
      await put("syllabus", { ...row, ...patch });
    },
    []
  );

  const markRevised = useCallback(
    async (row: SyllabusRow) => {
      const stage = Math.min(row.revision_stage + 1, REVISION_INTERVALS_DAYS.length - 1);
      const nextDate = addDays(todayStr(), REVISION_INTERVALS_DAYS[stage]);
      await update(row, {
        last_revised: todayStr(),
        revision_stage: stage,
        next_revision: nextDate,
      });
      toast.success(
        REVISION_INTERVALS_DAYS[stage] === 0
          ? "Revisit scheduled for tonight"
          : `Next revision in ${REVISION_INTERVALS_DAYS[stage]} day(s) — the 1-3-7 loop continues`
      );
    },
    [update]
  );

  // E4c: reschedule — the date input writes next_revision directly
  const reschedule = useCallback(
    async (row: SyllabusRow, date: string) => {
      if (!date || date === row.next_revision) return; // cleared input = no-op, snaps back
      await update(row, { next_revision: date });
      toast.success(
        date === todayStr()
          ? "Revision moved to tonight"
          : `Next revision set to ${date}`
      );
    },
    [update]
  );

  return (
    <div className="space-y-6">
      <PageTitle
        title="Syllabus Tracker"
        subtitle="Tier-1 chapters deliver ~30% of each subject. Accuracy auto-colors chapters: ≥70% green (gate passed), 40–70% amber, <40% red. Deleted chapters are excluded entirely."
        right={
          <div className="flex gap-2 text-xs">
            <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-700">
              {counts.green} green
            </Badge>
            <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">
              {counts.amber} amber
            </Badge>
            <Badge variant="outline" className="border-red-200 bg-red-50 text-red-600">
              {counts.red} red
            </Badge>
            <Badge variant="outline" className="border-stone-300 text-stone-600">
              {counts.due} revision due
            </Badge>
          </div>
        }
      />

      <SectionCard
        title={`${rows.length} chapters`}
        subtitle="“70% Gate Passed” is a status you set — the color comes from your actual test data"
        action={
          <div className="flex gap-1.5">
            {(["tier", "risk", "due", "subject"] as SortMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setSort(m)}
                className={cn(
                  "px-2.5 py-1 rounded-full text-xs transition-colors",
                  sort === m ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-500 hover:bg-stone-200"
                )}
              >
                {m === "tier" ? "Tier-1 first" : m === "risk" ? "Weakest first" : m === "due" ? "Revision due" : "By subject"}
              </button>
            ))}
          </div>
        }
      >
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-4">
          <Select value={subjectFilter} onValueChange={setSubjectFilter}>
            <SelectTrigger aria-label="Subject filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All subjects</SelectItem>
              <SelectItem value="Physics">Physics</SelectItem>
              <SelectItem value="Chemistry">Chemistry</SelectItem>
              <SelectItem value="Mathematics">Mathematics</SelectItem>
            </SelectContent>
          </Select>
          <Select value={tierFilter} onValueChange={setTierFilter}>
            <SelectTrigger aria-label="Tier filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All tiers</SelectItem>
              <SelectItem value="1">Tier 1</SelectItem>
              <SelectItem value="2">Tier 2</SelectItem>
              <SelectItem value="3">Tier 3</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger aria-label="Status filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {CHAPTER_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search chapter…" />
        </div>

        {rows.length === 0 ? (
          <EmptyNote>No chapters match these filters.</EmptyNote>
        ) : (
          <>
            {/* E4a: stacked chapter cards below md — no horizontal scrolling on phones */}
            <div className="md:hidden space-y-3">
              {rows.map((r) => (
                <ChapterCard
                  key={r.id}
                  row={r}
                  health={health.get(`${r.subject}::${r.chapter}`)}
                  today={today}
                  notesOpen={notesOpen === r.id}
                  onOpenNotes={() => setNotesOpen(r.id)}
                  onCloseNotes={() => setNotesOpen(null)}
                  onUpdate={update}
                  onMarkRevised={markRevised}
                  onReschedule={reschedule}
                />
              ))}
            </div>

            {/* wide table stays for md+ */}
            <div className="hidden md:block overflow-x-auto max-h-[620px] overflow-y-auto border border-stone-100 rounded-lg">
              <table className="w-full text-sm min-w-[900px]">
                <thead className="text-left text-xs text-stone-400 uppercase bg-stone-50 sticky top-0">
                  <tr>
                    <th className="py-2 px-3">Chapter</th>
                    <th className="py-2 px-3">Tier</th>
                    <th className="py-2 px-3">Accuracy</th>
                    <th className="py-2 px-3">Status</th>
                    <th className="py-2 px-3">Revision</th>
                    <th className="py-2 px-3">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const h = health.get(`${r.subject}::${r.chapter}`);
                    return (
                      <tr key={r.id} className="border-t border-stone-100 align-top hover:bg-stone-50/60">
                        <td className="py-2.5 px-3">
                          <div className="font-medium text-stone-800">{r.chapter}</div>
                          <div className="text-[11px] text-stone-400">{r.subject}</div>
                        </td>
                        <td className="py-2.5 px-3"><TierBadge tier={r.tier} /></td>
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-1.5">
                            <HealthChip color={h?.color ?? "gray"} accuracy={h ? h.accuracy : null} />
                          </div>
                          {h ? (
                            <div className="text-[10px] text-stone-400 mt-0.5">
                              {h.correct}/{h.attempted} attempted
                            </div>
                          ) : null}
                        </td>
                        <td className="py-2.5 px-3">
                          <Select
                            value={r.status}
                            onValueChange={(v) => void update(r, { status: v as ChapterStatus })}
                          >
                            <SelectTrigger className="h-8 text-xs w-40" aria-label={`Status of ${r.chapter}`}>
                              <StatusBadge status={r.status} />
                            </SelectTrigger>
                            <SelectContent>
                              {CHAPTER_STATUSES.map((s) => (
                                <SelectItem key={s} value={s}>{s}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="py-2.5 px-3">
                          <RevisionControls
                            row={r}
                            today={today}
                            onMarkRevised={markRevised}
                            onReschedule={reschedule}
                          />
                        </td>
                        <td className="py-2.5 px-3">
                          {notesOpen === r.id ? (
                            <div className="w-64">
                              <NotesEditor
                                initial={r.notes}
                                onSave={(text) => void update(r, { notes: text })}
                                onDone={() => setNotesOpen(null)}
                              />
                            </div>
                          ) : (
                            <button
                              className="text-left text-xs text-stone-400 hover:text-stone-700 max-w-56 truncate block"
                              onClick={() => setNotesOpen(r.id)}
                            >
                              {r.notes || "+ add note"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </SectionCard>
    </div>
  );
}

// ─── E4b: revision-due badge with overdue clarity ────────────────────────────
function DueBadge({ next, today }: { next: string | null; today: string }) {
  if (!next) {
    return <span className="text-[11px] text-stone-300">not started loop</span>;
  }
  if (next === today) {
    return (
      <Badge variant="outline" className="w-fit border-emerald-400 bg-emerald-50 text-emerald-700">
        due tonight
      </Badge>
    );
  }
  if (next < today) {
    const n = diffDays(next, today);
    return (
      <Badge variant="outline" className="w-fit border-red-300 bg-red-50 text-red-700">
        DUE — {n} {n === 1 ? "day" : "days"} ago
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="w-fit border-stone-200 text-stone-400">
      in {diffDays(today, next)}d
    </Badge>
  );
}

// ─── E4c: revision controls — badge + reschedule date input + mark revised ──
function RevisionControls({
  row,
  today,
  onMarkRevised,
  onReschedule,
}: {
  row: SyllabusRow;
  today: string;
  onMarkRevised: (r: SyllabusRow) => void | Promise<void>;
  onReschedule: (r: SyllabusRow, date: string) => void | Promise<void>;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <DueBadge next={row.next_revision} today={today} />
      {row.next_revision ? (
        <span className="text-[10px] text-stone-400">
          stage {row.revision_stage + 1}/4
          {row.last_revised ? ` · last ${row.last_revised}` : ""}
        </span>
      ) : null}
      <div className="flex items-center gap-1.5 flex-wrap">
        <Input
          type="date"
          value={row.next_revision ?? ""}
          onChange={(e) => void onReschedule(row, e.target.value)}
          className="h-7 w-[8.5rem] px-2 text-[11px]"
          aria-label={`Reschedule revision for ${row.chapter}`}
        />
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[11px]"
          onClick={() => void onMarkRevised(row)}
        >
          Mark revised
        </Button>
      </div>
    </div>
  );
}

// ─── E4d: notes editor — debounce-save 600ms, flush on unmount ──────────────
function NotesEditor({
  initial,
  onSave,
  onDone,
}: {
  initial: string;
  onSave: (text: string) => void;
  onDone: () => void;
}) {
  const [text, setText] = useState(initial);
  const dirtyRef = useRef(false);
  const textRef = useRef(initial);
  const saveRef = useRef(onSave);
  const toastedRef = useRef(false);

  // keep the latest text + saver reachable for the unmount flush (outside render)
  useEffect(() => {
    textRef.current = text;
    saveRef.current = onSave;
  });

  const flush = useCallback((value: string) => {
    dirtyRef.current = false;
    saveRef.current(value);
    if (!toastedRef.current) {
      toastedRef.current = true;
      toast.success("Notes saved");
    }
  }, []);

  // debounce-save 600ms after typing stops
  useEffect(() => {
    if (!dirtyRef.current) return;
    const t = setTimeout(() => flush(text), 600);
    return () => clearTimeout(t);
  }, [text, flush]);

  // flush pending edits when the editor is closed/unmounted
  useEffect(() => {
    return () => {
      if (dirtyRef.current) flush(textRef.current);
    };
  }, [flush]);

  return (
    <div className="space-y-1.5">
      <Textarea
        value={text}
        rows={3}
        autoFocus
        onChange={(e) => {
          dirtyRef.current = true;
          setText(e.target.value);
        }}
        placeholder="weak spots, traps, key formulas…"
        aria-label="Chapter notes"
      />
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-stone-400">auto-saves as you type</span>
        <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

// ─── E4a: mobile chapter card (below md) ─────────────────────────────────────
function ChapterCard({
  row,
  health,
  today,
  notesOpen,
  onOpenNotes,
  onCloseNotes,
  onUpdate,
  onMarkRevised,
  onReschedule,
}: {
  row: SyllabusRow;
  health: ChapterHealth | undefined;
  today: string;
  notesOpen: boolean;
  onOpenNotes: () => void;
  onCloseNotes: () => void;
  onUpdate: (row: SyllabusRow, patch: Partial<SyllabusRow>) => void | Promise<void>;
  onMarkRevised: (r: SyllabusRow) => void | Promise<void>;
  onReschedule: (r: SyllabusRow, date: string) => void | Promise<void>;
}) {
  return (
    <div className="border border-stone-200 rounded-lg bg-white p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-sm text-stone-800 flex items-center gap-1">
            <SubjectDot subject={row.subject} />
            <span className="truncate">{row.chapter}</span>
          </div>
          <div className="text-[11px] text-stone-400 mt-0.5">
            {row.subject}
            {health ? ` · ${health.correct}/${health.attempted} attempted` : ""}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <TierBadge tier={row.tier} />
          <HealthChip color={health?.color ?? "gray"} accuracy={health ? health.accuracy : null} />
        </div>
      </div>

      <Select
        value={row.status}
        onValueChange={(v) => void onUpdate(row, { status: v as ChapterStatus })}
      >
        <SelectTrigger className="h-8 text-xs w-full" aria-label={`Status of ${row.chapter}`}>
          <StatusBadge status={row.status} />
        </SelectTrigger>
        <SelectContent>
          {CHAPTER_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>{s}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <RevisionControls row={row} today={today} onMarkRevised={onMarkRevised} onReschedule={onReschedule} />

      <div className="border-t border-stone-100 pt-2">
        {notesOpen ? (
          <NotesEditor
            initial={row.notes}
            onSave={(text) => void onUpdate(row, { notes: text })}
            onDone={onCloseNotes}
          />
        ) : (
          <button
            className="text-left text-xs text-stone-400 hover:text-stone-700 w-full truncate"
            onClick={onOpenNotes}
          >
            {row.notes || "+ add note"}
          </button>
        )}
      </div>
    </div>
  );
}

function diffDays(from: string, to: string): number {
  const a = new Date(`${from}T12:00:00`).getTime();
  const b = new Date(`${to}T12:00:00`).getTime();
  return Math.max(0, Math.round((b - a) / 86400000));
}
