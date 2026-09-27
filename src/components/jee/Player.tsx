"use client";

// ─── CBT / PDF test player — NTA palette, countdown, per-question timing ────
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { cn } from "@/lib/utils";
import { saveSession, useLive } from "@/lib/idb";
import {
  SUBJECT_SHORT,
  todayStr,
  uid,
  type ActiveSession,
  type Question,
  type ResponseRecord,
  type Subject,
  type TestRecord,
} from "@/lib/types";

const LETTERS = ["A", "B", "C", "D"];

type SlotInfo = {
  slot: string; // question id (cbt) or number-string (pdf)
  no: number; // 1-based position
  subject: Subject;
  label: string;
};

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
  const submittingRef = useRef(false);
  const pdfDocRef = useRef<Awaited<ReturnType<typeof import("pdfjs-dist").getDocument>["promise"]> | null>(null);
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
        out.push({ slot: id, no: no++, subject: q.subject, label: SUBJECT_SHORT[q.subject] });
      }
      return out;
    }
    const total = session.pdf_meta?.total_questions ?? 0;
    const subj = session.pdf_meta?.subject ?? "Physics";
    return Array.from({ length: total }, (_, i) => ({
      slot: String(i + 1),
      no: i + 1,
      subject: subj,
      label: SUBJECT_SHORT[subj],
    }));
  }, [session, qMap]);

  const currentSlot = slots[Math.min(session.current, slots.length - 1)];

  // sections = subjects in order of appearance
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

  // ── submit ──
  const submit = useCallback(async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    const s = sessionRef.current;
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
      for (const id of s.question_ids) {
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
        const marks = attempted ? (correct ? 4 : -1) : 0;
        score += marks;
        subjectScores[q.subject] += marks;
        responses.push({
          id: uid(),
          test_id: s.test_id,
          question_id: id,
          selected,
          correct,
          attempted,
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
      onFinish(s.test_id);
      return;
    }

    // PDF mode
    const meta = s.pdf_meta!;
    const keyMap = new Map(meta.key.map((k) => [k.no, k.answer]));
    for (let no = 1; no <= meta.total_questions; no++) {
      const raw = s.answers[String(no)];
      const selected =
        raw === undefined || raw === "" || raw === null ? null : String(raw);
      const attempted = selected !== null;
      const ans = keyMap.get(no);
      let correct = false;
      if (attempted && ans !== undefined) {
        if (/^[A-D]$/.test(ans)) correct = selected!.toUpperCase() === ans;
        else {
          const u = Number(selected);
          const a = Number(ans);
          correct = !Number.isNaN(u) && Math.abs(u - a) <= 1e-9;
        }
      }
      const marks = attempted ? (correct ? 4 : -1) : 0;
      score += marks;
      subjectScores[meta.subject] += marks;
      responses.push({
        id: uid(),
        test_id: s.test_id,
        question_id: `pdf:${s.test_id}:${no}`,
        selected: attempted ? selected : null,
        correct,
        attempted,
        time_spent: Math.round(qTimes[String(no)] ?? 0),
        error_tag: null,
        subject: meta.subject,
        chapter: meta.chapter,
        question_snippet: `PDF Q${no} (page ${pageForQuestion(s, no)})`,
        correct_answer: ans ?? "?",
        type: /^[A-D]$/.test(String(ans)) ? "MCQ" : "numerical",
        options: /^[A-D]$/.test(String(ans)) ? ["A", "B", "C", "D"] : [],
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
      score,
      max_score: meta.total_questions * 4,
      subject_scores: subjectScores,
      pdf_meta: meta,
    };
    const idb = await import("@/lib/idb");
    await idb.bulkPut("responses", responses);
    await idb.put("tests", record);
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

  // ── pdf.js: load document once, render current page ──
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
        const pageNo = pageForQuestion(sessionRef.current, curNo);
        const page = await pdfDocRef.current.getPage(Math.min(pageNo, pdfDocRef.current.numPages));
        if (cancelled) return;
        const scale = 1.6;
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        await page.render({ canvasContext: ctx, viewport }).promise;
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
  }, [session.mode, pdfBlob, curNo, session.current]);

  if (slots.length === 0) {
    return (
      <div className="text-center py-20">
        <p className="text-stone-500">This test has no questions available.</p>
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

  // active section derived from current question's subject
  const activeSection = currentSlot?.subject ?? sections[0];

  function sectionTabClick(subj: Subject) {
    const range = sectionRanges.find((r) => r.subject === subj);
    if (range) goTo(range.start);
  }

  return (
    <div className="space-y-4">
      {/* header */}
      <div
        className={cn(
          "bg-white border rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap",
          remaining < 120 ? "border-red-300" : "border-stone-200"
        )}
      >
        <div className="min-w-0">
          <div className="font-semibold text-stone-900 truncate">{session.name}</div>
          <div className="text-xs text-stone-400">
            {slots.length} questions · +4 / −1 / 0 · numericals included
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "text-2xl font-black tabular-nums px-4 py-1.5 rounded-lg",
              remaining < 120 ? "bg-red-50 text-red-600" : "bg-stone-100 text-stone-800"
            )}
            aria-live="polite"
          >
            {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
          </div>
          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialogTrigger asChild>
              <Button className="bg-emerald-700 hover:bg-emerald-800">Submit</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Submit test?</AlertDialogTitle>
                <AlertDialogDescription>
                  {answeredCount} answered · {slots.length - answeredCount} unattempted. After
                  submit you tag every mistake — that&apos;s where the marks come back.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep solving</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-emerald-700 hover:bg-emerald-800"
                  onClick={() => void submit()}
                >
                  Submit &amp; analyze
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className="grid lg:grid-cols-4 gap-4">
        {/* main panel */}
        <div className="lg:col-span-3 bg-white border border-stone-200 rounded-xl p-4 min-h-[420px] flex flex-col">
          {session.mode === "pdf" ? (
            <div className="flex-1 flex flex-col">
              <div className="flex items-center justify-between mb-2">
                <Badge variant="outline" className="border-stone-300 text-stone-500">
                  PDF page {pageForQuestion(session, curNo)}
                </Badge>
                <span className="text-xs text-stone-400">
                  {pdfErr ? "PDF render failed — check the file" : "question paper on the right →"}
                </span>
              </div>
              <div className="border border-stone-200 rounded-lg overflow-auto max-h-[420px] bg-stone-100">
                {pdfErr ? (
                  <div className="p-6 text-sm text-red-500">{pdfErr}</div>
                ) : pdfPage ? (
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
                  <div className="p-10 text-center text-sm text-stone-400">Rendering page…</div>
                )}
              </div>
            </div>
          ) : null}

          {session.mode === "pdf" && currentSlot ? (
            <div className="flex-1 flex flex-col mt-3">
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-stone-900">Q{currentSlot.no}</span>
                  <Badge variant="outline" className="text-[10px] border-stone-300 text-stone-500">
                    {pdfKeyIsLetter(session, currentSlot.no) ? "MCQ" : "NUMERICAL"}
                  </Badge>
                  <Badge variant="outline" className="text-[10px] border-stone-300 text-stone-500">
                    {session.pdf_meta?.chapter}
                  </Badge>
                </div>
                <span className="text-xs text-stone-400">
                  time on this Q:{" "}
                  {Math.round(
                    (now - session.q_entered_at) / 1000 +
                      (session.q_times[currentSlot.slot] ?? 0)
                  )}
                  s
                </span>
              </div>
              <p className="text-sm text-stone-500 mb-4">
                Read the question from the paper above, then answer here:
              </p>
              {pdfKeyIsLetter(session, currentSlot.no) ? (
                <div className="flex gap-2">
                  {LETTERS.map((l, i) => (
                    <button
                      key={l}
                      onClick={() => setAnswer(currentSlot.slot, l)}
                      className={cn(
                        "w-14 h-14 rounded-lg border text-lg font-bold transition-colors",
                        selected === l
                          ? "border-emerald-700 bg-emerald-50 text-emerald-800"
                          : "border-stone-200 hover:border-emerald-400 hover:bg-stone-50"
                      )}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="max-w-xs">
                  <p className="text-xs text-stone-400 mb-1.5">Your answer (number):</p>
                  <Input
                    value={typeof selected === "string" || typeof selected === "number" ? String(selected) : ""}
                    onChange={(e) => setAnswer(currentSlot.slot, e.target.value)}
                    inputMode="decimal"
                    placeholder="type the value"
                  />
                  <p className="text-[11px] text-stone-400 mt-2">
                    Numericals carry −1 for wrong entries — leave blank instead of guessing.
                  </p>
                </div>
              )}
            </div>
          ) : curQ ? (
            <div className="flex-1 flex flex-col">
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-stone-900">Q{currentSlot?.no}</span>
                  <Badge variant="outline" className="text-[10px] border-stone-300 text-stone-500">
                    {curQ.type === "numerical" ? "NUMERICAL" : "MCQ"}
                  </Badge>
                  <Badge variant="outline" className="text-[10px] border-stone-300 text-stone-500">
                    {curQ.chapter}
                  </Badge>
                </div>
                <span className="text-xs text-stone-400">
                  time on this Q: {Math.round(((now - session.q_entered_at) / 1000 + (session.q_times[currentSlot.slot] ?? 0)))}s
                </span>
              </div>
              <p className="text-base text-stone-900 mb-5 leading-relaxed">{curQ.question}</p>

              {curQ.type === "MCQ" ? (
                <div className="space-y-2">
                  {curQ.options.map((opt, i) => (
                    <button
                      key={i}
                      onClick={() => setAnswer(currentSlot.slot, i)}
                      className={cn(
                        "w-full text-left px-4 py-3 rounded-lg border text-sm transition-colors flex items-center gap-3",
                        selected === i
                          ? "border-emerald-700 bg-emerald-50 font-medium"
                          : "border-stone-200 hover:border-emerald-400 hover:bg-stone-50"
                      )}
                    >
                      <span
                        className={cn(
                          "w-6 h-6 rounded-full grid place-items-center text-xs font-bold border shrink-0",
                          selected === i
                            ? "bg-emerald-700 text-white border-emerald-700"
                            : "border-stone-300 text-stone-500"
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
                  <p className="text-xs text-stone-400 mb-1.5">Your answer (number):</p>
                  <Input
                    value={typeof selected === "string" || typeof selected === "number" ? String(selected) : ""}
                    onChange={(e) => setAnswer(currentSlot.slot, e.target.value)}
                    inputMode="decimal"
                    placeholder="type the value"
                  />
                  <p className="text-[11px] text-stone-400 mt-2">
                    Exact match within the question&apos;s tolerance. Numericals carry −1 for wrong
                    entries — leave blank instead of guessing.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 grid place-items-center text-stone-400 text-sm">
              Question not found in the bank — it may have been deleted.
            </div>
          )}

          {/* action bar */}
          <div className="flex flex-wrap gap-2 pt-4 mt-4 border-t border-stone-100">
            <Button variant="outline" size="sm" onClick={clearResponse}>
              Clear Response
            </Button>
            <div className="flex-1" />
            <Button
              variant="outline"
              size="sm"
              onClick={markAndNext}
              className="border-purple-300 text-purple-700 hover:bg-purple-50"
            >
              {isMarked ? "Marked ✓ ·" : "Mark for Review &"} Next
            </Button>
            <Button
              size="sm"
              onClick={saveAndNext}
              className="bg-emerald-700 hover:bg-emerald-800"
            >
              Save &amp; Next
            </Button>
          </div>
        </div>

        {/* palette rail */}
        <div className="bg-white border border-stone-200 rounded-xl p-4">
          <div className="flex flex-wrap gap-1.5 mb-3">
            {sections.map((s) => (
              <button
                key={s}
                onClick={() => sectionTabClick(s)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                  activeSection === s
                    ? "bg-stone-900 text-white"
                    : "bg-stone-100 text-stone-500 hover:bg-stone-200"
                )}
              >
                {s} ({slots.filter((x) => x.subject === s).length})
              </button>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1.5 mb-3 max-h-64 overflow-y-auto p-0.5">
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
                    "w-8 h-8 rounded-md text-xs font-semibold border transition-colors relative",
                    answered
                      ? "bg-emerald-600 text-white border-emerald-600"
                      : "bg-white text-stone-600 border-stone-300",
                    marked && "bg-purple-600 text-white border-purple-600",
                    isCurrent && "ring-4 ring-yellow-300 ring-offset-0"
                  )}
                  aria-label={`Question ${s.no}${answered ? ", answered" : ""}${marked ? ", marked" : ""}`}
                >
                  {s.no}
                  {answered && marked ? (
                    <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 border border-white" />
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="text-[11px] text-stone-500 space-y-1.5 border-t border-stone-100 pt-3">
            <div className="flex items-center gap-2">
              <span className="w-4 h-4 rounded bg-emerald-600 inline-block" /> Answered
            </div>
            <div className="flex items-center gap-2">
              <span className="w-4 h-4 rounded bg-purple-600 inline-block" /> Marked for review
            </div>
            <div className="flex items-center gap-2">
              <span className="w-4 h-4 rounded bg-white border border-stone-300 inline-block" /> Not
              answered
            </div>
            <div className="flex items-center gap-2">
              <span className="w-4 h-4 rounded bg-white border-2 border-yellow-300 inline-block" />{" "}
              Current
            </div>
          </div>

          <div className="mt-3 pt-3 border-t border-stone-100 text-xs text-stone-500">
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
                className="w-full mt-3 text-red-500 hover:text-red-600 hover:bg-red-50"
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

function pageForQuestion(s: ActiveSession, no: number): number {
  const meta = s.pdf_meta;
  if (!meta) return 1;
  const pages = Math.max(1, meta.end_page - meta.start_page + 1);
  const perPage = Math.ceil(meta.total_questions / pages);
  return meta.start_page + Math.floor((no - 1) / perPage);
}

function pdfKeyIsLetter(s: ActiveSession, no: number): boolean {
  const ans = s.pdf_meta?.key.find((k) => k.no === no)?.answer;
  return ans !== undefined && /^[A-D]$/.test(ans);
}
