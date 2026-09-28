"use client";

// ─── ExplainDialog — one AI doubt-buster per question, streamed and cached ───
// Opened from Results / Performance review rows. First view streams from the
// model; every later view is free (cached in IndexedDB ai_cache). The prompt
// knows the user's own answer, so it explains why THAT option was wrong —
// not just what the correct answer is.
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { AnswerBits } from "../shared";
import {
  AIConfigError,
  aiCacheDel,
  aiCacheGet,
  aiCacheSet,
  callAI,
} from "@/lib/ai";
import type { ResponseRecord } from "@/lib/types";

export interface ExplainTarget {
  id: string; // response id — the cache key
  qNo: number | string;
  subject: string;
  chapter: string;
  snippet: string;
  options?: string[];
  selected: number | string | null;
  correct_answer: number | string;
  type: "MCQ" | "numerical";
  attempted: boolean;
  isPdf: boolean;
}

const LETTERS = ["A", "B", "C", "D"];

function buildPrompt(t: ExplainTarget): string {
  const opts =
    t.type === "MCQ" && Array.isArray(t.options) && t.options.length > 1
      ? `\nOptions:\n${t.options.map((o, i) => `${LETTERS[i] ?? i + 1}. ${o}`).join("\n")}`
      : "";
  const mine =
    !t.attempted || t.selected === null || t.selected === undefined
      ? "not attempted"
      : t.type === "MCQ" && !t.isPdf && Number.isInteger(Number(t.selected)) && t.options
        ? `${LETTERS[Number(t.selected)]} (${t.options[Number(t.selected)]})`
        : String(t.selected);
  const correct =
    t.type === "MCQ" && !t.isPdf && Number.isInteger(Number(t.correct_answer)) && t.options
      ? `${LETTERS[Number(t.correct_answer)]} (${t.options[Number(t.correct_answer)]})`
      : String(t.correct_answer);

  return [
    `Subject: ${t.subject} · Chapter: ${t.chapter} (JEE Main level)`,
    `Question: ${t.snippet}`,
    opts,
    `Correct answer: ${correct}`,
    `My answer: ${mine}`,
    "",
    "Write, in plain text (no markdown headings, no asterisks):",
    "1. A step-by-step solution, short and clean — each step on its own line.",
    t.attempted && mine !== correct
      ? "2. A short paragraph starting with \"Why my answer is wrong:\" — name the exact misconception or slip that leads from the correct idea to my answer."
      : "",
    "3. A final line starting with \"Remember:\" — the one concept or formula to retain.",
    "Keep it under 320 words. Use plain notation like x^2, CO2, sqrt() — no LaTeX.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function ExplainDialog({
  target,
  onOpenChange,
}: {
  target: ExplainTarget | null;
  onOpenChange: (o: boolean) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cached, setCached] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const open = target !== null;

  // load cache / reset state per target
  useEffect(() => {
    if (!target) return;
    setText(null);
    setError(null);
    setBusy(false);
    let alive = true;
    aiCacheGet<string>(`explain:${target.id}`).then((hit) => {
      if (!alive || !hit) return;
      setText(hit);
      setCached(true);
    });
    return () => {
      alive = false;
      abortRef.current?.abort();
    };
  }, [target]);

  async function generate() {
    if (!target) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setError(null);
    setText("");
    setCached(false);
    try {
      const { text: full } = await callAI({
        feature: "explain",
        system:
          "You are an expert, patient JEE tutor. You explain with crisp step-by-step reasoning in plain text. Never use markdown symbols like ** or #.",
        user: buildPrompt(target),
        temperature: 0.2,
        signal: ac.signal,
        onDelta: (full2) => setText(full2),
      });
      if (!full.trim()) throw new Error("The model returned an empty explanation — try again.");
      setText(full);
      await aiCacheSet("explain", target.id, full);
      setCached(true);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      if (e instanceof AIConfigError) setError(e.message);
      else setError((e as Error).message);
      setText(null);
    } finally {
      setBusy(false);
    }
  }

  async function regenerate() {
    if (!target) return;
    await aiCacheDel(`explain:${target.id}`);
    await generate();
    toast.success("Explanation regenerated");
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <span>AI explanation — Q{target?.qNo}</span>
            {cached && text ? (
              <Badge variant="outline" className="text-[10px] border-border text-muted-foreground font-normal">
                cached · free
              </Badge>
            ) : null}
          </DialogTitle>
          <DialogDescription className="line-clamp-2">
            {target?.subject} · {target?.chapter}
          </DialogDescription>
        </DialogHeader>

        {/* the question + answers, same vocabulary as the review row */}
        {target ? (
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 space-y-1.5">
            <p className="text-sm text-foreground leading-snug">{target.snippet}</p>
            <AnswerBits
              selected={target.selected}
              correctAnswer={target.correct_answer}
              type={target.type}
              options={target.options}
              isPdf={target.isPdf}
              attempted={target.attempted}
              status={null}
            />
          </div>
        ) : null}

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10 px-3 py-2.5 text-sm text-red-700 dark:text-red-300 space-y-2">
            <p>{error}</p>
            <Button size="sm" variant="outline" onClick={() => void generate()}>
              Retry
            </Button>
          </div>
        ) : text === null ? (
          <div className="py-4 text-center space-y-3">
            <p className="text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed">
              One AI call explains this question step by step — including why <em>your</em> answer
              was wrong, when it was. Costs a fraction of a paisa on typical credit rates.
            </p>
            <Button
              onClick={() => void generate()}
              className="bg-emerald-700 hover:bg-emerald-800 dark:bg-emerald-500 dark:hover:bg-emerald-600 dark:text-emerald-950"
            >
              ✦ Explain this question
            </Button>
          </div>
        ) : (
          <div className="relative">
            <div className="rounded-lg border border-border bg-card px-4 py-3 max-h-[46vh] overflow-y-auto text-sm leading-relaxed text-foreground whitespace-pre-wrap">
              {text}
              {busy ? (
                <span className="inline-block w-1.5 h-4 ml-0.5 align-middle bg-primary animate-pulse" aria-hidden="true" />
              ) : null}
            </div>
          </div>
        )}

        {!busy && text ? (
          <div className="flex justify-end">
            <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => void regenerate()}>
              ↻ Regenerate
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Row button helper — builds an ExplainTarget from a ResponseRecord. */
export function explainTargetOf(r: ResponseRecord, qNo: number | string): ExplainTarget {
  return {
    id: r.id,
    qNo,
    subject: r.subject,
    chapter: r.chapter,
    snippet: r.question_snippet,
    options: r.options,
    selected: r.selected,
    correct_answer: r.correct_answer,
    type: r.type,
    attempted: r.attempted,
    isPdf: r.question_id.startsWith("pdf:"),
  };
}
