"use client";

// ─── Question Bank: manual entry (incl. numerical tolerance) + filterable list ──
// Sprint C/D: delete confirm with saved-test usage warning (C1), edit-in-place
// and optional question figures (D2).
import { useMemo, useRef, useState } from "react";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { EmptyNote, PageTitle, SectionCard, SubjectDot, TierBadge } from "./shared";
import { useLive, put, del, bulkPut } from "@/lib/idb";
import { fileToDataUrl } from "@/lib/image";
import { SUBJECTS, uid, type Question, type Subject } from "@/lib/types";
import { FileDrop } from "./FileDrop";

const OPTION_LETTERS = ["A", "B", "C", "D"];

export function QuestionBankView() {
  const questions = useLive("questions");
  const syllabus = useLive("syllabus");
  const tests = useLive("tests");

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
  const [image, setImage] = useState<string | null>(null);

  // D2a edit-in-place
  const [editingId, setEditingId] = useState<string | null>(null);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const [figOver, setFigOver] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

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

  function resetForm() {
    setText("");
    setOptions(["", "", "", ""]);
    setAnswerIdx(0);
    setNumAnswer("");
    setTolerance("");
    setSource("");
    setImage(null);
    setEditingId(null);
  }

  function startEdit(q: Question) {
    setEditingId(q.id);
    setSubject(q.subject);
    setChapter(q.chapter);
    setType(q.type);
    setText(q.question);
    setOptions(q.type === "MCQ" && q.options.length === 4 ? [...q.options] : ["", "", "", ""]);
    setAnswerIdx(q.type === "MCQ" && typeof q.answer === "number" ? q.answer : 0);
    setNumAnswer(q.type === "numerical" ? String(q.answer) : "");
    setTolerance(q.type === "numerical" && q.tolerance ? String(q.tolerance) : "");
    setSource(q.source === "manual" ? "" : q.source);
    setImage(q.image ?? null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /** Shared validation + question build for add and edit. */
  function buildQuestion(): Omit<Question, "id" | "created_at"> | null {
    if (!text.trim()) {
      toast.error("Question text is empty");
      return null;
    }
    if (!chapter) {
      toast.error("Pick a chapter");
      return null;
    }
    if (type === "MCQ") {
      if (options.some((o) => !o.trim())) {
        toast.error("All 4 options are needed for an MCQ");
        return null;
      }
      return {
        question: text.trim(),
        options: options.map((o) => o.trim()),
        answer: answerIdx,
        tolerance: 0,
        type: "MCQ",
        subject,
        chapter,
        source: source.trim() || "manual",
        image: image ?? undefined,
      };
    }
    const ans = Number(numAnswer);
    if (numAnswer.trim() === "" || Number.isNaN(ans)) {
      toast.error("Numerical answer must be a number");
      return null;
    }
    return {
      question: text.trim(),
      options: [],
      answer: ans,
      tolerance: tolerance.trim() === "" ? 0 : Math.max(0, Number(tolerance) || 0),
      type: "numerical",
      subject,
      chapter,
      source: source.trim() || "manual",
      image: image ?? undefined,
    };
  }

  async function addQuestion() {
    const q = buildQuestion();
    if (!q) return;
    await put("questions", { ...q, id: uid(), created_at: Date.now() } as Question);
    toast.success(`Added to ${chapter}`);
    setText("");
    setOptions(["", "", "", ""]);
    setNumAnswer("");
    setTolerance("");
    setImage(null);
  }

  async function saveEdit() {
    const orig = editingId ? questions.find((q) => q.id === editingId) : undefined;
    if (!orig) {
      setEditingId(null);
      return;
    }
    const q = buildQuestion();
    if (!q) return;
    await put("questions", {
      ...orig, // same id + created_at preserved
      ...q,
      updated_at: Date.now(),
    } as Question);
    toast.success("Question updated");
    resetForm();
  }

  async function onImageFile(file: File) {
    try {
      setImage(await fileToDataUrl(file, 800));
      toast.success("Figure attached");
    } catch {
      toast.error("Could not read that image — try a JPG/PNG");
    }
  }

  // Bonus: paste an image from the clipboard anywhere inside the form
  function onFormPaste(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const it of items) {
      if (it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) {
          e.preventDefault();
          fileToDataUrl(f, 800)
            .then((dataUrl) => {
              setImage(dataUrl);
              toast.success("Figure attached from clipboard");
            })
            .catch(() => toast.error("Could not read the pasted image"));
        }
        return;
      }
    }
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
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setImportOpen((v) => !v)}>
              Import JSON
            </Button>
            <Badge variant="outline" className="border-border text-muted-foreground">
              {questions.length} questions
            </Badge>
          </div>
        }
      />

      {importOpen ? <JsonImportPanel onClose={() => setImportOpen(false)} /> : null}

      <div className="grid lg:grid-cols-5 gap-6">
        {/* entry / edit form */}
        <SectionCard
          title={editingId ? "Edit question" : "Add question"}
          subtitle={
            editingId
              ? "changes save to the same question — existing tests keep their own copy of the answer"
              : "numerical questions carry an optional tolerance (real JEE numericals often accept a range)"
          }
          className="lg:col-span-2"
        >
          <div className="space-y-3" onPaste={onFormPaste}>
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
                          ? "bg-emerald-700 dark:bg-emerald-500 text-white dark:text-emerald-950 border-emerald-700 dark:border-emerald-500"
                          : "bg-card text-muted-foreground border-border hover:border-emerald-500 dark:hover:border-emerald-400 dark:hover:border-emerald-500"
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

            {/* D2b: optional figure — drop an image file right onto the tile */}
            <div
              className={cn(
                "space-y-1.5 rounded-lg p-1 -m-1 transition-colors",
                figOver && "bg-primary/5 ring-2 ring-primary/20"
              )}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes("Files")) {
                  e.preventDefault();
                  setFigOver(true);
                }
              }}
              onDragLeave={() => setFigOver(false)}
              onDrop={(e) => {
                const f = e.dataTransfer.files?.[0];
                if (f && f.type.startsWith("image/")) {
                  e.preventDefault();
                  setFigOver(false);
                  void onImageFile(f);
                }
              }}
            >
              <Label className="text-xs">Figure (optional)</Label>
              {image ? (
                <div className="flex items-center gap-2">
                  <img
                    src={image}
                    alt="Question figure preview"
                    className="h-16 max-w-[160px] object-contain rounded border border-border bg-white"
                  />
                  <div className="flex flex-col gap-1">
                    <Button type="button" variant="outline" size="sm" onClick={() => imageInputRef.current?.click()}>
                      Replace
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-red-500 dark:text-red-400 hover:text-red-600 hover:bg-red-50 dark:bg-red-500/10 dark:hover:bg-red-500/10"
                      onClick={() => setImage(null)}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ) : (
                <Button type="button" variant="outline" size="sm" onClick={() => imageInputRef.current?.click()}>
                  📎 Attach figure
                </Button>
              )}
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = ""; // allow re-picking the same file
                  if (f) void onImageFile(f);
                }}
              />
              <p className="text-[11px] text-muted-foreground/70">
                Drop an image here, use the file picker, or Ctrl+V paste · downscaled to 800px
              </p>
            </div>

            {editingId ? (
              <div className="flex items-center gap-3">
                <Button onClick={() => void saveEdit()} className="flex-1 bg-emerald-700 hover:bg-emerald-800 dark:bg-emerald-500 dark:hover:bg-emerald-600 dark:text-emerald-950">
                  Save changes
                </Button>
                <button
                  type="button"
                  className="text-xs text-muted-foreground/70 underline hover:text-muted-foreground"
                  onClick={resetForm}
                >
                  Cancel edit
                </button>
              </div>
            ) : (
              <Button onClick={addQuestion} className="w-full bg-emerald-700 hover:bg-emerald-800 dark:bg-emerald-500 dark:hover:bg-emerald-600 dark:text-emerald-950">
                Add to bank
              </Button>
            )}
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
                const usedBy = tests.filter((t) => t.question_ids?.includes(q.id)).length;
                return (
                  <li
                    key={q.id}
                    className={cn(
                      "border rounded-lg p-3 hover:bg-accent/50 transition-colors",
                      editingId === q.id ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-500/10/40" : "border-border"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5 mb-1">
                          <SubjectDot subject={q.subject} />
                          <span className="text-xs text-muted-foreground">{q.chapter}</span>
                          {tier ? <TierBadge tier={tier} /> : null}
                          <Badge variant="outline" className="text-[10px] border-border text-muted-foreground">
                            {q.type === "MCQ" ? "MCQ" : "NUM"}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground/70">{q.source}</span>
                          {usedBy > 0 ? (
                            <Badge variant="outline" className="text-[10px] border-border text-muted-foreground/70">
                              in {usedBy} test{usedBy > 1 ? "s" : ""}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="text-sm text-foreground">{q.question}</p>
                        {q.type === "MCQ" ? (
                          <p className="text-xs text-muted-foreground mt-1">
                            Correct:{" "}
                            <span className="text-sage-700 dark:text-sage-400 font-medium">
                              {OPTION_LETTERS[q.answer as number]} · {q.options[q.answer as number]}
                            </span>
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground mt-1">
                            Answer:{" "}
                            <span className="text-sage-700 dark:text-sage-400 font-medium">
                              {q.answer as number}
                              {q.tolerance ? ` ± ${q.tolerance}` : " (exact)"}
                            </span>
                          </p>
                        )}
                        {q.image ? (
                          <img
                            src={q.image}
                            alt={`Figure for: ${q.question.slice(0, 60)}`}
                            className="mt-1.5 max-h-24 max-w-full object-contain rounded border border-border bg-white"
                          />
                        ) : null}
                      </div>
                      <div className="flex flex-col gap-1 shrink-0 items-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-muted-foreground hover:text-foreground hover:bg-accent"
                          onClick={() => startEdit(q)}
                        >
                          Edit
                        </Button>
                        {/* C1: delete needs a confirm; warn when used by saved tests */}
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-red-500 dark:text-red-400 hover:text-red-600 hover:bg-red-50 dark:bg-red-500/10 dark:hover:bg-red-500/10"
                            >
                              Delete
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete this question?</AlertDialogTitle>
                              <AlertDialogDescription>
                                {usedBy > 0 ? (
                                  <span className="font-medium text-amber-700 dark:text-amber-300">
                                    Used by {usedBy} saved test{usedBy > 1 ? "s" : ""} — deleting
                                    will affect their review.{" "}
                                  </span>
                                ) : null}
                                “{q.question.slice(0, 120)}
                                {q.question.length > 120 ? "…" : ""}” — this can&apos;t be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-red-600 text-white hover:bg-red-700"
                                onClick={() => {
                                  del("questions", q.id);
                                  if (editingId === q.id) resetForm();
                                  toast.success("Question deleted");
                                }}
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
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

// ─── JSON bulk import ────────────────────────────────────────────────────────
// Shape (also rendered inside the panel): an array of question objects, or
// {"questions": [...]} — subject/chapter/type/question/options/answer are the
// keys that matter; everything else is optional.

const IMPORT_EXAMPLE = `[
  {
    "subject": "Physics",
    "chapter": "Kinematics",
    "type": "MCQ",
    "question": "A car starts from rest and reaches 20 m/s in 5 s. Its acceleration is:",
    "options": ["2 m/s²", "4 m/s²", "5 m/s²", "10 m/s²"],
    "answer": 1,
    "source": "NCERT Ch-3"
  },
  {
    "subject": "Chemistry",
    "chapter": "Some Basic Concepts of Chemistry (Mole Concept)",
    "type": "numerical",
    "question": "The number of moles in 44 g of CO2 is:",
    "answer": 1,
    "tolerance": 0.01
  }
]`;

function normalizeSubject(v: unknown): Subject | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (s.startsWith("phy")) return "Physics";
  if (s.startsWith("che")) return "Chemistry";
  if (s.startsWith("mat")) return "Mathematics"; // math / maths / mathematics
  return null;
}

function normalizeType(v: unknown): "MCQ" | "numerical" | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "mcq" || s === "objective") return "MCQ";
  if (["numerical", "num", "numeric", "integer"].includes(s)) return "numerical";
  return null;
}

function parseQuestionsJson(raw: string): { ok: Question[]; errors: { row: number; msg: string }[] } {
  const out: { ok: Question[]; errors: { row: number; msg: string }[] } = { ok: [], errors: [] };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    out.errors.push({ row: 0, msg: `Invalid JSON — ${(e as Error).message}` });
    return out;
  }
  if (data && !Array.isArray(data) && typeof data === "object") {
    const qArr = (data as Record<string, unknown>)["questions"];
    if (Array.isArray(qArr)) data = qArr;
  }
  if (!Array.isArray(data)) {
    out.errors.push({ row: 0, msg: 'Top level must be an array of question objects (or {"questions": [...]})' });
    return out;
  }
  const now = Date.now();
  data.forEach((item, i) => {
    const row = i + 1;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      out.errors.push({ row, msg: "not a question object" });
      return;
    }
    const q = item as Record<string, unknown>;
    const subject = normalizeSubject(q.subject);
    if (!subject) {
      out.errors.push({ row, msg: `subject "${String(q.subject)}" must be Physics / Chemistry / Mathematics` });
      return;
    }
    const chapter = String(q.chapter ?? "").trim();
    if (!chapter) {
      out.errors.push({ row, msg: "chapter is required" });
      return;
    }
    const text = String(q.question ?? q.text ?? "").trim();
    if (!text) {
      out.errors.push({ row, msg: "question text is required" });
      return;
    }
    const type = normalizeType(q.type);
    if (!type) {
      out.errors.push({ row, msg: `type "${String(q.type)}" must be MCQ or numerical` });
      return;
    }
    let options: string[] = [];
    let answer: number | string;
    let tolerance = 0;
    if (type === "MCQ") {
      if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 6) {
        out.errors.push({ row, msg: "MCQ needs an options array of 2-6 strings" });
        return;
      }
      options = q.options.map((o) => String(o));
      const ans: unknown = q.answer;
      if (typeof ans === "number" && Number.isInteger(ans) && ans >= 0 && ans < options.length) {
        answer = ans; // 0-based index (A=0, B=1, C=2, D=3)
      } else if (typeof ans === "string" && /^[A-Fa-f]$/.test(ans.trim())) {
        const idx = ans.trim().toUpperCase().charCodeAt(0) - 65;
        if (idx >= options.length) {
          out.errors.push({ row, msg: `answer "${ans}" out of range for ${options.length} options` });
          return;
        }
        answer = idx;
      } else if (typeof ans === "string" && ans.trim()) {
        const idx = options.findIndex((o) => o.trim().toLowerCase() === ans.trim().toLowerCase());
        if (idx === -1) {
          out.errors.push({ row, msg: 'answer must be a 0-based index, a letter (A-D), or exact option text' });
          return;
        }
        answer = idx;
      } else {
        out.errors.push({ row, msg: "answer must be the 0-based option index (A=0, B=1, ...)" });
        return;
      }
    } else {
      const num = typeof q.answer === "number" ? q.answer : parseFloat(String(q.answer ?? ""));
      if (!Number.isFinite(num)) {
        out.errors.push({ row, msg: "numerical answer must be a number" });
        return;
      }
      answer = num;
      if (q.tolerance !== undefined && q.tolerance !== "") {
        const t = typeof q.tolerance === "number" ? q.tolerance : parseFloat(String(q.tolerance));
        if (!Number.isFinite(t) || t < 0) {
          out.errors.push({ row, msg: "tolerance must be a non-negative number" });
          return;
        }
        tolerance = t;
      }
    }
    const image = typeof q.image === "string" && q.image.startsWith("data:image") ? q.image : undefined;
    out.ok.push({
      id: uid(),
      question: text,
      options,
      answer,
      tolerance,
      type,
      subject,
      chapter,
      source: typeof q.source === "string" && q.source.trim() ? q.source.trim() : "JSON import",
      source_url: typeof q.source_url === "string" && q.source_url.trim() ? q.source_url.trim() : undefined,
      image,
      created_at: now,
    });
  });
  return out;
}

function JsonImportPanel({ onClose }: { onClose: () => void }) {
  const [raw, setRaw] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const parsed = useMemo(() => (raw.trim() ? parseQuestionsJson(raw) : null), [raw]);

  async function importAll() {
    if (!parsed || parsed.ok.length === 0) return;
    await bulkPut("questions", parsed.ok);
    toast.success(`Imported ${parsed.ok.length} question${parsed.ok.length === 1 ? "" : "s"}`);
    onClose();
  }

  return (
    <SectionCard
      title="Import questions from JSON"
      subtitle="bulk-add questions with answers — drop a .json file or paste the contents"
      action={
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="grid lg:grid-cols-2 gap-5">
        <div className="space-y-3">
          <FileDrop
            accept=".json,application/json,text/plain"
            label={fileName ? `Loaded: ${fileName}` : "Drop your .json file here — or click to browse"}
            hint="UTF-8 JSON, up to a few thousand questions"
            onFiles={async (files) => {
              const f = files[0];
              try {
                const text = await f.text();
                setRaw(text);
                setFileName(f.name);
              } catch {
                toast.error("Could not read that file");
              }
            }}
          />
          <Textarea
            value={raw}
            onChange={(e) => {
              setRaw(e.target.value);
              setFileName(null);
            }}
            rows={8}
            placeholder='…or paste JSON here — e.g. [{"subject":"Physics","chapter":"Kinematics","type":"MCQ","question":"…","options":["…"],"answer":1}]'
            className="font-mono text-xs"
            aria-label="Paste JSON"
          />
          {parsed ? (
            <div className="text-sm space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className="bg-sage-600 dark:bg-sage-500 hover:bg-sage-600 dark:hover:bg-sage-500 text-white dark:text-sage-950 border-0">
                  {parsed.ok.length} valid
                </Badge>
                {parsed.errors.length > 0 ? (
                  <Badge variant="outline" className="border-red-300 text-red-700 dark:border-red-500/40 dark:text-red-300">
                    {parsed.errors.length} skipped
                  </Badge>
                ) : null}
                {parsed.ok.length > 0 ? (
                  <Button size="sm" onClick={() => void importAll()}>
                    Import {parsed.ok.length} question{parsed.ok.length === 1 ? "" : "s"}
                  </Button>
                ) : null}
              </div>
              {parsed.errors.length > 0 ? (
                <ul className="text-xs text-red-600 dark:text-red-400 space-y-0.5 max-h-28 overflow-y-auto">
                  {parsed.errors.slice(0, 8).map((e, i) => (
                    <li key={i}>
                      {e.row === 0 ? "—" : `row ${e.row}`} · {e.msg}
                    </li>
                  ))}
                  {parsed.errors.length > 8 ? <li>…and {parsed.errors.length - 8} more</li> : null}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-foreground">Expected JSON shape</span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                navigator.clipboard
                  .writeText(IMPORT_EXAMPLE)
                  .then(() => toast.success("Example copied"))
                  .catch(() => toast.error("Copy failed — select the text manually"));
              }}
            >
              Copy example
            </Button>
          </div>
          <pre className="text-[11px] leading-4 font-mono bg-muted/60 border border-border rounded-lg p-3 overflow-x-auto">
{IMPORT_EXAMPLE}
          </pre>
          <ul className="text-[11px] text-muted-foreground space-y-1">
            <li>
              <code className="font-mono text-foreground">subject</code> — &quot;Physics&quot; / &quot;Chemistry&quot; /
              &quot;Mathematics&quot; (math/maths also accepted) · <span className="text-foreground">required</span>
            </li>
            <li>
              <code className="font-mono text-foreground">chapter</code> — any text; syllabus names auto-link where they
              match · <span className="text-foreground">required</span>
            </li>
            <li>
              <code className="font-mono text-foreground">type</code> — &quot;MCQ&quot; or &quot;numerical&quot; ·{" "}
              <span className="text-foreground">required</span>
            </li>
            <li>
              <code className="font-mono text-foreground">question</code> — the question text ·{" "}
              <span className="text-foreground">required</span>
            </li>
            <li>
              <code className="font-mono text-foreground">options</code> — array of 2-6 strings (MCQ only; 4 is standard)
            </li>
            <li>
              <code className="font-mono text-foreground">answer</code> — MCQ: <span className="font-medium">0-based option index (A=0, B=1, C=2, D=3)</span>,
              or a letter &quot;A&quot;-&quot;D&quot;, or exact option text · numerical: the number
            </li>
            <li>
              <code className="font-mono text-foreground">tolerance</code> — numerical only, optional (default 0 = exact
              match)
            </li>
            <li>
              <code className="font-mono text-foreground">source</code>,{" "}
              <code className="font-mono text-foreground">source_url</code>,{" "}
              <code className="font-mono text-foreground">image</code> (dataURL) — optional
            </li>
          </ul>
        </div>
      </div>
    </SectionCard>
  );
}
