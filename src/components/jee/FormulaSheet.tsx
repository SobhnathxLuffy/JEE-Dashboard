"use client";

// ─── Formula sheet — auto-collected from F-tagged mistakes ──────────────────
// Sprint D6: manual add at the top, "Mark learned" per row (learned rows move
// to a dimmed Learned section), and a link back to the source test's results.
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { NavController } from "./App";
import { EmptyNote, PageTitle, SectionCard, SubjectDot } from "./shared";
import { useLive, put, del } from "@/lib/idb";
import { SUBJECTS, uid, type FormulaEntry, type Subject } from "@/lib/types";

export function FormulaView({ nav }: { nav: NavController }) {
  const entries = useLive("formula");
  const syllabus = useLive("syllabus");
  const tests = useLive("tests");
  const [filter, setFilter] = useState<Subject | "all">("all");

  // D6a manual add form
  const [mSubject, setMSubject] = useState<Subject>("Physics");
  const [mChapter, setMChapter] = useState("");
  const [mSnippet, setMSnippet] = useState("");

  const mChapters = useMemo(
    () =>
      syllabus
        .filter((s) => s.subject === mSubject)
        .map((s) => s.chapter)
        .sort(),
    [syllabus, mSubject]
  );

  const testIds = useMemo(() => new Set(tests.map((t) => t.id)), [tests]);

  const shown = useMemo(
    () =>
      entries
        .filter((e) => (filter === "all" ? true : e.subject === filter))
        .sort((a, b) => b.created_at - a.created_at),
    [entries, filter]
  );

  const active = useMemo(() => shown.filter((e) => !e.learned), [shown]);
  const learned = useMemo(() => shown.filter((e) => e.learned), [shown]);

  const byChapter = useMemo(() => {
    const m = new Map<string, FormulaEntry[]>();
    for (const e of active) {
      const key = `${e.subject}::${e.chapter}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(e);
    }
    return [...m.entries()];
  }, [active]);

  async function addManual() {
    if (!mChapter) {
      toast.error("Pick a chapter");
      return;
    }
    if (!mSnippet.trim()) {
      toast.error("Write the formula or insight first");
      return;
    }
    await put("formula", {
      id: uid(),
      test_id: "manual",
      question_id: "manual",
      subject: mSubject,
      chapter: mChapter,
      snippet: mSnippet.trim(),
      learned: false,
      created_at: Date.now(),
    });
    toast.success("Added to formula sheet");
    setMSnippet(""); // keep subject/chapter for fast multi-add
  }

  async function toggleLearned(e: FormulaEntry) {
    await put("formula", { ...e, learned: !e.learned });
    if (!e.learned) toast.success("Marked learned — moved to the Learned section");
  }

  function openSourceTest(e: FormulaEntry) {
    // guard: manual entries have no test; deleted/external ids can't open results
    if (e.test_id === "manual" || e.question_id === "manual") return;
    if (!testIds.has(e.test_id)) {
      toast.error("That test is no longer in your log (deleted or not imported).");
      return;
    }
    nav.openResults(e.test_id);
  }

  const rowActions = (e: FormulaEntry, dimmed: boolean) => (
    <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
      {e.test_id !== "manual" ? (
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs"
          onClick={() => openSourceTest(e)}
        >
          Open test
        </Button>
      ) : (
        <Badge variant="outline" className="text-[10px] border-stone-200 text-stone-400">
          manual
        </Badge>
      )}
      <Button
        size="sm"
        variant={dimmed ? "outline" : "ghost"}
        className={cn("h-8 text-xs", !dimmed && "text-emerald-700 hover:bg-emerald-50")}
        onClick={() => void toggleLearned(e)}
      >
        {dimmed ? "Unmark" : "✓ Learned"}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-8 text-xs text-red-500 hover:text-red-600 hover:bg-red-50"
        onClick={() => {
          del("formula", e.id);
          toast.success("Removed from formula sheet");
        }}
      >
        Got it
      </Button>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageTitle
        title="Formula Sheet"
        subtitle="Auto-built from every mistake tagged F (Formula). This is the leak list — revise it the same night, then next day, then on the 1-3-7 loop."
        right={
          <div className="flex gap-1.5">
            {(["all", "Physics", "Chemistry", "Mathematics"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                aria-pressed={filter === s}
                className={`px-2.5 py-1 rounded-full text-xs transition-colors ${
                  filter === s ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-500 hover:bg-stone-200"
                }`}
              >
                {s === "all" ? "All" : s.slice(0, 1)}
              </button>
            ))}
          </div>
        }
      />

      {/* D6a: add manually */}
      <SectionCard
        title="Add manually"
        subtitle="a formula you missed without a test behind it still belongs on the leak list"
      >
        <div className="grid sm:grid-cols-[130px_1fr_1fr_auto] gap-2 items-end">
          <div className="space-y-1.5">
            <Label className="text-xs">Subject</Label>
            <Select
              value={mSubject}
              onValueChange={(v) => {
                setMSubject(v as Subject);
                setMChapter("");
              }}
            >
              <SelectTrigger aria-label="Subject"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SUBJECTS.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Chapter</Label>
            <Select value={mChapter} onValueChange={setMChapter}>
              <SelectTrigger aria-label="Chapter">
                <SelectValue placeholder="pick chapter" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {mChapters.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Formula / insight</Label>
            <Input
              value={mSnippet}
              onChange={(e) => setMSnippet(e.target.value)}
              placeholder="e.g. ω = ω₀ + αt; v² = u² + 2as"
              onKeyDown={(e) => {
                if (e.key === "Enter") void addManual();
              }}
            />
          </div>
          <Button onClick={() => void addManual()} className="bg-emerald-700 hover:bg-emerald-800 min-h-[44px]">
            Add
          </Button>
        </div>
      </SectionCard>

      {shown.length === 0 ? (
        <EmptyNote>
          Empty — which is good news or bad news. Open any test&apos;s results screen and tag a wrong
          answer with F to land it here, or add one manually above.
        </EmptyNote>
      ) : (
        <div className="space-y-4">
          <div className="text-sm text-stone-500 flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">
              {active.length} to revise
            </Badge>
            {learned.length > 0 ? (
              <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800">
                {learned.length} learned
              </Badge>
            ) : null}
            <span>each one is a question you got wrong for missing the formula</span>
          </div>

          {byChapter.length === 0 ? (
            <EmptyNote>Everything filtered is already marked learned. 🎉</EmptyNote>
          ) : (
            byChapter.map(([key, list]) => {
              const [subject, chapter] = key.split("::") as [Subject, string];
              return (
                <SectionCard key={key} title={chapter} subtitle={`${list.length} leak${list.length > 1 ? "s" : ""}`}>
                  <ul className="space-y-2">
                    {list.map((e) => (
                      <li
                        key={e.id}
                        className="border border-stone-200 rounded-lg px-3 py-2.5 flex items-start justify-between gap-3 hover:bg-stone-50 transition-colors"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center text-[11px] text-stone-400 mb-0.5">
                            <SubjectDot subject={subject} />
                            {subject}
                          </div>
                          <p className="text-sm text-stone-800">{e.snippet}</p>
                        </div>
                        {rowActions(e, false)}
                      </li>
                    ))}
                  </ul>
                </SectionCard>
              );
            })
          )}

          {/* D6b: learned entries collapse into a dimmed section at the bottom */}
          {learned.length > 0 ? (
            <SectionCard title={`Learned (${learned.length})`} subtitle="conquered leaks — skim them now and then">
              <ul className="space-y-2">
                {learned.map((e) => (
                  <li
                    key={e.id}
                    className="border border-stone-100 bg-stone-50 rounded-lg px-3 py-2.5 flex items-start justify-between gap-3 opacity-60 hover:opacity-90 transition-opacity"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center text-[11px] text-stone-400 mb-0.5">
                        <SubjectDot subject={e.subject} />
                        {e.subject} · {e.chapter}
                      </div>
                      <p className="text-sm text-stone-600 line-through decoration-stone-300">
                        {e.snippet}
                      </p>
                    </div>
                    {rowActions(e, true)}
                  </li>
                ))}
              </ul>
            </SectionCard>
          ) : null}
        </div>
      )}
    </div>
  );
}
