"use client";

// ─── CBT / PDF test player — NTA palette, countdown, per-question timing ────
// Sprint B: keyboard shortcuts, Previous, NTA palette contrast, full-paper
// sections (paper numbering), PDF page nav/zoom/pins, timer stages,
// marksFor() scoring (bonus / multi-answer keys / tolerance) + key-later submit.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { EASE } from "./motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Minus, Plus, Pin } from "lucide-react";
import { cn } from "@/lib/utils";
import { saveSession, useLive } from "@/lib/idb";
import { marksFor } from "@/lib/scoring";
import {
  checkPdfAnswer,
  entryIsLetter,
  keyDisplay,
} from "@/lib/pdf-key";
import {
  SUBJECT_SHORT,
  todayStr,
  uid,
  type ActiveSession,
  type PdfSection,
  type Question,
  type ResponseRecord,
  type Subject,
  type TestRecord,
} from "@/lib/types";

const LETTERS = ["A", "B", "C", "D"];
const ZOOM_STEPS = [1.0, 1.4, 1.8, 2.2]; // − / + cycle through these (default 1.6)

type SlotInfo = {
  slot: string; // question id (cbt) or position "1".."N" (pdf) — answers/marked/q_times key
  no: number; // displayed number (cbt: position; pdf: paper number, e.g. 21..36)
  subject: Subject;
  chapter?: string; // pdf: owning section's chapter
};

/** A slot as submit needs it: persisted key + paper number + section identity. */
type SubmitSlot = { key: string; paperNo: number; subject: Subject; chapter: string };

/** pdf_meta.sections (always present after import/idb normalization); synthesize defensively. */
function sectionsOf(meta: NonNullable<ActiveSession["pdf_meta"]>): PdfSection[] {
  if (meta.sections && meta.sections.length > 0) return meta.sections;
  const firstQ = meta.first_q ?? 1;
  return [
    {
      subject: meta.subject,
      chapter: meta.chapter,
      first_q: firstQ,
      last_q: firstQ + meta.total_questions - 1,
      start_page: meta.start_page,
      end_page: meta.end_page,
    },
  ];
}

/** Paper-numbered slots from sections, in section order. key = persisted position "1".."N". */
function pdfSlotList(meta: NonNullable<ActiveSession["pdf_meta"]>): SubmitSlot[] {
  const out: SubmitSlot[] = [];
  for (const sec of sectionsOf(meta)) {
    for (let n = sec.first_q; n <= sec.last_q; n++) {
      out.push({ key: String(out.length + 1), paperNo: n, subject: sec.subject, chapter: sec.chapter });
    }
  }
  return out;
}

/** B4: pins win; else per-section even-split over the section's pages; else meta-level estimate. */
function pageForQuestion(s: ActiveSession, paperNo: number): number {
  const meta = s.pdf_meta;
  if (!meta) return 1;
  const pin = meta.page_pins?.[String(paperNo)];
  if (typeof pin === "number" && pin >= 1) return pin;
  const sec = sectionsOf(meta).find((x) => paperNo >= x.first_q && paperNo <= x.last_q);
  if (sec) {
    const pages = Math.max(1, sec.end_page - sec.start_page + 1);
    const perPage = Math.max(1, Math.ceil((sec.last_q - sec.first_q + 1) / pages));
    return sec.start_page + Math.floor((paperNo - sec.first_q) / perPage);
  }
  const pages = Math.max(1, meta.end_page - meta.start_page + 1);
  const perPage = Math.max(1, Math.ceil(Math.max(1, meta.total_questions) / pages));
  return meta.start_page + Math.floor((paperNo - (meta.first_q ?? 1)) / perPage);
}

// ── key-entry matching lives in @/lib/pdf-key (shared with PdfImport/Results) ─

function pdfKeyIsLetter(s: ActiveSession, paperNo: number): boolean {
  const entry = s.pdf_meta?.key.find((k) => k.no === paperNo);
  return entry !== undefined && entryIsLetter(entry);
}

export function PlayerView({
  session,
  pdfBlob,
  onPersist,
  onFinish,
}: {
  session: ActiveSession;
  pdfBlob: Blob | null;
  onPersist: (s: ActiveSession) => void;
  onFinish: (testId: string) => void;
}) {
  const questions = useLive("questions");
  const [now, setNow] = useState(Date.now());
  const [pdfPage, setPdfPage] = useState<HTMLCanvasElement | null>(null);
  const [pdfErr, setPdfErr] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [viewPage, setViewPage] = useState(1); // page currently shown in the panel
  const [pageInput, setPageInput] = useState("1");
  const [zoom, setZoom] = useState(1.6);
  const [numPages, setNumPages] = useState<number | null>(null);
  const submittingRef = useRef(false);
  const pdfDocRef = useRef<Awaited<ReturnType<typeof import("pdfjs-dist").getDocument>["promise"]> | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void; promise: Promise<unknown> } | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const qMap = useMemo(
    () => new Map(questions.map((q) => [q.id, q] as const)),
    [questions]
  );

  const slots: SlotInfo[] = useMemo(() => {
    if (session.mode === "cbt") {
      const out: SlotInfo[] = [];
      let no = 1;
      for (const id of session.question_ids) {
        const q = qMap.get(id);
        if (!q) continue;
        out.push({ slot: id, no: no++, subject: q.subject });
      }
      return out;
    }
    const meta = session.pdf_meta;
    if (!meta) return [];
    // B3: slots from sections — paper numbers first_q..last_q, subject/chapter per section
    return pdfSlotList(meta).map((sl) => ({
      slot: sl.key,
      no: sl.paperNo,
      subject: sl.subject,
      chapter: sl.chapter,
    }));
  }, [session, qMap]);

  const currentSlot = slots[Math.min(session.current, slots.length - 1)];

  // sections = subjects in order of appearance (P/C/M for full papers)
  const sections = useMemo(() => {
    const seen: Subject[] = [];
    for (const s of slots) {
      if (!seen.includes(s.subject)) seen.push(s.subject);
    }
    return seen;
  }, [slots]);

  const sectionRanges = useMemo(() => {
    return sections.map((subj) => {
      const idxs = slots.map((s, i) => (s.subject === subj ? i : -1)).filter((i) => i >= 0);
      return { subject: subj, start: idxs[0] ?? 0, end: idxs[idxs.length - 1] ?? 0 };
    });
  }, [sections, slots]);

  // ── timer ──
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const remaining = Math.max(
    0,
    session.duration_min * 60 - (now - session.started_at) / 1000
  );
  const mins = Math.floor(remaining / 60);
  const secs = Math.floor(remaining % 60);
  // B5 timer stages — proportional so a 5-min drill doesn't scream "amber"
  // at t=0 like the old absolute 2/10-minute cutoffs did.
  // full mock (180 min): red ≤ 2 min, amber ≤ 10 min (original semantics);
  // short drill (5 min): red ≤ 45 s, amber ≤ 2 min.
  const totalSecs = Math.max(60, session.duration_min * 60);
  const redAt = Math.min(120, Math.round(totalSecs * 0.15));
  const amberAt = Math.max(redAt + 60, Math.min(600, Math.round(totalSecs * 0.4)));
  const timeStage: "red" | "amber" | "normal" =
    remaining <= redAt ? "red" : remaining <= amberAt ? "amber" : "normal";

  // ── per-question time accounting ──
  const commitTime = useCallback(
    (s: ActiveSession, nextIndex: number): ActiveSession => {
      const elapsed = (Date.now() - s.q_entered_at) / 1000;
      const cur = s.question_ids[s.current] ?? String(s.current + 1);
      return {
        ...s,
        q_times: { ...s.q_times, [cur]: (s.q_times[cur] ?? 0) + elapsed },
        current: nextIndex,
        q_entered_at: Date.now(),
      };
    },
    []
  );

  const persist = useCallback(
    (s: ActiveSession) => {
      onPersist(s);
      void saveSession(s);
    },
    [onPersist]
  );

  function goTo(index: number) {
    if (index < 0 || index >= slots.length) return;
    persist(commitTime(sessionRef.current, index));
  }

  function setAnswer(slot: string, value: number | string | null) {
    const s = sessionRef.current;
    persist({ ...s, answers: { ...s.answers, [slot]: value } });
  }

  function markAndNext() {
    const s = sessionRef.current;
    const cur = s.question_ids[s.current] ?? String(s.current + 1);
    const marked = s.marked.includes(cur) ? s.marked : [...s.marked, cur];
    const next = Math.min(s.current + 1, slots.length - 1);
    persist({ ...commitTime({ ...s, marked }, next), marked });
  }

  function saveAndNext() {
    const s = sessionRef.current;
    const next = Math.min(s.current + 1, slots.length - 1);
    persist(commitTime(s, next));
  }

  function clearResponse() {
    const s = sessionRef.current;
    if (!currentSlot) return;
    persist({
      ...s,
      answers: { ...s.answers, [currentSlot.slot]: null },
      marked: s.marked.filter((m) => m !== currentSlot.slot),
    });
  }

  // ── B1: keyboard shortcuts — one window handler, always-fresh via ref ──────
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandlerRef.current = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (
      t &&
      (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)
    ) {
      return;
    }
    // any open Radix dialog (submit confirm / abandon) owns the keyboard
    if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
    const s = sessionRef.current;
    const slot = currentSlot;
    if (!s || !slot) return;
    const key = e.key;
    const isMcq =
      s.mode === "pdf" ? pdfKeyIsLetter(s, slot.no) : qMap.get(slot.slot)?.type === "MCQ";
    // 1-4 / a-d select the option (no auto-advance)
    if (isMcq && /^[1-4]$/.test(key)) {
      e.preventDefault();
      const i = Number(key) - 1;
      setAnswer(slot.slot, s.mode === "pdf" ? LETTERS[i] : i);
      return;
    }
    if (isMcq && /^[a-dA-D]$/.test(key)) {
      e.preventDefault();
      const i = key.toLowerCase().charCodeAt(0) - 97;
      setAnswer(slot.slot, s.mode === "pdf" ? LETTERS[i] : i);
      return;
    }
    if (key === "Enter") {
      e.preventDefault();
      saveAndNext();
      return;
    }
    if (key === "ArrowLeft") {
      e.preventDefault();
      goTo(s.current - 1);
      return;
    }
    if (key === "m" || key === "M") {
      e.preventDefault();
      markAndNext();
      return;
    }
    if (key === "c" || key === "C") {
      e.preventDefault();
      clearResponse();
      return;
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyHandlerRef.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // ── submit ──
  const submit = useCallback(async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    const s = sessionRef.current;
    // completion micro-interaction: one tasteful burst, brand palette
    // (research: canvas-confetti is the shipped ed-tech completion pattern)
    const celebrate = () => {
      import("canvas-confetti")
        .then(({ default: confetti }) => {
          confetti({
            particleCount: 110,
            spread: 75,
            startVelocity: 40,
            origin: { y: 0.7 },
            // NOVA palette — violet / cyan / magenta / white sparks
            colors: ["#8b5cf6", "#22d3ee", "#e879f9", "#f8fafc"],
          });
        })
        .catch(() => {});
    };
    // finalize last question's time
    const elapsed = (Date.now() - s.q_entered_at) / 1000;
    const cur = s.question_ids[s.current] ?? String(s.current + 1);
    const qTimes = { ...s.q_times, [cur]: (s.q_times[cur] ?? 0) + elapsed };

    const responses: ResponseRecord[] = [];
    let score = 0;
    const subjectScores: Record<Subject, number> = {
      Physics: 0,
      Chemistry: 0,
      Mathematics: 0,
    };

    if (s.mode === "cbt") {
      let pos = 0;
      for (const id of s.question_ids) {
        pos += 1;
        const q = qMap.get(id);
        if (!q) continue;
        const raw = s.answers[id];
        const selected = raw === undefined || raw === "" || raw === null ? null : raw;
        const attempted = selected !== null;
        let correct = false;
        if (attempted) {
          if (q.type === "MCQ") correct = selected === q.answer;
          else {
            const u = Number(selected);
            correct =
              !Number.isNaN(u) &&
              Math.abs(u - Number(q.answer)) <= (q.tolerance || 0) + 1e-9;
          }
        }
        const marks = marksFor(attempted, correct);
        score += marks;
        subjectScores[q.subject] += marks;
        responses.push({
          id: uid(),
          test_id: s.test_id,
          question_id: id,
          selected,
          correct,
          attempted,
          q_no: pos,
          time_spent: Math.round(qTimes[id] ?? 0),
          error_tag: null,
          subject: q.subject,
          chapter: q.chapter,
          question_snippet: q.question.slice(0, 240),
          correct_answer: q.answer,
          type: q.type,
          options: q.options,
        });
      }
      const max = s.question_ids.length * 4;
      const record: TestRecord = {
        id: s.test_id,
        date: todayStr(),
        created_at: Date.now(),
        name: s.name,
        source: "in-app",
        type: s.test_type,
        duration_min: s.duration_min,
        score,
        max_score: max,
        subject_scores: subjectScores,
        question_ids: s.question_ids,
      };
      await (await import("@/lib/idb")).bulkPut("responses", responses);
      await (await import("@/lib/idb")).put("tests", record);
      celebrate();
      onFinish(s.test_id);
      return;
    }

    // PDF mode
    const meta = s.pdf_meta;
    if (!meta) {
      onFinish(s.test_id);
      return;
    }
    const tol = meta.tolerance ?? 0;
    const keyLater = meta.key_later === true; // D4: no key → no scoring, self-mark in Results
    const keyByNo = new Map(meta.key.map((k) => [k.no, k] as const));

    for (const sl of pdfSlotList(meta)) {
      const raw = s.answers[sl.key];
      const selected =
        raw === undefined || raw === "" || raw === null ? null : String(raw);
      const attempted = selected !== null;
      const entry = keyByNo.get(sl.paperNo);
      const isBonus = entry?.bonus === true;
      let correct: boolean | null = null;
      if (!keyLater) {
        if (selected !== null && entry) {
          correct = checkPdfAnswer(entry, selected, tol);
        }
        // bonus (dropped question) counts as solved for everyone — persist it,
        // so review rows / retry candidates / analytics all agree with the score
        if (isBonus) correct = true; // bonus-fix-v2
        // bonus → +4 regardless (marksFor handles it); keyless-attempted → 0, never −1
        const marks = marksFor(attempted || isBonus, correct, isBonus);
        score += marks;
        subjectScores[sl.subject] += marks;
      }
      responses.push({
        id: uid(),
        test_id: s.test_id,
        question_id: `pdf:${s.test_id}:${sl.paperNo}`,
        selected: attempted ? selected : null,
        correct: keyLater ? null : correct,
        attempted,
        q_no: sl.paperNo,
        time_spent: Math.round(qTimes[sl.key] ?? 0),
        error_tag: null,
        subject: sl.subject,
        chapter: sl.chapter,
        question_snippet: `PDF Q${sl.paperNo} (page ${pageForQuestion(s, sl.paperNo)})`,
        correct_answer: entry ? keyDisplay(entry) : "?",
        type: entry && entryIsLetter(entry) ? "MCQ" : "numerical",
        options: entry && entryIsLetter(entry) ? ["A", "B", "C", "D"] : [],
      });
    }
    const record: TestRecord = {
      id: s.test_id,
      date: todayStr(),
      created_at: Date.now(),
      name: s.name,
      source: "PDF",
      type: "pdf",
      duration_min: s.duration_min,
      score: keyLater ? null : score,
      max_score: meta.total_questions * 4,
      subject_scores: keyLater ? {} : subjectScores,
      pdf_meta: meta,
    };
    const idb = await import("@/lib/idb");
    await idb.bulkPut("responses", responses);
    await idb.put("tests", record);
    if (keyLater) {
      toast.info("Self-mark each question to compute your score.");
    }
    onFinish(s.test_id);
  }, [qMap, onFinish]);

  // auto-submit when the clock hits zero
  useEffect(() => {
    if (remaining <= 0 && !submittingRef.current) {
      void submit();
    }
  }, [remaining, submit]);

  // warn before leaving with a live test
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);

  const curNo = currentSlot ? currentSlot.no : 1;

  // ── B4: the panel follows the question's page (pin-aware) ──
  useEffect(() => {
    setViewPage(pageForQuestion(sessionRef.current, curNo));
  }, [curNo, session.mode]);

  useEffect(() => {
    setPageInput(String(viewPage));
  }, [viewPage]);

  // ── pdf.js: load document once, render the viewed page at the chosen zoom ──
  useEffect(() => {
    let cancelled = false;
    if (session.mode !== "pdf" || !pdfBlob) {
      setPdfErr(session.mode === "pdf" ? "PDF file missing — discard the test and re-import." : null);
      return;
    }
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        if (!pdfDocRef.current) {
          const buf = await pdfBlob.arrayBuffer();
          pdfDocRef.current = await pdfjs.getDocument({ data: buf }).promise;
        }
        if (cancelled || !pdfDocRef.current) return;
        setNumPages(pdfDocRef.current.numPages);
        const pageNo = Math.min(Math.max(1, viewPage), pdfDocRef.current.numPages);
        const page = await pdfDocRef.current.getPage(pageNo);
        if (cancelled) return;
        const viewport = page.getViewport({ scale: zoom });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        renderTaskRef.current?.cancel();
        const task = page.render({ canvasContext: ctx, viewport });
        renderTaskRef.current = task;
        try {
          await task.promise;
        } catch (err) {
          if (cancelled) return; // superseded by a newer render — ignore
          throw err;
        }
        if (!cancelled) {
          setPdfPage(canvas);
          setPdfErr(null);
        }
      } catch (e) {
        if (!cancelled) setPdfErr(`PDF render failed: ${String(e)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session.mode, pdfBlob, viewPage, zoom]);

  if (slots.length === 0) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">This test has no questions available.</p>
        <Button variant="outline" className="mt-4" onClick={() => onFinish("")}>
          Back
        </Button>
      </div>
    );
  }

  const curQ: Question | undefined =
    session.mode === "cbt" && currentSlot ? qMap.get(currentSlot.slot) : undefined;
  const selected = currentSlot ? session.answers[currentSlot.slot] : undefined;
  const isMarked = currentSlot ? session.marked.includes(currentSlot.slot) : false;
  const answeredCount = Object.values(session.answers).filter(
    (v) => v !== null && v !== undefined && v !== ""
  ).length;
  const keyLater = session.mode === "pdf" && session.pdf_meta?.key_later === true;
  const pinForCurrent = session.pdf_meta?.page_pins?.[String(curNo)];

  // active section derived from current question's subject
  const activeSection = currentSlot?.subject ?? sections[0];

  function sectionTabClick(subj: Subject) {
    const range = sectionRanges.find((r) => r.subject === subj);
    if (!range) return;
    // jump to the section's first unanswered question (its first question if all answered)
    let target = range.start;
    for (let i = range.start; i <= range.end; i++) {
      const a = slots[i] ? session.answers[slots[i].slot] : undefined;
      if (a === undefined || a === null || a === "") {
        target = i;
        break;
      }
    }
    goTo(target);
  }

  function commitPageJump() {
    const max = numPages ?? 1;
    const n = Math.round(Number(pageInput));
    if (!Number.isFinite(n) || n < 1) {
      setPageInput(String(viewPage));
      return;
    }
    setViewPage(Math.min(n, max));
  }

  function stepZoom(dir: 1 | -1) {
    setZoom((z) => {
      const sorted = [...ZOOM_STEPS].sort((a, b) => a - b);
      const next =
        dir > 0
          ? sorted.find((v) => v > z + 1e-9)
          : [...sorted].reverse().find((v) => v < z - 1e-9);
      return next ?? z;
    });
  }

  function pinCurrentPage() {
    const s = sessionRef.current;
    const meta = s.pdf_meta;
    if (!meta) return;
    const pins = { ...(meta.page_pins ?? {}) };
    pins[String(curNo)] = viewPage;
    persist({ ...s, pdf_meta: { ...meta, page_pins: pins } });
    toast.success(`Q${curNo} pinned to page ${viewPage}`);
  }

  return (
    <div className="space-y-4">
      {/* header — the hairline under the clock drains away as time runs out */}
      <div
        className={cn(
          "glass-deep border rounded-xl px-4 pt-3 pb-3.5 flex items-center justify-between gap-3 flex-wrap relative overflow-hidden",
          timeStage === "red"
            ? "border-red-300 dark:border-red-500/40"
            : timeStage === "amber"
              ? "border-amber-300 dark:border-amber-500/40"
              : "border-border"
        )}
      >
        <div className="min-w-0">
          <div className="font-semibold text-foreground truncate">{session.name}</div>
          <div className="text-xs text-muted-foreground/70">
            {slots.length} questions ·{" "}
            {keyLater ? "key comes later — self-mark after submit" : "+4 / −1 / 0 · numericals included"}
          </div>
        </div>
        <div className="hidden md:block text-[11px] text-muted-foreground/70" aria-hidden="true">
          ⌨ 1-4 · Enter · ← · M · C
        </div>
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "text-2xl font-black tabular-nums px-4 py-1.5 rounded-lg",
              timeStage === "red"
                ? "bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-400"
                : timeStage === "amber"
                  ? "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                  : "bg-muted text-foreground"
            )}
            aria-live="polite"
          >
            {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
          </div>
          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialogTrigger asChild>
              <Button className="bg-primary hover:bg-primary/90">Submit</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Submit test?</AlertDialogTitle>
                <AlertDialogDescription>
                  {answeredCount} answered · {slots.length - answeredCount} unattempted.{" "}
                  {keyLater
                    ? "There's no key yet — you'll self-mark every question in review."
                    : "After submit you tag every mistake — that's where the marks come back."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep solving</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-primary hover:bg-primary/90"
                  onClick={() => void submit()}
                >
                  Submit &amp; analyze
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
        {/* remaining-time bar — drains toward zero; normal stage is a lit
            violet→cyan filament with a scanning shimmer, then recolors */}
        <div className="absolute inset-x-0 bottom-0 h-0.5" aria-hidden="true">
          <div
            className={cn(
              "h-full transition-[width] duration-500 ease-linear",
              timeStage === "red"
                ? "bg-red-500"
                : timeStage === "amber"
                  ? "bg-amber-500"
                  : "bg-gradient-to-r from-violet-500 to-cyan-400 shimmer"
            )}
            style={{ width: `${Math.max(0, Math.min(100, (remaining / Math.max(1, session.duration_min * 60)) * 100))}%` }}
          />
        </div>
      </div>

      <div className="grid lg:grid-cols-4 gap-4">
        {/* main panel */}
        <div className="lg:col-span-3 bg-card border border-border card-shadow rounded-xl p-4 min-h-[420px] flex flex-col">
          {session.mode === "pdf" ? (
            <div className="flex-1 flex flex-col">
              <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="border-border text-muted-foreground">
                    PDF page {viewPage}
                    {numPages ? ` / ${numPages}` : ""}
                  </Badge>
                  {pinForCurrent ? (
                    <Badge variant="outline" className="border-purple-300 dark:border-purple-500/40 text-purple-700 dark:text-purple-300 gap-1">
                      <Pin className="w-3 h-3" aria-hidden="true" /> Q{curNo} → p{pinForCurrent}
                    </Badge>
                  ) : null}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-10 w-10 p-0"
                    onClick={() => setViewPage((v) => Math.max(1, v - 1))}
                    disabled={viewPage <= 1}
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <Input
                    className="h-10 w-14 text-center"
                    value={pageInput}
                    onChange={(e) => setPageInput(e.target.value)}
                    onBlur={commitPageJump}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitPageJump();
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                    inputMode="numeric"
                    aria-label="Jump to page"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-10 w-10 p-0"
                    onClick={() => setViewPage((v) => Math.min(numPages ?? v + 1, v + 1))}
                    disabled={numPages !== null && viewPage >= numPages}
                    aria-label="Next page"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-10 w-10 p-0"
                    onClick={() => stepZoom(-1)}
                    aria-label="Zoom out"
                  >
                    <Minus className="w-4 h-4" />
                  </Button>
                  <span
                    className="h-10 min-w-12 px-2 inline-flex items-center justify-center rounded-md border border-border bg-card text-xs font-medium tabular-nums text-muted-foreground"
                    aria-live="polite"
                  >
                    {zoom.toFixed(1)}×
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-10 w-10 p-0"
                    onClick={() => stepZoom(1)}
                    aria-label="Zoom in"
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-10 px-3 gap-1.5"
                    onClick={pinCurrentPage}
                    aria-label={`Pin page ${viewPage} to question ${curNo}`}
                  >
                    <Pin className="w-4 h-4" aria-hidden="true" />
                    Pin Q{curNo} · p{viewPage}
                  </Button>
                </div>
              </div>
              {pdfErr ? (
                <div className="text-xs text-red-500 mb-2">{pdfErr}</div>
              ) : null}
              <div className="border border-border rounded-lg overflow-auto max-h-[420px] bg-muted">
                {pdfPage ? (
                  <canvas
                    className="w-full h-auto block"
                    ref={(node) => {
                      if (node && pdfPage) {
                        const ctx = node.getContext("2d");
                        if (ctx) {
                          node.width = pdfPage.width;
                          node.height = pdfPage.height;
                          ctx.drawImage(pdfPage, 0, 0);
                        }
                      }
                    }}
                  />
                ) : (
                  <div className="p-10 text-center text-sm text-muted-foreground/70">
                    {pdfErr ? pdfErr : "Rendering page…"}
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {session.mode === "pdf" && currentSlot ? (
            <div className="flex-1 flex flex-col mt-3">
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-foreground">Q{currentSlot.no}</span>
                  <Badge variant="outline" className="text-[10px] border-border text-muted-foreground">
                    {pdfKeyIsLetter(session, currentSlot.no) ? "MCQ" : "NUMERICAL"}
                  </Badge>
                  <Badge variant="outline" className="text-[10px] border-border text-muted-foreground">
                    {currentSlot.chapter ?? session.pdf_meta?.chapter}
                  </Badge>
                </div>
                <span className="text-xs text-muted-foreground/70">
                  time on this Q:{" "}
                  {Math.round(
                    (now - session.q_entered_at) / 1000 +
                      (session.q_times[currentSlot.slot] ?? 0)
                  )}
                  s
                </span>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                Read the question from the paper above, then answer here:
              </p>
              {pdfKeyIsLetter(session, currentSlot.no) ? (
                <div className="flex gap-2">
                  {LETTERS.map((l) => (
                    <button
                      key={l}
                      onClick={() => setAnswer(currentSlot.slot, l)}
                      className={cn(
                        "press w-14 h-14 rounded-lg border text-lg font-bold transition-colors",
                        selected === l
                          ? "border-emerald-700 bg-emerald-50 text-emerald-800 dark:border-emerald-500 dark:bg-emerald-500/15 dark:text-emerald-300"
                          : "border-border hover:border-emerald-400 dark:hover:border-emerald-500 hover:bg-accent/50"
                      )}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="max-w-xs">
                  <p className="text-xs text-muted-foreground/70 mb-1.5">Your answer (number):</p>
                  <Input
                    value={typeof selected === "string" || typeof selected === "number" ? String(selected) : ""}
                    onChange={(e) => setAnswer(currentSlot.slot, e.target.value)}
                    inputMode="decimal"
                    placeholder="type the value"
                  />
                  <p className="text-[11px] text-muted-foreground/70 mt-2">
                    Numericals carry −1 for wrong entries — leave blank instead of guessing.
                  </p>
                </div>
              )}
            </div>
          ) : curQ ? (
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={session.current}
                initial={{ opacity: 0, x: 18 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -14 }}
                transition={{ duration: 0.18, ease: EASE }}
                className="flex-1 flex flex-col"
              >
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-foreground">Q{currentSlot?.no}</span>
                    <Badge variant="outline" className="text-[10px] border-border text-muted-foreground">
                      {curQ.type === "numerical" ? "NUMERICAL" : "MCQ"}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] border-border text-muted-foreground">
                      {curQ.chapter}
                    </Badge>
                  </div>
                  <span className="text-xs text-muted-foreground/70">
                    time on this Q: {Math.round(((now - session.q_entered_at) / 1000 + (session.q_times[currentSlot.slot] ?? 0)))}s
                  </span>
                </div>
                <p className="text-base text-foreground mb-5 leading-relaxed">{curQ.question}</p>

                {curQ.image ? (
                  <img
                    src={curQ.image}
                    alt={`Figure for question ${currentSlot?.no ?? ""}`}
                    className="max-h-64 rounded-lg border border-border bg-white mb-4"
                  />
                ) : null}

                {curQ.type === "MCQ" ? (
                  <div className="space-y-2">
                    {curQ.options.map((opt, i) => (
                      <button
                        key={i}
                        onClick={() => setAnswer(currentSlot.slot, i)}
                        className={cn(
                          "press w-full text-left px-4 py-3 rounded-lg border text-sm transition-colors flex items-center gap-3",
                          selected === i
                            ? "border-emerald-700 bg-emerald-50 dark:border-emerald-500 dark:bg-emerald-500/15 font-medium"
                            : "border-border hover:border-emerald-400 dark:hover:border-emerald-500 hover:bg-accent/50"
                        )}
                      >
                        <span
                          className={cn(
                            "w-6 h-6 rounded-full grid place-items-center text-xs font-bold border shrink-0",
                            selected === i
                              ? "bg-primary text-primary-foreground border-primary"
                              : "border-border text-muted-foreground"
                          )}
                        >
                          {LETTERS[i]}
                        </span>
                        {opt}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="max-w-xs">
                    <p className="text-xs text-muted-foreground/70 mb-1.5">Your answer (number):</p>
                    <Input
                      value={typeof selected === "string" || typeof selected === "number" ? String(selected) : ""}
                      onChange={(e) => setAnswer(currentSlot.slot, e.target.value)}
                      inputMode="decimal"
                      placeholder="type the value"
                    />
                    <p className="text-[11px] text-muted-foreground/70 mt-2">
                      Exact match within the question&apos;s tolerance. Numericals carry −1 for wrong
                      entries — leave blank instead of guessing.
                    </p>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          ) : (
            <div className="flex-1 grid place-items-center text-muted-foreground/70 text-sm">
              Question not found in the bank — it may have been deleted.
            </div>
          )}

          {/* action bar */}
          <div className="flex flex-wrap gap-2 pt-4 mt-4 border-t border-border/60">
            <Button
              variant="ghost"
              size="sm"
              className="h-10 px-3"
              onClick={() => goTo(session.current - 1)}
              disabled={session.current <= 0}
              aria-label="Previous question"
            >
              ← Previous
            </Button>
            <Button variant="outline" size="sm" className="h-10 px-3" onClick={clearResponse}>
              Clear Response
            </Button>
            <div className="flex-1" />
            <Button
              variant="outline"
              size="sm"
              onClick={markAndNext}
              className="h-10 px-3 border-purple-300 dark:border-purple-500/40 text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-500/10"
            >
              {isMarked ? "Marked ✓ ·" : "Mark for Review &"} Next
            </Button>
            <Button
              size="sm"
              onClick={saveAndNext}
              className="h-10 px-3 bg-primary hover:bg-primary/90"
            >
              Save &amp; Next
            </Button>
          </div>
        </div>

        {/* palette rail */}
        <div className="bg-card border border-border card-shadow rounded-xl p-4">
          <div className="flex flex-wrap gap-1.5 mb-3">
            {sections.map((s) => {
              const count = slots.filter((x) => x.subject === s).length;
              return (
                <button
                  key={s}
                  onClick={() => sectionTabClick(s)}
                  className={cn(
                    "press px-3 py-1.5 rounded-md text-xs font-medium transition-colors min-h-[36px]",
                    activeSection === s
                      ? "bg-foreground text-background"
                      : "bg-muted text-muted-foreground hover:bg-accent"
                  )}
                >
                  {SUBJECT_SHORT[s]} ({count})
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-7 gap-1 mb-3 max-h-64 overflow-y-auto p-0.5 sm:gap-1.5">
            {slots.map((s, i) => {
              const ans = session.answers[s.slot];
              const answered = ans !== null && ans !== undefined && ans !== "";
              const marked = session.marked.includes(s.slot);
              const isCurrent = i === session.current;
              return (
                <button
                  key={s.slot}
                  onClick={() => goTo(i)}
                  className={cn(
                    "press h-10 w-10 sm:h-8 sm:w-8 rounded-md text-xs font-semibold border-2 transition-colors relative font-mono tabular-nums",
                    answered && marked
                      ? "bg-emerald-600 dark:bg-emerald-500 text-white dark:text-emerald-950 border-purple-600 dark:border-purple-400"
                      : answered
                        ? "bg-emerald-600 dark:bg-emerald-500 text-white dark:text-emerald-950 border-emerald-600 dark:border-emerald-500"
                        : marked
                          ? "bg-white dark:bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-600 dark:border-purple-400"
                          : "bg-white dark:bg-transparent text-stone-600 dark:text-muted-foreground border-stone-300 dark:border-border",
                    isCurrent && "ring-2 ring-amber-400 ring-offset-1 ring-offset-background"
                  )}
                  aria-label={`Question ${s.no}${answered ? ", answered" : ""}${marked ? ", marked" : ""}`}
                >
                  {s.no}
                </button>
              );
            })}
          </div>

          <div className="text-[11px] text-muted-foreground space-y-1.5 border-t border-border/60 pt-3">
            <div className="flex items-center gap-2">
              <span className="w-4 h-4 rounded bg-emerald-600 dark:bg-emerald-500 border-2 border-emerald-600 dark:border-emerald-500 inline-block" />{" "}
              Answered
            </div>
            <div className="flex items-center gap-2">
              <span className="w-4 h-4 rounded bg-white dark:bg-purple-500/15 border-2 border-purple-600 dark:border-purple-400 inline-block" />{" "}
              Marked for review
            </div>
            <div className="flex items-center gap-2">
              <span className="w-4 h-4 rounded bg-emerald-600 dark:bg-emerald-500 border-2 border-purple-600 dark:border-purple-400 inline-block" />{" "}
              Answered &amp; marked
            </div>
            <div className="flex items-center gap-2">
              <span className="w-4 h-4 rounded bg-white dark:bg-transparent border-2 border-stone-300 dark:border-border inline-block" /> Not
              answered
            </div>
            <div className="flex items-center gap-2">
              <span className="w-4 h-4 rounded bg-white dark:bg-transparent border-2 border-stone-300 dark:border-border ring-2 ring-amber-400 ring-offset-1 ring-offset-background inline-block" />{" "}
              Current
            </div>
          </div>

          <div className="mt-3 pt-3 border-t border-border/60 text-xs text-muted-foreground">
            <div className="flex justify-between">
              <span>Answered</span>
              <span className="font-semibold tabular-nums">{answeredCount}</span>
            </div>
            <div className="flex justify-between">
              <span>Marked</span>
              <span className="font-semibold tabular-nums">{session.marked.length}</span>
            </div>
          </div>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="w-full mt-3 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10"
              >
                Abandon test
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Abandon this test?</AlertDialogTitle>
                <AlertDialogDescription>
                  The attempt will be discarded. Nothing gets logged — no score, no tags.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep going</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-red-600 hover:bg-red-700"
                  onClick={() => onFinish("")}
                >
                  Abandon
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  );
}
