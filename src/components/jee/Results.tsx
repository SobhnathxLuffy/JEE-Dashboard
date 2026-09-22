"use client";

// ─── Post-test analysis: score, accuracy, per-question review, error tags ───
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { NavController } from "./App";
import { EmptyNote, PageTitle, SectionCard, StatCard } from "./shared";
import { useLive, put, get } from "@/lib/idb";
import { ERROR_TAGS, fmtSecs, type ErrorTag, type ResponseRecord } from "@/lib/types";

const TAG_CLS: Record<ErrorTag, string> = {
  C: "bg-red-100 text-red-700 border-red-200",
  F: "bg-amber-100 text-amber-800 border-amber-300",
  A: "bg-orange-100 text-orange-700 border-orange-200",
  R: "bg-sky-100 text-sky-700 border-sky-200",
  T: "bg-violet-100 text-violet-700 border-violet-200",
  G: "bg-stone-200 text-stone-700 border-stone-300",
};

export function ResultsView({ testId, nav }: { testId: string; nav: NavController }) {
  const tests = useLive("tests");
  const responses = useLive("responses");
  const [filter, setFilter] = useState<"all" | "wrong" | "untagged">("all");

  const test = useMemo(() => tests.find((t) => t.id === testId), [tests, testId]);
  const rows = useMemo(
    () => responses.filter((r) => r.test_id === testId),
    [responses, testId]
  );

  const stats = useMemo(() => {
    const attempted = rows.filter((r) => r.attempted);
    const correct = rows.filter((r) => r.correct);
    const wrong = rows.filter((r) => r.attempted && !r.correct);
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
    };
  }, [rows]);

  const shown = useMemo(() => {
    let out = rows;
    if (filter === "wrong") out = out.filter((r) => r.attempted && !r.correct);
    if (filter === "untagged") out = out.filter((r) => r.attempted && !r.correct && !r.error_tag);
    return out;
  }, [rows, filter]);

  async function tagResponse(r: ResponseRecord, tag: ErrorTag) {
    await put("responses", { ...r, error_tag: tag });
    if (tag === "F") {
      const existing = await get("formula", `${r.test_id}:${r.question_id}`);
      if (!existing) {
        await put("formula", {
          id: `${r.test_id}:${r.question_id}`,
          test_id: r.test_id,
          question_id: r.question_id,
          subject: r.subject,
          chapter: r.chapter,
          snippet: r.question_snippet,
          created_at: Date.now(),
        });
        toast.success("Added to formula sheet (F-tag)");
      }
    } else {
      // if retagged away from F, remove from formula sheet
      const existing = await get("formula", `${r.test_id}:${r.question_id}`);
      if (existing) {
        const { del } = await import("@/lib/idb");
        await del("formula", existing.id);
      }
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

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard
          label="Score"
          value={`${test.score}/${test.max_score}`}
          tone={test.score >= test.max_score * 0.5 ? "good" : "warn"}
        />
        <StatCard label="Accuracy" value={`${stats.accuracy}%`} hint={`${stats.correct}/${stats.attempted}`} />
        <StatCard label="Attempt rate" value={`${stats.attemptRate}%`} hint={`${stats.attempted}/${rows.length}`} />
        <StatCard
          label="Negatives"
          value={`−${stats.wrong}`}
          tone={stats.wrong > 5 ? "bad" : "default"}
          hint={`score would be ${test.score + stats.wrong} with guesses skipped`}
        />
        <StatCard label="Time used" value={fmtSecs(stats.time)} />
      </div>

      {stats.untagged > 0 ? (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800 flex items-center justify-between gap-3 flex-wrap">
          <span>
            <strong>{stats.untagged} wrong answers</strong> still untagged. Tag them now — the
            dashboard&apos;s error-tag chart and formula sheet only work if every mistake is
            classified.
          </span>
          <Button
            size="sm"
            variant="outline"
            className="border-amber-400 text-amber-800 hover:bg-amber-100"
            onClick={() => setFilter("untagged")}
          >
            Show untagged
          </Button>
        </div>
      ) : null}

      <SectionCard
        title="Per-question review"
        subtitle="your answer vs correct, time spent, and the tag that explains the mistake"
        action={
          <div className="flex gap-1.5">
            {(["all", "wrong", "untagged"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "px-2.5 py-1 rounded-full text-xs transition-colors",
                  filter === f
                    ? "bg-stone-900 text-white"
                    : "bg-stone-100 text-stone-500 hover:bg-stone-200"
                )}
              >
                {f}
              </button>
            ))}
          </div>
        }
      >
        {shown.length === 0 ? (
          <EmptyNote>Nothing to show for this filter.</EmptyNote>
        ) : (
          <ul className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
            {shown.map((r, idx) => (
              <li
                key={r.id}
                className={cn(
                  "border rounded-lg p-3",
                  !r.attempted
                    ? "border-stone-100 bg-stone-50"
                    : r.correct
                      ? "border-emerald-100 bg-emerald-50/50"
                      : "border-red-100 bg-red-50/40"
                )}
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-xs font-bold text-stone-500">
                        Q{idx + 1}
                      </span>
                      <Badge variant="outline" className="text-[10px] border-stone-300 text-stone-500">
                        {r.type === "numerical" ? "NUM" : "MCQ"}
                      </Badge>
                      <span className="text-[11px] text-stone-400">{r.chapter}</span>
                      <span className="text-[11px] text-stone-400">{fmtSecs(r.time_spent)}</span>
                      {!r.attempted ? (
                        <Badge variant="outline" className="text-[10px] border-stone-300 text-stone-400">
                          unattempted
                        </Badge>
                      ) : r.correct ? (
                        <Badge className="text-[10px] bg-emerald-600 hover:bg-emerald-600 text-white border-0">
                          +4
                        </Badge>
                      ) : (
                        <Badge className="text-[10px] bg-red-600 hover:bg-red-600 text-white border-0">
                          −1
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-stone-800">{r.question_snippet}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs mt-1.5">
                      <span className={r.correct ? "text-emerald-700" : "text-red-600"}>
                        You:{" "}
                        <strong>
                          {r.attempted
                            ? r.type === "MCQ"
                              ? ["A", "B", "C", "D"][Number(r.selected)] ?? String(r.selected)
                              : String(r.selected)
                            : "—"}
                        </strong>
                      </span>
                      <span className="text-emerald-700">
                        Correct:{" "}
                        <strong>
                          {r.type === "MCQ"
                            ? ["A", "B", "C", "D"][Number(r.correct_answer)] ?? String(r.correct_answer)
                            : String(r.correct_answer)}
                        </strong>
                      </span>
                    </div>
                  </div>

                  {!r.correct && r.attempted ? (
                    <div className="flex flex-col gap-1 items-end shrink-0">
                      <span className="text-[10px] uppercase text-stone-400 font-medium">tag it</span>
                      <div className="flex gap-1">
                        {ERROR_TAGS.map((t) => (
                          <button
                            key={t.code}
                            title={t.hint}
                            onClick={() => void tagResponse(r, t.code)}
                            className={cn(
                              "w-7 h-7 rounded-md border text-xs font-bold transition-colors",
                              r.error_tag === t.code
                                ? TAG_CLS[t.code] + " ring-2 ring-offset-1 ring-stone-300"
                                : "bg-white border-stone-200 text-stone-400 hover:text-stone-700 hover:border-stone-400"
                            )}
                          >
                            {t.code}
                          </button>
                        ))}
                      </div>
                      {r.error_tag ? (
                        <span className="text-[10px] text-stone-400">
                          {ERROR_TAGS.find((t) => t.code === r.error_tag)?.label}
                          {r.error_tag === "F" ? " → formula sheet ✓" : ""}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
