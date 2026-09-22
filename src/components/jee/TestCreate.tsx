"use client";

// ─── Test creation: pick chapters (auto-select) or questions, set duration ──
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
import { EmptyNote, PageTitle, SectionCard } from "./shared";
import { useLive } from "@/lib/idb";
import {
  SUBJECTS,
  uid,
  type ActiveSession,
  type Question,
  type Subject,
  type TestType,
} from "@/lib/types";

export function TestCreateView({ nav }: { nav: NavController }) {
  const questions = useLive("questions");
  const syllabus = useLive("syllabus");

  const [pickMode, setPickMode] = useState<"chapters" | "manual">("chapters");
  const [testType, setTestType] = useState<TestType>("chapter");
  const [name, setName] = useState("");
  const [duration, setDuration] = useState("10");
  const [durationTouched, setDurationTouched] = useState(false);

  // chapters mode
  const [activeSubject, setActiveSubject] = useState<Subject>("Physics");
  const [picked, setPicked] = useState<Record<Subject, string[]>>({
    Physics: [],
    Chemistry: [],
    Mathematics: [],
  });
  const [perChapter, setPerChapter] = useState("5");

  // manual mode
  const [selected, setSelected] = useState<string[]>([]);
  const [fSubject, setFSubject] = useState<string>("all");
  const [fSearch, setFSearch] = useState("");

  const chaptersOf = useMemo(() => {
    const m = new Map<Subject, string[]>();
    for (const s of SUBJECTS) {
      m.set(
        s,
        syllabus.filter((r) => r.subject === s).map((r) => r.chapter)
      );
    }
    return m;
  }, [syllabus]);

  const bankByChapter = useMemo(() => {
    const m = new Map<string, Question[]>();
    for (const q of questions) {
      const key = `${q.subject}::${q.chapter}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(q);
    }
    return m;
  }, [questions]);

  const totalPicked = useMemo(() => {
    if (pickMode === "manual") return selected.length;
    let n = 0;
    for (const subj of SUBJECTS) {
      for (const ch of picked[subj]) {
        const pool = bankByChapter.get(`${subj}::${ch}`) ?? [];
        n += Math.min(pool.length, Number(perChapter) || 5);
      }
    }
    return n;
  }, [pickMode, selected, picked, bankByChapter, perChapter]);

  const suggestedDuration = useMemo(() => {
    if (testType === "full") return 180;
    return Math.max(1, totalPicked);
  }, [testType, totalPicked]);

  function autoDuration() {
    setDuration(String(suggestedDuration));
    setDurationTouched(false);
  }

  const manualPool = useMemo(() => {
    return questions
      .filter((q) => (fSubject === "all" ? true : q.subject === fSubject))
      .filter((q) =>
        fSearch.trim() === ""
          ? true
          : q.question.toLowerCase().includes(fSearch.trim().toLowerCase())
      )
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, 120);
  }, [questions, fSubject, fSearch]);

  function toggleChapter(subj: Subject, ch: string) {
    setPicked((prev) => {
      const cur = prev[subj];
      return {
        ...prev,
        [subj]: cur.includes(ch) ? cur.filter((c) => c !== ch) : [...cur, ch],
      };
    });
  }

  function buildSession() {
    let ids: string[] = [];
    if (pickMode === "manual") {
      if (selected.length === 0) {
        toast.error("Select at least one question");
        return;
      }
      ids = selected;
    } else {
      if (totalPicked === 0) {
        toast.error("Pick at least one chapter with questions in the bank");
        return;
      }
      for (const subj of SUBJECTS) {
        for (const ch of picked[subj]) {
          const pool = [...(bankByChapter.get(`${subj}::${ch}`) ?? [])];
          // interleave MCQ / numerical for variety, then cap at perChapter
          const mcq = pool.filter((q) => q.type === "MCQ");
          const num = pool.filter((q) => q.type === "numerical");
          const mixed: Question[] = [];
          let i = 0;
          while (mixed.length < pool.length) {
            if (i < mcq.length) mixed.push(mcq[i]);
            if (i < num.length) mixed.push(num[i]);
            i += 1;
            if (i > pool.length) break;
          }
          const cap = Number(perChapter) || 5;
          ids.push(...mixed.slice(0, cap).map((q) => q.id));
        }
      }
    }
    if (ids.length === 0) {
      toast.error("No questions selected");
      return;
    }
    // order by subject P → C → M
    const ordered: string[] = [];
    for (const subj of SUBJECTS) {
      const byId = new Map(questions.map((q) => [q.id, q]));
      ordered.push(
        ...ids.filter((id) => byId.get(id)?.subject === subj)
      );
    }
    const mins = Math.max(1, Number(duration) || 1);
    const session: ActiveSession = {
      key: "active",
      test_id: uid(),
      mode: "cbt",
      test_type: testType,
      name:
        name.trim() ||
        (testType === "full"
          ? "Full mock"
          : `${testType === "chapter" ? "Chapter test" : "Test"} — ${totalPicked} Qs`),
      subject_order: [...SUBJECTS].filter((s) =>
        ordered.some((id) => questions.find((q) => q.id === id)?.subject === s)
      ),
      question_ids: ordered,
      duration_min: mins,
      started_at: Date.now(),
      answers: {},
      marked: [],
      current: 0,
      q_times: {},
      q_entered_at: Date.now(),
    };
    nav.startSession(session);
  }

  const pickedChapters = useMemo(
    () => [...picked.Physics, ...picked.Chemistry, ...picked.Mathematics],
    [picked]
  );

  return (
    <div className="space-y-6">
      <PageTitle
        title="New CBT"
        subtitle="Chapter tests are first-class citizens — a Day-10 chapter test beats a 3-hour mock. Timer is configurable per test."
      />

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <SectionCard title="Test setup">
            <div className="grid sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Test type</Label>
                <Select
                  value={testType}
                  onValueChange={(v) => setTestType(v as TestType)}
                >
                  <SelectTrigger aria-label="Test type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="chapter">Chapter test</SelectItem>
                    <SelectItem value="mixed">Mixed test</SelectItem>
                    <SelectItem value="part">Part-syllabus</SelectItem>
                    <SelectItem value="full">Full mock (20 MCQ + 5 NUM / subject)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs">Name (optional)</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Electrostatics — first pass"
                />
              </div>
            </div>
            <div className="flex items-end gap-3 mt-3">
              <div className="space-y-1.5 w-40">
                <Label className="text-xs">Duration (minutes)</Label>
                <Input
                  value={duration}
                  onChange={(e) => {
                    setDuration(e.target.value);
                    setDurationTouched(true);
                  }}
                  inputMode="numeric"
                />
              </div>
              <Button variant="outline" size="sm" onClick={autoDuration} className="mb-0.5">
                Suggest {suggestedDuration} min
              </Button>
              <p className="text-xs text-stone-400 mb-1.5">
                {testType === "full"
                  ? "Full mock = 180 min (25 Qs × 3 subjects)"
                  : "Rule of thumb: 1 min per question for chapter tests"}
              </p>
            </div>
          </SectionCard>

          {pickMode === "chapters" ? (
            <SectionCard
              title="Pick chapters"
              subtitle="questions are auto-selected from the bank — MCQs and numericals interleaved"
              action={
                <div className="flex items-center gap-2">
                  <Label className="text-xs whitespace-nowrap">Qs per chapter</Label>
                  <Input
                    value={perChapter}
                    onChange={(e) => setPerChapter(e.target.value)}
                    className="w-20"
                    inputMode="numeric"
                  />
                </div>
              }
            >
              <div className="flex gap-1.5 mb-3">
                {SUBJECTS.map((s) => (
                  <button
                    key={s}
                    onClick={() => setActiveSubject(s)}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-sm transition-colors",
                      activeSubject === s
                        ? "bg-emerald-700 text-white font-medium"
                        : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 max-h-64 overflow-y-auto p-1">
                {(chaptersOf.get(activeSubject) ?? []).map((ch) => {
                  const on = picked[activeSubject].includes(ch);
                  const count = (bankByChapter.get(`${activeSubject}::${ch}`) ?? []).length;
                  return (
                    <button
                      key={ch}
                      onClick={() => toggleChapter(activeSubject, ch)}
                      disabled={count === 0}
                      className={cn(
                        "px-3 py-1.5 rounded-full text-xs border transition-colors",
                        on
                          ? "bg-emerald-700 text-white border-emerald-700"
                          : count === 0
                            ? "border-stone-100 text-stone-300 cursor-not-allowed"
                            : "border-stone-300 text-stone-600 hover:border-emerald-500 hover:text-emerald-700 bg-white"
                      )}
                    >
                      {ch} <span className="opacity-60">({count})</span>
                    </button>
                  );
                })}
              </div>
              {pickedChapters.length > 0 ? (
                <div className="mt-3 pt-3 border-t border-stone-100 flex flex-wrap gap-1.5">
                  {pickedChapters.map((ch) => (
                    <Badge key={ch} variant="outline" className="border-emerald-300 text-emerald-800 text-xs">
                      {ch}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </SectionCard>
          ) : (
            <SectionCard
              title="Pick questions"
              subtitle={`${selected.length} selected — click to toggle`}
            >
              <div className="flex gap-2 mb-3">
                <Select value={fSubject} onValueChange={setFSubject}>
                  <SelectTrigger className="w-44" aria-label="Filter subject">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All subjects</SelectItem>
                    {SUBJECTS.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={fSearch}
                  onChange={(e) => setFSearch(e.target.value)}
                  placeholder="Search question text…"
                />
              </div>
              {manualPool.length === 0 ? (
                <EmptyNote>Bank is empty — add questions first.</EmptyNote>
              ) : (
                <ul className="max-h-80 overflow-y-auto space-y-1.5 pr-1">
                  {manualPool.map((q) => {
                    const on = selected.includes(q.id);
                    return (
                      <li key={q.id}>
                        <button
                          onClick={() =>
                            setSelected((prev) =>
                              on ? prev.filter((id) => id !== q.id) : [...prev, q.id]
                            )
                          }
                          className={cn(
                            "w-full text-left text-sm rounded-lg border px-3 py-2 transition-colors",
                            on
                              ? "border-emerald-600 bg-emerald-50"
                              : "border-stone-200 hover:bg-stone-50"
                          )}
                        >
                          <span className="text-[10px] uppercase text-stone-400 mr-2">
                            {q.subject.slice(0, 1)} · {q.type === "numerical" ? "NUM" : "MCQ"}
                          </span>
                          <span className="text-stone-700">{q.question.slice(0, 110)}{q.question.length > 110 ? "…" : ""}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </SectionCard>
          )}
        </div>

        {/* summary rail */}
        <div className="space-y-6">
          <SectionCard title="Ready to start?" subtitle="the clock starts the moment you enter">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-stone-500">Mode</span>
                <span className="font-medium">{pickMode === "chapters" ? "by chapter" : "by question"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-stone-500">Questions</span>
                <span className="font-medium tabular-nums">{totalPicked}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-stone-500">Max score</span>
                <span className="font-medium tabular-nums">{totalPicked * 4}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-stone-500">Duration</span>
                <span className="font-medium tabular-nums">{duration} min</span>
              </div>
              <div className="flex justify-between">
                <span className="text-stone-500">Scoring</span>
                <span className="font-medium">+4 / −1 / 0 (incl. numericals)</span>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <Button
                className="flex-1 bg-emerald-700 hover:bg-emerald-800"
                onClick={buildSession}
              >
                Start test
              </Button>
            </div>
            <button
              className="text-xs text-stone-400 underline mt-3"
              onClick={() => setPickMode(pickMode === "chapters" ? "manual" : "chapters")}
            >
              switch to {pickMode === "chapters" ? "picking individual questions" : "picking chapters"}
            </button>
          </SectionCard>

          <SectionCard title="Before you hit start">
            <ul className="text-xs text-stone-500 space-y-2 list-disc pl-4">
              <li>Full-mock template wants 20 MCQ + 5 numerical per subject — the player uses whatever the bank has.</li>
              <li>Chapter tests: keep it tight. 1 min/question is the default suggestion.</li>
              <li>The test auto-saves to this browser — refresh and resume is available.</li>
              <li>Tag every mistake right after submit. C/F/A/R/T/G is the whole point.</li>
            </ul>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
