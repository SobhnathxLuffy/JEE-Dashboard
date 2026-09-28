"use client";

// ─── Performance: subject → chapter drill-down, trends, every test, mistakes ─
import { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { NavController } from "./App";
import { AnswerBits, EmptyNote, PageTitle, SectionCard, StatCard } from "./shared";
import { useLive } from "@/lib/idb";
import { tagOf } from "@/lib/analytics";
import {
  SUBJECTS,
  SUBJECT_SHORT,
  fmtSecs,
  type ErrorTag,
  type ResponseRecord,
  type Subject,
  type TestRecord,
} from "@/lib/types";

const CH = {
  green: "#047857",
  amber: "#d97706",
  red: "#dc2626",
  stone: "#78716c",
};

const chartTooltip = {
  contentStyle: {
    fontSize: 12,
    borderRadius: 8,
    border: "1px solid #e7e5e4",
    background: "#fff",
  },
};

const TAG_CLS: Record<ErrorTag, string> = {
  C: "bg-red-100 text-red-700 border-red-200",
  F: "bg-amber-100 text-amber-800 border-amber-300",
  A: "bg-orange-100 text-orange-700 border-orange-200",
  R: "bg-sky-100 text-sky-700 border-sky-200",
  T: "bg-violet-100 text-violet-700 border-violet-200",
  G: "bg-stone-200 text-stone-700 border-stone-300",
};

type SubjectFilter = "all" | Subject;

export function PerformanceView({ nav }: { nav: NavController }) {
  const responses = useLive("responses");
  const tests = useLive("tests");
  const syllabus = useLive("syllabus");

  const [subject, setSubject] = useState<SubjectFilter>("all");
  const [chapter, setChapter] = useState<string>("all");

  // chapters offered: syllabus chapters of the subject ∪ chapters seen in responses
  const chapterOptions = useMemo(() => {
    if (subject === "all") return [];
    const set = new Set<string>(
      syllabus.filter((s) => s.subject === subject).map((s) => s.chapter)
    );
    for (const r of responses) {
      if (r.subject === subject) set.add(r.chapter);
    }
    return [...set].sort();
  }, [subject, syllabus, responses]);

  const scoped = useMemo(
    () =>
      responses.filter(
        (r) =>
          (subject === "all" || r.subject === subject) &&
          (chapter === "all" || r.chapter === chapter)
      ),
    [responses, subject, chapter]
  );

  const stats = useMemo(() => {
    const attempted = scoped.filter((r) => r.attempted);
    const correct = attempted.filter((r) => r.correct === true);
    const wrong = attempted.filter((r) => r.correct === false);
    const time = attempted.reduce((a, r) => a + (r.time_spent || 0), 0);
    const testCount = new Set(scoped.map((r) => r.test_id)).size;
    return {
      attempted: attempted.length,
      correct: correct.length,
      wrong: wrong.length,
      accuracy: attempted.length ? Math.round((correct.length / attempted.length) * 100) : 0,
      avgTime: attempted.length ? time / attempted.length : 0,
      tests: testCount,
      untagged: wrong.filter((r) => !r.error_tag).length,
    };
  }, [scoped]);

  // per-test trend of the selection: attempts bar + accuracy line
  const trend = useMemo(() => {
    const byTest = new Map<string, ResponseRecord[]>();
    for (const r of scoped) {
      const arr = byTest.get(r.test_id);
      if (arr) arr.push(r);
      else byTest.set(r.test_id, [r]);
    }
    const testById = new Map(tests.map((t) => [t.id, t] as const));
    const out: { label: string; attempted: number; accuracy: number }[] = [];
    for (const [testId, rows] of byTest) {
      const t = testById.get(testId);
      if (!t) continue;
      const attempted = rows.filter((r) => r.attempted);
      const correct = attempted.filter((r) => r.correct === true).length;
      out.push({
        label: `${t.date.slice(5)} ${t.name.slice(0, 14)}`,
        attempted: attempted.length,
        accuracy: attempted.length ? Math.round((correct / attempted.length) * 100) : 0,
      });
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }, [scoped, tests]);

  // score timeline — every scored test. Whole-paper %, or the subject's raw marks
  // when a subject filter is on (test max is whole-paper, so % would lie).
  const scoreSeries = useMemo(() => {
    const relevant = tests
      .filter((t): t is TestRecord & { score: number } => t.score !== null)
      .filter((t) => {
        if (chapter !== "all") return scoped.some((r) => r.test_id === t.id);
        return true;
      })
      .sort((a, b) => a.created_at - b.created_at);
    return relevant.map((t) => {
      const subjectMarks =
        subject !== "all" ? (t.subject_scores[subject] ?? 0) : null;
      return {
        label: `${t.date.slice(5)} ${t.source.slice(0, 10)}`,
        pct: Math.round((t.score / Math.max(1, t.max_score)) * 100),
        raw: t.score,
        max: t.max_score,
        subjectMarks,
      };
    });
  }, [tests, subject, chapter, scoped]);

  // chapter breakdown within the subject (only when no single chapter is chosen)
  const chapterBars = useMemo(() => {
    if (subject === "all" || chapter !== "all") return [];
    const byChapter = new Map<string, { attempted: number; correct: number }>();
    for (const r of responses) {
      if (r.subject !== subject || !r.attempted) continue;
      const e = byChapter.get(r.chapter) ?? { attempted: 0, correct: 0 };
      e.attempted += 1;
      if (r.correct === true) e.correct += 1;
      byChapter.set(r.chapter, e);
    }
    return [...byChapter.entries()]
      .map(([ch, e]) => ({
        chapter: ch.length > 18 ? `${ch.slice(0, 17)}…` : ch,
        full: ch,
        accuracy: Math.round((e.correct / e.attempted) * 100),
        attempted: e.attempted,
      }))
      .sort((a, b) => a.accuracy - b.accuracy)
      .slice(0, 12);
  }, [responses, subject, chapter]);

  // every test score table — unfiltered: all tests; filtered: tests touching the scope
  const testRows = useMemo(() => {
    const touched = new Set(scoped.map((r) => r.test_id));
    const inScope = (t: TestRecord) =>
      subject === "all" && chapter === "all" ? true : touched.has(t.id);
    return [...tests]
      .filter(inScope)
      .sort((a, b) => b.created_at - a.created_at);
  }, [tests, scoped, subject, chapter]);

  const perTestScope = useMemo(() => {
    const m = new Map<string, { attempted: number; correct: number }>();
    for (const r of scoped) {
      const e = m.get(r.test_id) ?? { attempted: 0, correct: 0 };
      if (r.attempted) {
        e.attempted += 1;
        if (r.correct === true) e.correct += 1;
      }
      m.set(r.test_id, e);
    }
    return m;
  }, [scoped]);

  // what went wrong — newest first, capped
  const wrongRows = useMemo(
    () =>
      [...scoped]
        .filter((r) => r.attempted && r.correct === false)
        .sort((a, b) => (b.q_no ?? 0) - (a.q_no ?? 0))
        .slice(0, 60),
    [scoped]
  );

  const testById = useMemo(() => new Map(tests.map((t) => [t.id, t] as const)), [tests]);
  const toleranceOf = (r: ResponseRecord) =>
    testById.get(r.test_id)?.pdf_meta?.tolerance ?? 0;

  return (
    <div className="space-y-6">
      <PageTitle
        title="Performance"
        subtitle="Drill from a subject down to a chapter: trends, every test score, and every mistake with the correct answer."
      />

      {/* filters */}
      <div className="bg-white border border-stone-200 rounded-lg p-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1.5 min-w-[180px]">
          <label className="text-xs font-medium text-stone-500">Subject</label>
          <Select
            value={subject}
            onValueChange={(v) => {
              setSubject(v as SubjectFilter);
              setChapter("all");
            }}
          >
            <SelectTrigger aria-label="Performance subject">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All subjects</SelectItem>
              {SUBJECTS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 min-w-[220px]">
          <label className="text-xs font-medium text-stone-500">Chapter</label>
          <Select
            value={chapter}
            onValueChange={setChapter}
            disabled={subject === "all"}
          >
            <SelectTrigger aria-label="Performance chapter">
              <SelectValue placeholder={subject === "all" ? "pick a subject first" : "All chapters"} />
            </SelectTrigger>
            <SelectContent className="max-h-64">
              <SelectItem value="all">All chapters</SelectItem>
              {chapterOptions.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {(subject !== "all" || chapter !== "all") && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSubject("all");
              setChapter("all");
            }}
          >
            Reset
          </Button>
        )}
        <p className="text-[11px] text-stone-400 ml-auto max-w-[260px]">
          {subject === "all"
            ? "Pick a subject to unlock the chapter dropdown."
            : `${scoped.length} answered questions in scope.`}
        </p>
      </div>

      {/* stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Accuracy" value={`${stats.accuracy}%`} hint={`${stats.correct}/${stats.attempted} attempted`} tone={stats.accuracy >= 70 ? "good" : stats.accuracy >= 40 ? "warn" : "bad"} />
        <StatCard label="Wrong" value={stats.wrong} hint={stats.untagged > 0 ? `${stats.untagged} untagged` : "all tagged"} tone={stats.wrong > 0 ? "bad" : "default"} />
        <StatCard label="Avg time / Q" value={fmtSecs(Math.round(stats.avgTime))} />
        <StatCard label="Tests in scope" value={stats.tests} hint="tests touching this selection" />
        <StatCard label="Questions seen" value={scoped.length} />
      </div>

      {/* charts */}
      <div className="grid lg:grid-cols-2 gap-6">
        <SectionCard
          title="Accuracy & volume per test"
          subtitle={chapter === "all" ? "the selection, one bar per test" : `“${chapter}” across tests`}
        >
          {trend.length === 0 ? (
            <EmptyNote>No attempts in this selection yet.</EmptyNote>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trend} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} angle={-25} textAnchor="end" height={48} />
                  <YAxis yAxisId="l" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis yAxisId="r" orientation="right" domain={[0, 100]} tick={{ fontSize: 11 }} />
                  <Tooltip {...chartTooltip} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="l" dataKey="attempted" name="attempted" fill={CH.stone} radius={[3, 3, 0, 0]} />
                  <Line yAxisId="r" dataKey="accuracy" name="accuracy %" stroke={CH.green} strokeWidth={2} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Score timeline — every test"
          subtitle={
            subject === "all"
              ? "% of max score per test"
              : `${SUBJECT_SHORT[subject as Subject]} marks per test (raw, since max is whole-paper)`
          }
        >
          {scoreSeries.length === 0 ? (
            <EmptyNote>No scored tests yet.</EmptyNote>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={scoreSeries} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} angle={-25} textAnchor="end" height={48} />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    domain={subject === "all" ? [0, 100] : ["auto", "auto"]}
                  />
                  <Tooltip
                    {...chartTooltip}
                    formatter={(value, name, item) => {
                      const p = item?.payload as { raw?: number; max?: number; subjectMarks?: number | null };
                      if (name === "% of max") return [`${p?.raw}/${p?.max} (${value}%)`, name];
                      if (name === "subject marks") return [`${value}`, `${subject} marks`];
                      return [value, name];
                    }}
                  />
                  {subject === "all" ? (
                    <Line dataKey="pct" name="% of max" stroke={CH.green} strokeWidth={2} dot={{ r: 3 }} />
                  ) : (
                    <Line dataKey="subjectMarks" name="subject marks" stroke={CH.green} strokeWidth={2} dot={{ r: 3 }} />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        {subject !== "all" && chapter === "all" ? (
          <SectionCard
            title={`Chapter accuracy — ${subject}`}
            subtitle="weakest at the left · green ≥ 70%, amber ≥ 40%"
            className="lg:col-span-2"
          >
            {chapterBars.length === 0 ? (
              <EmptyNote>No attempted questions in this subject yet.</EmptyNote>
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chapterBars} margin={{ top: 8, right: 8, left: -18, bottom: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                    <XAxis dataKey="chapter" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                    <Tooltip
                      {...chartTooltip}
                      formatter={(value, _name, item) => {
                        const p = item?.payload as { full?: string; attempted?: number };
                        return [`${value}% of ${p?.attempted} attempted`, p?.full ?? ""];
                      }}
                    />
                    <ReferenceLine y={70} stroke={CH.green} strokeDasharray="4 4" />
                    <ReferenceLine y={40} stroke={CH.red} strokeDasharray="4 4" />
                    <Bar dataKey="accuracy" radius={[3, 3, 0, 0]}>
                      {chapterBars.map((b) => (
                        <Cell
                          key={b.full}
                          fill={b.accuracy >= 70 ? CH.green : b.accuracy >= 40 ? CH.amber : CH.red}
                        />
                      ))}
                    </Bar>
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </SectionCard>
        ) : null}
      </div>

      {/* every test score */}
      <SectionCard
        title="Every test score"
        subtitle={
          subject === "all" && chapter === "all"
            ? "all tests ever — click a row for the full review"
            : "tests touching this selection · in-scope accuracy"
        }
      >
        {testRows.length === 0 ? (
          <EmptyNote>No tests match this selection yet.</EmptyNote>
        ) : (
          <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="text-left text-[11px] uppercase tracking-wide text-stone-400">
                <tr className="border-b border-stone-200">
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 pr-3 font-medium">Test</th>
                  <th className="py-2 pr-3 font-medium">Type</th>
                  <th className="py-2 pr-3 font-medium">Score</th>
                  <th className="py-2 pr-3 font-medium">In scope</th>
                  <th className="py-2 font-medium">Acc.</th>
                </tr>
              </thead>
              <tbody>
                {testRows.map((t) => {
                  const s = perTestScope.get(t.id);
                  const acc = s && s.attempted > 0 ? Math.round((s.correct / s.attempted) * 100) : null;
                  return (
                    <tr
                      key={t.id}
                      onClick={() => nav.openResults(t.id)}
                      className="border-b border-stone-100 hover:bg-emerald-50/50 cursor-pointer transition-colors"
                    >
                      <td className="py-2 pr-3 text-stone-500 whitespace-nowrap">{t.date}</td>
                      <td className="py-2 pr-3 max-w-[260px]">
                        <span className="block truncate font-medium text-stone-800" title={t.name}>
                          {t.name}
                        </span>
                        <span className="text-[11px] text-stone-400">{t.source}</span>
                      </td>
                      <td className="py-2 pr-3">
                        <Badge variant="outline" className="text-[10px] border-stone-300 text-stone-500">
                          {t.type}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3 tabular-nums whitespace-nowrap">
                        {t.score === null ? (
                          <span className="text-amber-600 text-xs font-medium">pending</span>
                        ) : subject !== "all" ? (
                          <span>
                            <strong>{t.subject_scores[subject] ?? 0}</strong>
                            <span className="text-[11px] text-stone-400 ml-1">subj. marks</span>
                          </span>
                        ) : (
                          <span>
                            <strong>{t.score}</strong>
                            <span className="text-stone-400">/{t.max_score}</span>
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3 tabular-nums text-stone-500">
                        {s ? `${s.correct}/${s.attempted}` : "—"}
                      </td>
                      <td className="py-2">
                        {acc === null ? (
                          <span className="text-stone-300">—</span>
                        ) : (
                          <span
                            className={cn(
                              "font-semibold tabular-nums",
                              acc >= 70 ? "text-emerald-700" : acc >= 40 ? "text-amber-600" : "text-red-600"
                            )}
                          >
                            {acc}%
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* what went wrong */}
      <SectionCard
        title="What went wrong — and what was correct"
        subtitle="every wrong answer in this selection, newest first, with your answer vs the key"
        action={
          wrongRows.length === 60 ? (
            <Badge variant="outline" className="border-amber-300 text-amber-700 text-[10px]">
              showing first 60
            </Badge>
          ) : undefined
        }
      >
        {wrongRows.length === 0 ? (
          <EmptyNote>
            No wrong answers in this selection. Either you&apos;re clean here — or you haven&apos;t
            tested this chapter yet.
          </EmptyNote>
        ) : (
          <ul className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
            {wrongRows.map((r) => {
              const t = testById.get(r.test_id);
              return (
                <li key={r.id} className="border border-red-100 bg-red-50/40 rounded-lg p-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-xs font-bold text-stone-500">Q{r.q_no ?? "?"}</span>
                        <Badge variant="outline" className="text-[10px] border-stone-300 text-stone-500">
                          {r.type === "numerical" ? "NUM" : "MCQ"}
                        </Badge>
                        <span className="text-[11px] text-stone-400">{r.chapter}</span>
                        {r.error_tag ? (
                          <Badge variant="outline" className={cn("text-[10px]", TAG_CLS[r.error_tag])}>
                            {tagOf(r.error_tag)}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700">
                            untagged
                          </Badge>
                        )}
                        {r.note ? (
                          <span className="text-[11px] text-stone-500 italic truncate max-w-[240px]" title={r.note}>
                            “{r.note}”
                          </span>
                        ) : null}
                      </div>
                      <p className="text-sm text-stone-800">{r.question_snippet}</p>
                      <div className="mt-1.5">
                        <AnswerBits
                          selected={r.selected}
                          correctAnswer={r.correct_answer}
                          type={r.type}
                          options={r.options}
                          isPdf={r.question_id.startsWith("pdf:")}
                          tolerance={toleranceOf(r)}
                          attempted={r.attempted}
                        />
                      </div>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1">
                      <span className="text-[11px] text-stone-400 max-w-[160px] truncate" title={t?.name}>
                        {t?.name ?? "deleted test"}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs"
                        onClick={() => t && nav.openResults(t.id)}
                        disabled={!t}
                      >
                        Open review
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
