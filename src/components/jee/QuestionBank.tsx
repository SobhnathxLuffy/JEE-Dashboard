"use client";

// ─── Question Bank: manual entry (incl. numerical tolerance) + filterable list ──
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { EmptyNote, PageTitle, SectionCard, SubjectDot, TierBadge } from "./shared";
import { useLive, put, del } from "@/lib/idb";
import { SUBJECTS, uid, type Question, type Subject } from "@/lib/types";

const OPTION_LETTERS = ["A", "B", "C", "D"];

export function QuestionBankView() {
  const questions = useLive("questions");
  const syllabus = useLive("syllabus");

  const [filterSubject, setFilterSubject] = useState<string>("all");
  const [filterChapter, setFilterChapter] = useState<string>("all");
  const [filterTier, setFilterTier] = useState<string>("all");
  const [search, setSearch] = useState("");

  const [subject, setSubject] = useState<Subject>("Physics");
  const [chapter, setChapter] = useState("");
  const [type, setType] = useState<"MCQ" | "numerical">("MCQ");
  const [text, setText] = useState("");
  const [options, setOptions] = useState<string[]>(["", "", "", ""]);
  const [answerIdx, setAnswerIdx] = useState<number>(0);
  const [numAnswer, setNumAnswer] = useState("");
  const [tolerance, setTolerance] = useState("");
  const [source, setSource] = useState("");

  const chaptersForSubject = useMemo(
    () =>
      syllabus
        .filter((s) => s.subject === subject)
        .map((s) => s.chapter)
        .sort(),
    [syllabus, subject]
  );

  const tierOf = useMemo(() => {
    const m = new Map<string, 1 | 2 | 3>();
    syllabus.forEach((s) => m.set(`${s.subject}:${s.chapter}`, s.tier));
    return m;
  }, [syllabus]);

  const filtered = useMemo(() => {
    return questions
      .filter((q) => (filterSubject === "all" ? true : q.subject === filterSubject))
      .filter((q) =>
        filterSubject !== "all" && filterChapter !== "all" ? q.chapter === filterChapter : true
      )
      .filter((q) => {
        if (filterTier === "all") return true;
        const t = tierOf.get(`${q.subject}:${q.chapter}`);
        return t !== undefined && String(t) === filterTier;
      })
      .filter((q) =>
        search.trim() === ""
          ? true
          : q.question.toLowerCase().includes(search.trim().toLowerCase())
      )
      .sort((a, b) => b.created_at - a.created_at);
  }, [questions, filterSubject, filterChapter, filterTier, search, tierOf]);

  async function addQuestion() {
    if (!text.trim()) {
      toast.error("Question text is empty");
      return;
    }
    if (!chapter) {
      toast.error("Pick a chapter");
      return;
    }
    let q: Question;
    if (type === "MCQ") {
      if (options.some((o) => !o.trim())) {
        toast.error("All 4 options are needed for an MCQ");
        return;
      }
      q = {
        id: uid(),
        question: text.trim(),
        options: options.map((o) => o.trim()),
        answer: answerIdx,
        tolerance: 0,
        type: "MCQ",
        subject,
        chapter,
        source: source.trim() || "manual",
        created_at: Date.now(),
      };
    } else {
      const ans = Number(numAnswer);
      if (Number.isNaN(ans)) {
        toast.error("Numerical answer must be a number");
        return;
      }
      q = {
        id: uid(),
        question: text.trim(),
        options: [],
        answer: ans,
        tolerance: tolerance.trim() === "" ? 0 : Math.max(0, Number(tolerance) || 0),
        type: "numerical",
        subject,
        chapter,
        source: source.trim() || "manual",
        created_at: Date.now(),
      };
    }
    await put("questions", q);
    toast.success(`Added to ${chapter}`);
    setText("");
    setOptions(["", "", "", ""]);
    setNumAnswer("");
    setTolerance("");
  }

  const chapterFilterOptions =
    filterSubject === "all"
      ? []
      : syllabus.filter((s) => s.subject === filterSubject).map((s) => s.chapter);

  return (
    <div className="space-y-6">
      <PageTitle
        title="Question Bank"
        subtitle="Manual entry lives here. Bank questions feed the CBT player; chapter names come from the syllabus seed."
        right={
          <Badge variant="outline" className="border-stone-300 text-stone-600">
            {questions.length} questions
          </Badge>
        }
      />

      <div className="grid lg:grid-cols-5 gap-6">
        {/* entry form */}
        <SectionCard
          title="Add question"
          subtitle="numerical questions carry an optional tolerance (real JEE numericals often accept a range)"
          className="lg:col-span-2"
        >
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Subject</Label>
                <Select
                  value={subject}
                  onValueChange={(v) => {
                    setSubject(v as Subject);
                    setChapter("");
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
                <Select value={chapter} onValueChange={setChapter}>
                  <SelectTrigger aria-label="Chapter">
                    <SelectValue placeholder="pick chapter" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {chaptersForSubject.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Type</Label>
                <Select
                  value={type}
                  onValueChange={(v) => setType(v as "MCQ" | "numerical")}
                >
                  <SelectTrigger aria-label="Type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MCQ">MCQ (+4 / −1)</SelectItem>
                    <SelectItem value="numerical">Numerical (+4 / −1)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Source</Label>
                <Input
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="PYQ 2023 / coaching sheet…"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Question text</Label>
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
                placeholder="Plain text is fine. Use x^2, CO₂ etc. — no LaTeX needed for MVP."
              />
            </div>

            {type === "MCQ" ? (
              <div className="space-y-2">
                <Label className="text-xs">Options — click the circle next to the correct one</Label>
                {options.map((o, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label={`Mark option ${OPTION_LETTERS[i]} correct`}
                      onClick={() => setAnswerIdx(i)}
                      className={`w-7 h-7 rounded-full grid place-items-center text-xs font-bold border transition-colors ${
                        answerIdx === i
                          ? "bg-emerald-700 text-white border-emerald-700"
                          : "bg-white text-stone-500 border-stone-300 hover:border-emerald-500"
                      }`}
                    >
                      {OPTION_LETTERS[i]}
                    </button>
                    <Input
                      value={o}
                      onChange={(e) => {
                        const next = [...options];
                        next[i] = e.target.value;
                        setOptions(next);
                      }}
                      placeholder={`Option ${OPTION_LETTERS[i]}`}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Correct answer (number)</Label>
                  <Input
                    value={numAnswer}
                    onChange={(e) => setNumAnswer(e.target.value)}
                    inputMode="decimal"
                    placeholder="e.g. 2.5"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Tolerance ± (0 = exact)</Label>
                  <Input
                    value={tolerance}
                    onChange={(e) => setTolerance(e.target.value)}
                    inputMode="decimal"
                    placeholder="0"
                  />
                </div>
              </div>
            )}

            <Button onClick={addQuestion} className="w-full bg-emerald-700 hover:bg-emerald-800">
              Add to bank
            </Button>
          </div>
        </SectionCard>

        {/* list */}
        <SectionCard
          title="Bank"
          subtitle={`${filtered.length} shown`}
          className="lg:col-span-3"
        >
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-4">
            <Select
              value={filterSubject}
              onValueChange={(v) => {
                setFilterSubject(v);
                setFilterChapter("all");
              }}
            >
              <SelectTrigger aria-label="Filter subject"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All subjects</SelectItem>
                {SUBJECTS.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterChapter} onValueChange={setFilterChapter}>
              <SelectTrigger aria-label="Filter chapter"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="all">All chapters</SelectItem>
                {chapterFilterOptions.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterTier} onValueChange={setFilterTier}>
              <SelectTrigger aria-label="Filter tier"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All tiers</SelectItem>
                <SelectItem value="1">Tier 1</SelectItem>
                <SelectItem value="2">Tier 2</SelectItem>
                <SelectItem value="3">Tier 3</SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search text…"
            />
          </div>

          {filtered.length === 0 ? (
            <EmptyNote>
              No questions match. Add some on the left, or load the demo set from the Data tab.
            </EmptyNote>
          ) : (
            <ul className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
              {filtered.map((q) => {
                const tier = tierOf.get(`${q.subject}:${q.chapter}`);
                return (
                  <li
                    key={q.id}
                    className="border border-stone-200 rounded-lg p-3 hover:bg-stone-50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5 mb-1">
                          <SubjectDot subject={q.subject} />
                          <span className="text-xs text-stone-500">{q.chapter}</span>
                          {tier ? <TierBadge tier={tier} /> : null}
                          <Badge variant="outline" className="text-[10px] border-stone-300 text-stone-500">
                            {q.type === "MCQ" ? "MCQ" : "NUM"}
                          </Badge>
                          <span className="text-[10px] text-stone-400">{q.source}</span>
                        </div>
                        <p className="text-sm text-stone-800">{q.question}</p>
                        {q.type === "MCQ" ? (
                          <p className="text-xs text-stone-500 mt-1">
                            Correct:{" "}
                            <span className="text-emerald-700 font-medium">
                              {OPTION_LETTERS[q.answer as number]} · {q.options[q.answer as number]}
                            </span>
                          </p>
                        ) : (
                          <p className="text-xs text-stone-500 mt-1">
                            Answer:{" "}
                            <span className="text-emerald-700 font-medium">
                              {q.answer as number}
                              {q.tolerance ? ` ± ${q.tolerance}` : " (exact)"}
                            </span>
                          </p>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-500 hover:text-red-600 hover:bg-red-50 shrink-0"
                        onClick={() => {
                          del("questions", q.id);
                          toast.success("Question deleted");
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
