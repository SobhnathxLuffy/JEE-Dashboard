"use client";

// ─── Post-test analysis: score, accuracy, per-question review, error tags ───
// Sprint D review side: paper-numbered questions + subject chips + next-untagged
// jump (D3), retry-wrong as a new CBT session (D1), key-later self-mark with
// live score recompute (D4), per-question notes (D7) and solution photos (D8).
import { useMemo, useRef, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { NavController } from "./App";
import { AnswerBits, EmptyNote, PageTitle, SectionCard, StatCard } from "./shared";
import { CountUp, ScoreRing, Stagger, StaggerItem } from "./motion";
import { ExplainDialog, explainTargetOf, type ExplainTarget } from "./ai/ExplainDialog";
import { useLive, put, get, getAll } from "@/lib/idb";
import { marksFor } from "@/lib/scoring";
import { fileToDataUrl } from "@/lib/image";
import {
  applyLateKey,
  extractKeyTextFromPdf,
  paperRangeOf,
  parseAnswerKey,
  parseCell,
} from "@/lib/pdf-key";
import {
  ERROR_TAGS,
  SUBJECTS,
  SUBJECT_SHORT,
  fmtSecs,
  uid,
  type ActiveSession,
  type ErrorTag,
  type PdfKeyEntry,
  type ResponseRecord,
  type Subject,
} from "@/lib/types";

const TAG_CLS: Record<ErrorTag, string> = {
  C: "bg-red-100 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/30",
  F: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30",
  A: "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-500/10 dark:text-orange-300 dark:border-orange-500/30",
  R: "bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:border-sky-500/30",
  T: "bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:border-violet-500/30",
  G: "bg-stone-200 text-stone-700 border-stone-300 dark:bg-stone-500/15 dark:text-stone-300 dark:border-stone-500/30",
};

const LK_MAX_CELLS = 300; // grid render cap inside the late-key dialog

type StatusFilter = "all" | "wrong" | "untagged";
type SubjectFilter = "all" | Subject;

export function ResultsView({ testId, nav }: { testId: string; nav: NavController }) {
  const tests = useLive("tests");
  const responses = useLive("responses");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [subjectFilter, setSubjectFilter] = useState<SubjectFilter>("all");

  // D3 "next untagged" jump state
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const jumpIdxRef = useRef(0);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // D7: first-save toast bookkeeping (per response, this visit)
  const notedOnceRef = useRef<Set<string>>(new Set());

  const test = useMemo(() => tests.find((t) => t.id === testId), [tests, testId]);

  // ── late answer-key upload: paste / key-PDF / grid → full re-score ──
  const [lkOpen, setLkOpen] = useState(false);
  const [lkText, setLkText] = useState("");
  const [lkGrid, setLkGrid] = useState<Record<number, string>>({});
  const [lkOptionNums, setLkOptionNums] = useState(false);
  const [lkTol, setLkTol] = useState("0");
  const [lkBusy, setLkBusy] = useState(false);
  const [lkFileName, setLkFileName] = useState<string | null>(null);
  const lkKeyFileRef = useRef<HTMLInputElement>(null);
  const lkEditedRef = useRef<Set<number>>(new Set());

  const lkParsed = useMemo(() => parseAnswerKey(lkText), [lkText]);
  const lkRange = test?.pdf_meta ? paperRangeOf(test.pdf_meta) : null;
  const lkNos = useMemo(() => {
    if (!lkRange) return [];
    const out: number[] = [];
    for (let n = lkRange.first; n <= lkRange.last; n++) out.push(n);
    return out;
  }, [lkRange]);
  const lkRenderCells = lkNos.slice(0, LK_MAX_CELLS);

  // paste/key-PDF parse → bulk-fill the grid (hand-typed cells always win)
  useEffect(() => {
    if (lkParsed.length === 0) return;
    setLkGrid((g) => {
      const next = { ...g };
      for (const k of lkParsed) {
        if (lkEditedRef.current.has(k.no)) continue;
        next[k.no] = k.bonus ? "bonus" : k.answers ? k.answers.join("/") : k.answer;
      }
      return next;
    });
  }, [lkParsed]);

  const lkGridKey = useMemo(() => {
    const out: PdfKeyEntry[] = [];
    for (const no of lkNos) {
      const raw = lkGrid[no];
      if (raw === undefined) continue;
      const r = parseCell(raw, lkOptionNums);
      if (r.kind === "entry") out.push({ ...r.entry, no });
    }
    return out;
  }, [lkNos, lkGrid, lkOptionNums]);

  const lkMissing = useMemo(() => {
    const have = new Set(lkGridKey.map((k) => k.no));
    return lkNos.filter((no) => !have.has(no));
  }, [lkGridKey, lkNos]);

  function setLkCell(no: number, raw: string) {
    lkEditedRef.current.add(no);
    setLkGrid((g) => {
      const next = { ...g };
      if (raw.trim() === "") delete next[no];
      else next[no] = raw;
      return next;
    });
  }

  function openLateKey() {
    if (!test?.pdf_meta) return;
    // prefill: existing key (replace flow) + stored tolerance
    const g: Record<number, string> = {};
    for (const k of test.pdf_meta.key) {
      g[k.no] = k.bonus ? "bonus" : k.answers ? k.answers.join("/") : k.answer;
    }
    lkEditedRef.current = new Set();
    setLkGrid(g);
    setLkText("");
    setLkFileName(null);
    setLkOptionNums(false);
    setLkTol(String(test.pdf_meta.tolerance ?? 0));
    setLkOpen(true);
  }

  async function onLkKeyFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await extractKeyTextFromPdf(file);
      const parsed = parseAnswerKey(text);
      if (parsed.length < 2) {
        toast.error("No readable text — this key looks scanned. Paste it instead.");
        return;
      }
      setLkFileName(file.name);
      setLkText(text);
      toast.success(`${parsed.length} keys extracted from key PDF`);
    } catch (err) {
      toast.error(`Could not read key PDF: ${String(err)}`);
    }
  }

  async function applyLkKey() {
    if (!test) return;
    if (lkGridKey.length === 0) {
      toast.error("The key grid is empty — paste the key, upload a key PDF, or fill cells");
      return;
    }
    if (lkMissing.length > 0) {
      const ok = window.confirm(
        `${lkMissing.length} of ${lkNos.length} questions have no key (${lkMissing
          .slice(0, 8)
          .join(", ")}${lkMissing.length > 8 ? "…" : ""}). They score 0 — attempted or not. Apply anyway?`
      );
      if (!ok) return;
    }
    setLkBusy(true);
    try {
      const res = await applyLateKey(test.id, lkGridKey, Number(lkTol) || 0);
      setLkOpen(false);
      toast.success(
        `Key applied — ${res.scoredRows} answer${res.scoredRows === 1 ? "" : "s"} re-checked, score ${res.score}/${res.max}`
      );
    } catch (err) {
      toast.error(`Could not apply the key: ${String(err)}`);
    } finally {
      setLkBusy(false);
    }
  }

  // D8: shared photo file input + full-size viewer dialog
  const photoInputRef = useRef<HTMLInputElement>(null);
  const photoTargetRef = useRef<string | null>(null);
  const [photoDragId, setPhotoDragId] = useState<string | null>(null);
  const [viewPhoto, setViewPhoto] = useState<{ url: string; title: string; id: string } | null>(
    null
  );

  // AI: per-question doubt buster
  const [explainTarget, setExplainTarget] = useState<ExplainTarget | null>(null);

  const rows = useMemo(() => {
    const own = responses.filter((r) => r.test_id === testId);
    // review reads in paper/test order — q_no is the stored number, position is the fallback
    return [...own].sort((a, b) => (a.q_no ?? 0) - (b.q_no ?? 0));
  }, [responses, testId]);

  // D4: key-later tests stay in self-mark mode for their whole life (score is
  // recomputed to a number on the first toggle, so the flag is the discriminator)
  const selfMark = test?.pdf_meta?.key_later === true;

  // D3: displayed number = the paper/test number stored at submit (q_no),
  // falling back to the row's stable position — never re-indexed by filters.
  const qNoOf = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r, i) => m.set(r.id, r.q_no ?? i + 1));
    return m;
  }, [rows]);

  const stats = useMemo(() => {
    const attempted = rows.filter((r) => r.attempted);
    const correct = rows.filter((r) => r.correct === true);
    const wrong = rows.filter((r) => r.attempted && r.correct === false);
    const untagged = wrong.filter((r) => !r.error_tag).length;
    const time = rows.reduce((a, r) => a + (r.time_spent || 0), 0);
    return {
      attempted: attempted.length,
      correct: correct.length,
      wrong: wrong.length,
      untagged,
      time,
      accuracy: attempted.length ? Math.round((correct.length / attempted.length) * 100) : 0,
      attemptRate: rows.length ? Math.round((attempted.length / rows.length) * 100) : 0,
      pending: attempted.filter((r) => r.correct === null).length,
    };
  }, [rows]);

  const shown = useMemo(() => {
    let out = rows;
    if (subjectFilter !== "all") out = out.filter((r) => r.subject === subjectFilter);
    if (filter === "wrong") out = out.filter((r) => r.attempted && r.correct === false);
    if (filter === "untagged")
      out = out.filter((r) => r.attempted && r.correct === false && !r.error_tag);
    return out;
  }, [rows, filter, subjectFilter]);

  // D1: retry candidates — wrong + unattempted-but-keyed (key-later: attempted only)
  const retryIds = useMemo(() => {
    if (!test?.question_ids) return [];
    const keyLater = test.pdf_meta?.key_later === true;
    const candidates = rows.filter((r) => {
      if (keyLater) return r.attempted;
      if (r.attempted) return r.correct === false;
      return r.correct_answer !== "?"; // skipped but keyed → retry it too
    });
    const want = new Set(candidates.map((r) => r.question_id));
    return test.question_ids.filter((id) => want.has(id)); // test order preserved
  }, [test, rows]);

  function startRetry() {
    if (!test || retryIds.length === 0) return;
    const retryRows = rows.filter((r) => retryIds.includes(r.question_id));
    const session: ActiveSession = {
      key: "active",
      test_id: uid(),
      mode: "cbt",
      test_type: "mixed",
      name: `Retry — ${test.name}`,
      subject_order: SUBJECTS.filter((s) => retryRows.some((r) => r.subject === s)),
      question_ids: retryIds,
      duration_min: Math.max(1, retryIds.length), // 1 min per question rule
      started_at: Date.now(),
      answers: {},
      marked: [],
      current: 0,
      q_times: {},
      q_entered_at: Date.now(),
    };
    nav.startSession(session);
  }

  // D3: cycle through wrong+untagged rows, scroll + highlight each in turn
  const untaggedIds = useMemo(
    () =>
      rows
        .filter((r) => r.attempted && r.correct === false && !r.error_tag)
        .map((r) => r.id),
    [rows]
  );

  function jumpToNextUntagged() {
    if (untaggedIds.length === 0) return;
    const idx = jumpIdxRef.current % untaggedIds.length;
    jumpIdxRef.current += 1;
    const id = untaggedIds[idx];
    const el = document.getElementById(`resp-${id}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightId(id);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setHighlightId(null), 2500);
  }

  /** Fresh read + merge — the row prop may be stale when several edits race. */
  async function patchResponse(id: string, patch: Partial<ResponseRecord>) {
    const fresh = await get("responses", id);
    if (!fresh) return null;
    const next = { ...fresh, ...patch };
    await put("responses", next);
    return next;
  }

  async function tagResponse(r: ResponseRecord, tag: ErrorTag) {
    const updated = await patchResponse(r.id, { error_tag: tag });
    if (!updated) return;
    if (tag === "F") {
      const existing = await get("formula", `${updated.test_id}:${updated.question_id}`);
      if (!existing) {
        await put("formula", {
          id: `${updated.test_id}:${updated.question_id}`,
          test_id: updated.test_id,
          question_id: updated.question_id,
          subject: updated.subject,
          chapter: updated.chapter,
          snippet: updated.question_snippet,
          created_at: Date.now(),
        });
        toast.success("Added to formula sheet (F-tag)");
      }
    } else {
      // if retagged away from F, remove from formula sheet
      const existing = await get("formula", `${updated.test_id}:${updated.question_id}`);
      if (existing) {
        const { del } = await import("@/lib/idb");
        await del("formula", existing.id);
      }
    }
  }

  // D7: one-line note, saved on blur (Enter blurs). Toast on the first save of each note only.
  async function saveNote(r: ResponseRecord, value: string) {
    const v = value.trim();
    if ((r.note ?? "") === v) return; // nothing changed
    await patchResponse(r.id, { note: v === "" ? undefined : v });
    if (!notedOnceRef.current.has(r.id)) {
      notedOnceRef.current.add(r.id);
      toast.success("Note saved");
    }
  }

  // D8: photo attach/replace via the shared hidden file input
  function pickPhoto(responseId: string) {
    photoTargetRef.current = responseId;
    photoInputRef.current?.click();
  }

  async function attachPhoto(file: File, responseId: string) {
    try {
      const dataUrl = await fileToDataUrl(file, 1000);
      const updated = await patchResponse(responseId, { photo: dataUrl });
      if (updated) toast.success("Solution photo attached");
    } catch {
      toast.error("Could not read that image — try a JPG/PNG");
    }
  }

  async function onPhotoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file later
    const targetId = photoTargetRef.current;
    photoTargetRef.current = null;
    if (!file || !targetId) return;
    await attachPhoto(file, targetId);
  }

  async function removePhoto(id: string) {
    await patchResponse(id, { photo: undefined });
    setViewPhoto(null);
    toast.success("Solution photo removed");
  }

  // D4: set the mark, then recompute the whole TestRecord from ALL responses
  async function applyMark(r: ResponseRecord, correct: boolean | null) {
    if (!test) return;
    const updated = await patchResponse(r.id, { correct });
    if (!updated) return;
    const all = (await getAll("responses")).filter((x) => x.test_id === testId);
    const subjectScores: Record<Subject, number> = {
      Physics: 0,
      Chemistry: 0,
      Mathematics: 0,
    };
    for (const x of all) subjectScores[x.subject] += marksFor(x.attempted, x.correct);
    const score = SUBJECTS.reduce((a, s) => a + subjectScores[s], 0);
    const attemptedRows = all.filter((x) => x.attempted);
    const allMarked =
      attemptedRows.length > 0 && attemptedRows.every((x) => x.correct !== null);
    const wasAllMarked = rows
      .filter((x) => x.attempted)
      .every((x) => x.correct !== null);
    await put("tests", { ...test, score, subject_scores: subjectScores });
    if (!wasAllMarked && allMarked) {
      toast.success(`Score finalised: ${score}/${test.max_score}`);
    }
  }

  if (!test) {
    return (
      <div className="space-y-4">
        <PageTitle title="Test analysis" />
        <EmptyNote>
          Test not found.{" "}
          <button className="underline" onClick={() => nav.go("dashboard")}>
            Back to dashboard
          </button>
        </EmptyNote>
      </div>
    );
  }

  const markedCount = stats.attempted - stats.pending;

  return (
    <div className="space-y-6">
      <PageTitle
        title={test.name}
        subtitle={`${test.date} · ${test.source} · ${test.duration_min} min · ${test.type} test`}
        right={
          <Button variant="outline" size="sm" onClick={() => nav.go("dashboard")}>
            ← Dashboard
          </Button>
        }
      />

      {/* score hero — ring draws in, number settles, subject split at a glance */}
      <div className="rounded-xl border border-border bg-card card-shadow px-5 py-4 flex items-center gap-6 flex-wrap">
        {test.score === null ? (
          <div className="flex items-center gap-3 text-sm text-amber-700 dark:text-amber-300 py-2">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" aria-hidden="true" />
            Score pending — add the answer key or finish self-marking below.
          </div>
        ) : (
          <>
            <ScoreRing percent={(test.score / Math.max(1, test.max_score)) * 100} size={92}>
              <div className="text-center leading-none">
                <div className="font-mono tabular-nums text-xl font-bold text-foreground">
                  <CountUp value={test.score} />
                </div>
                <div className="text-[10px] font-mono text-muted-foreground mt-0.5">/{test.max_score}</div>
              </div>
            </ScoreRing>
            <div className="flex flex-wrap items-center gap-x-7 gap-y-3 min-w-0">
              <div>
                <div className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground font-medium">Accuracy</div>
                <div className="font-mono tabular-nums text-lg font-semibold text-foreground">
                  <CountUp value={stats.accuracy} format={(v) => `${Math.round(v)}%`} />
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground font-medium">Attempted</div>
                <div className="font-mono tabular-nums text-lg font-semibold text-foreground">
                  {stats.attempted}
                  <span className="text-muted-foreground/60 text-sm">/{rows.length}</span>
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground font-medium">Time</div>
                <div className="font-mono tabular-nums text-lg font-semibold text-foreground">{fmtSecs(stats.time)}</div>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                {SUBJECTS.map((s) => (
                  <div key={s} className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "inline-block w-2 h-2 rounded-full",
                        s === "Physics" ? "bg-amber-500" : s === "Chemistry" ? "bg-sage-600 dark:bg-sage-400" : "bg-stone-800 dark:bg-stone-300"
                      )}
                      aria-hidden="true"
                    />
                    <span className="text-[11px] text-muted-foreground">{SUBJECT_SHORT[s]}</span>
                    <span className="font-mono tabular-nums text-sm font-semibold text-foreground">
                      {test.subject_scores[s] ?? 0}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <Stagger className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StaggerItem>
          <StatCard
            label="Score"
            value={test.score === null ? "pending" : `${test.score}/${test.max_score}`}
            tone={(test.score ?? 0) >= test.max_score * 0.5 ? "good" : "warn"}
            hint={
              selfMark && stats.pending > 0
                ? `${stats.pending} mark${stats.pending > 1 ? "s" : ""} pending`
                : undefined
            }
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard label="Accuracy" value={`${stats.accuracy}%`} hint={`${stats.correct}/${stats.attempted}`} />
        </StaggerItem>
        <StaggerItem>
          <StatCard label="Attempt rate" value={`${stats.attemptRate}%`} hint={`${stats.attempted}/${rows.length}`} />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Negatives"
            value={`−${stats.wrong}`}
            tone={stats.wrong > 5 ? "bad" : "default"}
            hint={`score would be ${(test.score ?? 0) + stats.wrong} with guesses skipped`}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard label="Time used" value={fmtSecs(stats.time)} />
        </StaggerItem>
      </Stagger>

      {/* D4: self-mark banner (key-later tests) */}
      {selfMark ? (
        stats.pending > 0 || test.score === null ? (
          <div className="bg-amber-50 border border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/25 rounded-lg px-4 py-3 text-sm text-amber-800 dark:text-amber-300 flex items-center justify-between gap-3 flex-wrap">
            <span>
              <strong>Self-mark mode</strong> — mark each attempted question below. The score
              recomputes as you go.
            </span>
            <Badge variant="outline" className="border-amber-400 dark:border-amber-500/50 text-amber-800 dark:text-amber-300 whitespace-nowrap">
              pending marks: {markedCount}/{stats.attempted}
            </Badge>
          </div>
        ) : (
          <div className="bg-emerald-50 border border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/25 rounded-lg px-4 py-3 text-sm text-emerald-800 dark:text-emerald-300">
            <strong>Self-mark complete</strong> — score {test.score}/{test.max_score}. Toggles
            stay live if a mark needs correcting.
          </div>
        )
      ) : null}

      {/* D1: retry-wrong as a fresh CBT session */}
      {test.question_ids ? (
        <div className="bg-card border border-border card-shadow rounded-lg px-4 py-3 flex items-center gap-3 flex-wrap">
          <Button
            onClick={startRetry}
            disabled={retryIds.length === 0}
            className="bg-emerald-700 hover:bg-emerald-800 dark:bg-emerald-500 dark:hover:bg-emerald-600 dark:text-emerald-950 min-h-[44px] px-5 font-semibold"
          >
            ↻ Retry wrong ({retryIds.length})
          </Button>
          <p className="text-xs text-muted-foreground min-w-0 flex-1">
            Wrong + skipped-but-keyed questions, test order, 1 min each. The fastest way to prove
            the fix stuck.
          </p>
        </div>
      ) : test.pdf_meta ? (
        <div className="bg-card border border-border card-shadow rounded-lg px-4 py-3 flex items-center gap-3 flex-wrap">
          <Button disabled className="min-h-[44px] px-5">
            ↻ Retry wrong
          </Button>
          <p className="text-xs text-muted-foreground/70">
            PDF test — re-upload the PDF to retry this set.
          </p>
        </div>
      ) : null}

      {/* late answer-key upload — gave the test before having the key? score it now */}
      {test.pdf_meta ? (
        <div
          className={cn(
            "rounded-lg px-4 py-3 flex items-center gap-3 flex-wrap border",
            test.pdf_meta.key_later || test.pdf_meta.key.length === 0
              ? "bg-amber-50 border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/25"
              : "bg-card border-border card-shadow"
          )}
        >
          <Button
            onClick={openLateKey}
            className={cn(
              "min-h-[44px] px-5 font-semibold",
              test.pdf_meta.key_later || test.pdf_meta.key.length === 0
                ? "bg-emerald-700 hover:bg-emerald-800 dark:bg-emerald-500 dark:hover:bg-emerald-600 dark:text-emerald-950"
                : ""
            )}
            variant={
              test.pdf_meta.key_later || test.pdf_meta.key.length === 0
                ? "default"
                : "outline"
            }
          >
            {test.pdf_meta.key_later || test.pdf_meta.key.length === 0
              ? "Add answer key & score"
              : "Replace answer key"}
          </Button>
          <p
            className={cn(
              "text-xs min-w-0 flex-1",
              test.pdf_meta.key_later || test.pdf_meta.key.length === 0
                ? "text-amber-800 dark:text-amber-300"
                : "text-muted-foreground"
            )}
          >
            {test.pdf_meta.key_later || test.pdf_meta.key.length === 0
              ? "Gave the test without a key? Paste or upload the official key NOW — every answer gets re-checked and scored automatically. No self-marking needed."
              : "Paste a corrected key and the whole test is re-scored in place."}
          </p>
        </div>
      ) : null}

      {stats.untagged > 0 ? (
        <div className="bg-amber-50 border border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/25 rounded-lg px-4 py-3 text-sm text-amber-800 dark:text-amber-300 flex items-center justify-between gap-3 flex-wrap">
          <span>
            <strong>{stats.untagged} wrong answers</strong> still untagged. Tag them now — the
            dashboard&apos;s error-tag chart and formula sheet only work if every mistake is
            classified.
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="border-amber-400 text-amber-800 hover:bg-amber-100 dark:border-amber-500/50 dark:text-amber-300 dark:hover:bg-amber-500/10"
              onClick={jumpToNextUntagged}
            >
              ↦ Next untagged ({untaggedIds.length})
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-amber-400 text-amber-800 hover:bg-amber-100 dark:border-amber-500/50 dark:text-amber-300 dark:hover:bg-amber-500/10"
              onClick={() => setFilter("untagged")}
            >
              Show untagged
            </Button>
          </div>
        </div>
      ) : null}

      <SectionCard
        title="Per-question review"
        subtitle="your answer vs correct, time spent, and the tag that explains the mistake"
        action={
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex gap-1.5">
              {(["all", "wrong", "untagged"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    "press px-2.5 py-1 rounded-full text-xs transition-colors",
                    filter === f
                      ? "bg-foreground text-background"
                      : "bg-muted text-muted-foreground hover:bg-accent"
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
            <div className="flex gap-1.5" role="group" aria-label="Filter by subject">
              {(["all", "Physics", "Chemistry", "Mathematics"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSubjectFilter(s)}
                  aria-pressed={subjectFilter === s}
                  className={cn(
                    "press px-2.5 py-1 rounded-full text-xs transition-colors min-h-[28px]",
                    subjectFilter === s
                      ? "bg-emerald-700 dark:bg-emerald-500 text-white dark:text-emerald-950 font-medium"
                      : "bg-muted text-muted-foreground hover:bg-accent"
                  )}
                >
                  {s === "all" ? "All" : SUBJECT_SHORT[s]}
                </button>
              ))}
            </div>
          </div>
        }
      >
        {/* D8 shared hidden input — one file picker serves every row */}
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void onPhotoFile(e)}
        />

        {shown.length === 0 ? (
          <EmptyNote>Nothing to show for this filter.</EmptyNote>
        ) : (
          <ul className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
            {shown.map((r) => {
              const qNo = qNoOf.get(r.id) ?? 1;
              return (
                <li
                  key={r.id}
                  id={`resp-${r.id}`}
                  className={cn(
                    // left stripe = outcome at a glance (scannability rule:
                    // alignment + color carry the state, not badges alone)
                    "rounded-lg p-3 transition-shadow border border-l-4",
                    highlightId === r.id
                      ? "border-amber-400 border-l-amber-500 bg-amber-50 ring-2 ring-amber-300 dark:bg-amber-500/10 dark:ring-amber-500/40"
                      : !r.attempted
                        ? "border-border border-l-stone-300 dark:border-l-stone-600 bg-stone-50/60 dark:bg-stone-500/5"
                        : r.correct === true
                          ? "border-sage-100 border-l-sage-600 bg-sage-50/50 dark:border-sage-500/20 dark:border-l-sage-500 dark:bg-sage-500/5"
                          : r.correct === false
                            ? "border-red-100 border-l-red-500 bg-red-50/40 dark:border-red-500/20 dark:border-l-red-500 dark:bg-red-500/5"
                            : "border-amber-100 border-l-amber-500 bg-amber-50/40 dark:border-amber-500/20 dark:border-l-amber-500 dark:bg-amber-500/5" // pending self-mark
                  )}
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-xs font-bold text-muted-foreground">
                          Q{qNo}
                        </span>
                        <Badge variant="outline" className="text-[10px] border-border text-muted-foreground">
                          {r.type === "numerical" ? "NUM" : "MCQ"}
                        </Badge>
                        <span className="text-[11px] text-muted-foreground/70">{r.chapter}</span>
                        <span className="text-[11px] text-muted-foreground/70">{fmtSecs(r.time_spent)}</span>
                        {!r.attempted ? (
                          <Badge variant="outline" className="text-[10px] border-border text-muted-foreground/70">
                            unattempted
                          </Badge>
                        ) : r.correct === true ? (
                          <Badge className="text-[10px] bg-sage-600 dark:bg-sage-500 hover:bg-sage-600 dark:hover:bg-sage-500 text-white dark:text-sage-950 border-0">
                            +4
                          </Badge>
                        ) : r.correct === false ? (
                          <Badge className="text-[10px] bg-red-600 hover:bg-red-600 text-white border-0">
                            −1
                          </Badge>
                        ) : (
                          <Badge className="text-[10px] bg-amber-500 hover:bg-amber-500 text-white border-0">
                            pending
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-foreground">{r.question_snippet}</p>
                      <div className="mt-1.5">
                        <AnswerBits
                          selected={r.selected}
                          correctAnswer={r.correct_answer}
                          type={r.type}
                          options={r.options}
                          isPdf={r.question_id.startsWith("pdf:")}
                          tolerance={test.pdf_meta?.tolerance ?? 0}
                          attempted={r.attempted}
                          status={r.correct === true ? "right" : r.correct === false ? "wrong" : null}
                        />
                      </div>

                      {/* AI: step-by-step doubt buster (streams once, cached after) */}
                      <button
                        type="button"
                        onClick={() => setExplainTarget(explainTargetOf(r, qNo))}
                        className="press mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-primary transition-colors"
                        aria-label={`Explain Q${qNo} with AI`}
                      >
                        ✦ Explain with AI
                      </button>

                      {/* D7: one-line note (optional, blur-save) */}
                      <Input
                        defaultValue={r.note ?? ""}
                        placeholder="Add a one-line note — the actual insight (optional)"
                        className="mt-2 h-8 text-xs bg-transparent"
                        maxLength={280}
                        aria-label={`Note for Q${qNo}`}
                        onBlur={(e) => void saveNote(r, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        }}
                      />

                      {/* D8: solution photo — thumbnail opens full size */}
                      {r.photo ? (
                        <button
                          type="button"
                          onClick={() => setViewPhoto({ url: r.photo!, title: `Q${qNo} · ${r.chapter}`, id: r.id })}
                          className="mt-2 block rounded-md overflow-hidden border border-border hover:border-emerald-500 dark:hover:border-emerald-400 transition-colors"
                          aria-label={`View solution photo for Q${qNo}`}
                        >
                          <img
                            src={r.photo}
                            alt={`Solution photo for Q${qNo}`}
                            className="h-14 w-20 object-cover"
                          />
                        </button>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className={cn(
                            "mt-2 h-8 text-xs",
                            photoDragId === r.id && "border-primary bg-primary/5 text-primary"
                          )}
                          onDragOver={(e) => {
                            if (e.dataTransfer.types.includes("Files")) {
                              e.preventDefault();
                              setPhotoDragId(r.id);
                            }
                          }}
                          onDragLeave={() => setPhotoDragId((id) => (id === r.id ? null : id))}
                          onDrop={(e) => {
                            e.preventDefault();
                            setPhotoDragId(null);
                            const f = e.dataTransfer.files?.[0];
                            if (!f) return;
                            if (f.type.startsWith("image/")) void attachPhoto(f, r.id);
                            else toast.error("Drop an image file (JPG/PNG)");
                          }}
                          onClick={() => pickPhoto(r.id)}
                        >
                          📎 Attach solution photo
                        </Button>
                      )}
                    </div>

                    {/* D4: self-mark toggles (key-later tests only) */}
                    {selfMark ? (
                      <div className="flex flex-col gap-1 items-end shrink-0">
                        <span className="text-[10px] uppercase text-muted-foreground/70 font-medium">mark it</span>
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => void applyMark(r, r.correct === true ? null : true)}
                            className={cn(
                              "press px-2.5 min-h-[36px] rounded-md border text-xs font-semibold transition-colors",
                              r.correct === true
                                ? "bg-sage-700 dark:bg-sage-500 text-white dark:text-sage-950 border-sage-700 dark:border-sage-500"
                                : "bg-card border-border text-muted-foreground hover:border-sage-500 dark:hover:border-sage-400 hover:text-foreground"
                            )}
                          >
                            ✓ Correct
                          </button>
                          <button
                            type="button"
                            onClick={() => void applyMark(r, r.correct === false ? null : false)}
                            className={cn(
                              "press px-2.5 min-h-[36px] rounded-md border text-xs font-semibold transition-colors",
                              r.correct === false
                                ? "bg-red-600 text-white border-red-600"
                                : "bg-card border-border text-muted-foreground hover:border-red-400 hover:text-foreground"
                            )}
                          >
                            ✗ Wrong
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {/* tag UI: wrong-marked rows only (self-marked wrongs flow in here too) */}
                    {r.attempted && r.correct === false ? (
                      <div className="flex flex-col gap-1 items-end shrink-0">
                        <span className="text-[10px] uppercase text-muted-foreground/70 font-medium">tag it</span>
                        <div className="flex gap-1">
                          {ERROR_TAGS.map((t) => (
                            <button
                              key={t.code}
                              title={t.hint}
                              onClick={() => void tagResponse(r, t.code)}
                              className={cn(
                                "w-7 h-7 rounded-md border text-xs font-bold transition-colors",
                                r.error_tag === t.code
                                  ? TAG_CLS[t.code] + " ring-2 ring-offset-1 ring-stone-300 dark:ring-stone-500 dark:ring-offset-stone-950"
                                  : "bg-card border-border text-muted-foreground/60 hover:text-foreground hover:border-stone-400 dark:hover:border-stone-500"
                              )}
                            >
                              {t.code}
                            </button>
                          ))}
                        </div>
                        {r.error_tag ? (
                          <span className="text-[10px] text-muted-foreground/70">
                            {ERROR_TAGS.find((t) => t.code === r.error_tag)?.label}
                            {r.error_tag === "F" ? " → formula sheet ✓" : ""}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      {/* AI explanation dialog — works for bank + PDF questions alike */}
      <ExplainDialog target={explainTarget} onOpenChange={(o) => !o && setExplainTarget(null)} />

      {/* D8: full-size solution photo viewer */}
      <Dialog open={viewPhoto !== null} onOpenChange={(open) => !open && setViewPhoto(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Solution photo — {viewPhoto?.title}</DialogTitle>
            <DialogDescription>
              Attached to this question&apos;s review. Replace or remove it below.
            </DialogDescription>
          </DialogHeader>
          {viewPhoto ? (
            <img
              src={viewPhoto.url}
              alt={`Solution photo, ${viewPhoto.title}`}
              className="w-full h-auto max-h-[65vh] object-contain rounded-md border border-border bg-white"
            />
          ) : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (viewPhoto) pickPhoto(viewPhoto.id);
                setViewPhoto(null);
              }}
            >
              Replace
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10"
              onClick={() => viewPhoto && void removePhoto(viewPhoto.id)}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── late answer-key dialog: paste / key-PDF / grid → re-score ── */}
      <Dialog open={lkOpen} onOpenChange={(o) => !lkBusy && setLkOpen(o)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Answer key — after the test</DialogTitle>
            <DialogDescription>
              Paste the official key, upload a digital key PDF, or type into the grid. Applying it
              re-checks every answer of this test against the same rules as live scoring
              (+4 / −1, multi-answer keys, bonus questions, ±tolerance).
            </DialogDescription>
          </DialogHeader>

          <Textarea
            value={lkText}
            onChange={(e) => setLkText(e.target.value)}
            rows={5}
            placeholder={"1. A\n2. C\n7. B or C\n9. bonus\n5. 42"}
            className="font-mono text-sm"
          />

          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={lkKeyFileRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => void onLkKeyFile(e)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => lkKeyFileRef.current?.click()}
            >
              {lkFileName
                ? `✓ Key PDF: ${lkFileName.slice(0, 28)}`
                : "Upload answer-key PDF (digital)"}
            </Button>
            <div className="flex items-center gap-2">
              <Switch
                id="lk-opt-nums"
                checked={lkOptionNums}
                onCheckedChange={setLkOptionNums}
                aria-label="Key uses option numbers 1 to 4"
              />
              <Label htmlFor="lk-opt-nums" className="text-xs cursor-pointer">
                Key uses option numbers (1)–(4)
              </Label>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <Label htmlFor="lk-tol" className="text-xs whitespace-nowrap">
                Tolerance ±
              </Label>
              <Input
                id="lk-tol"
                value={lkTol}
                onChange={(e) => setLkTol(e.target.value)}
                inputMode="decimal"
                className="h-8 w-20 text-xs"
              />
            </div>
          </div>

          {/* key grid over the paper range */}
          {lkRenderCells.length > 0 ? (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className="bg-emerald-700 dark:bg-emerald-500 hover:bg-emerald-700 dark:hover:bg-emerald-500 text-white dark:text-emerald-950 border-0">
                  {lkGridKey.length} key{lkGridKey.length === 1 ? "" : "s"} in grid
                </Badge>
                {lkMissing.length === 0 ? (
                  <Badge variant="outline" className="border-emerald-300 text-emerald-700">
                    full coverage of Q{lkRange?.first}–{lkRange?.last}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-amber-400 text-amber-700">
                    missing: {lkMissing.slice(0, 10).join(", ")}
                    {lkMissing.length > 10 ? ` +${lkMissing.length - 10}` : ""}
                  </Badge>
                )}
                {lkNos.length > LK_MAX_CELLS ? (
                  <Badge variant="outline" className="border-amber-400 text-amber-700">
                    showing first {LK_MAX_CELLS} cells
                  </Badge>
                ) : null}
              </div>
              <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-1.5 max-h-64 overflow-y-auto p-0.5">
                {lkRenderCells.map((no) => {
                  const raw = lkGrid[no] ?? "";
                  const res = raw.trim() === "" ? null : parseCell(raw, lkOptionNums);
                  const invalid = res !== null && res.kind === "invalid";
                  return (
                    <div key={no} className="space-y-0.5">
                      <div
                        className={cn(
                          "text-[10px] leading-none",
                          invalid ? "text-red-500 font-semibold" : "text-muted-foreground/70"
                        )}
                      >
                        Q{no}
                      </div>
                      <Input
                        value={raw}
                        onChange={(e) => setLkCell(no, e.target.value)}
                        className={cn(
                          "h-8 text-xs font-mono px-1.5 text-center",
                          invalid && "border-red-400 focus-visible:ring-red-300"
                        )}
                        aria-label={`Key for question ${no}`}
                        placeholder="—"
                      />
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <EmptyNote>
              This test has no question range on record — paste the key above and the parsed
              entries will show up here.
            </EmptyNote>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" size="sm" disabled={lkBusy} onClick={() => setLkOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-emerald-700 hover:bg-emerald-800 dark:bg-emerald-500 dark:hover:bg-emerald-600 dark:text-emerald-950"
              disabled={lkBusy || lkGridKey.length === 0}
              onClick={() => void applyLkKey()}
            >
              {lkBusy ? "Scoring…" : `Apply key & score (${lkGridKey.length})`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
