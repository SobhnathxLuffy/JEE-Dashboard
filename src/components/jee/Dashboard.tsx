"use client";

// ─── Dashboard: north-star, Today card, Amber queue, all five mock metrics ──
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { NavController } from "./App";
import { EmptyNote, PageTitle, SectionCard, StatCard } from "./shared";
import { useLive, put } from "@/lib/idb";
import {
  amberQueue,
  computeChapterHealth,
  errorTagCounts,
  negativeMarksByTest,
  northStar,
  repeatedFailureChapters,
  revisionDueRows,
  scoreTimeline,
  subjectAccuracy,
  timeBySubject,
} from "@/lib/analytics";
import { fmtSecs, todayStr, type DailyLog } from "@/lib/types";

const CH = {
  green: "#047857",
  amber: "#d97706",
  red: "#dc2626",
  stone: "#78716c",
  blueGray: "#475569",
};

const chartTooltip = {
  contentStyle: {
    fontSize: 12,
    borderRadius: 8,
    border: "1px solid #e7e5e4",
    background: "#fff",
  },
};

export function DashboardView({ nav }: { nav: NavController }) {
  const tests = useLive("tests");
  const responses = useLive("responses");
  const syllabus = useLive("syllabus");
  const dailyLogs = useLive("daily_log");

  const today = todayStr();

  const star = useMemo(() => northStar(tests, responses), [tests, responses]);
  const timeline = useMemo(() => scoreTimeline(tests), [tests]);
  const subjAcc = useMemo(() => subjectAccuracy(responses), [responses]);
  const tags = useMemo(() => errorTagCounts(responses), [responses]);
  const negs = useMemo(() => negativeMarksByTest(tests, responses), [tests, responses]);
  const timeSubj = useMemo(() => timeBySubject(responses), [responses]);

  const healthList = useMemo(
    () => [...computeChapterHealth(responses, tests).values()],
    [responses, tests]
  );
  const ambers = useMemo(() => amberQueue(healthList), [healthList]);
  const repeatFails = useMemo(() => repeatedFailureChapters(responses), [responses]);
  const due = useMemo(() => revisionDueRows(syllabus), [syllabus]);

  const totals = useMemo(() => {
    const attempted = responses.filter((r) => r.attempted).length;
    const correct = responses.filter((r) => r.correct).length;
    const tagged = responses.filter((r) => !r.correct && r.error_tag).length;
    const wrong = responses.filter((r) => r.attempted && !r.correct).length;
    return {
      attempted,
      correct,
      accuracy: attempted ? Math.round((correct / attempted) * 100) : 0,
      tagCoverage: wrong ? Math.round((tagged / wrong) * 100) : 100,
      timeTotal: responses.reduce((a, r) => a + (r.time_spent || 0), 0),
    };
  }, [responses]);

  const sortedTests = useMemo(
    () => [...tests].sort((a, b) => b.created_at - a.created_at),
    [tests]
  );

  return (
    <div className="space-y-6">
      <PageTitle
        title="Dashboard"
        subtitle="Questions correctly solved under time — everything else serves this number."
        right={
          <Button
            size="sm"
            onClick={() => nav.go("test")}
            className="bg-emerald-700 hover:bg-emerald-800"
          >
            + New CBT
          </Button>
        }
      />

      {/* headline stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Correct under time" value={star} tone="accent" hint="north-star metric" />
        <StatCard
          label="Accuracy (all tests)"
          value={`${totals.accuracy}%`}
          hint={`${totals.correct}/${totals.attempted} attempted questions`}
        />
        <StatCard
          label="Error tagging"
          value={`${totals.tagCoverage}%`}
          tone={totals.tagCoverage < 80 ? "warn" : "good"}
          hint="share of wrong answers tagged C/F/A/R/T/G"
        />
        <StatCard
          label="Time on record"
          value={fmtSecs(totals.timeTotal)}
          hint="across all in-app tests"
        />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Today card */}
        <div className="lg:col-span-1">
          <TodayCard log={dailyLogs.find((d) => d.date === today)} date={today} />
        </div>

        {/* Amber queue + repeated failures */}
        <div className="lg:col-span-2 grid md:grid-cols-2 gap-6">
          <SectionCard
            title="Amber-first repair queue"
            subtitle="40–70% accuracy chapters, most recent first — 50%→80% beats resurrecting deep red"
          >
            {ambers.length === 0 ? (
              <EmptyNote>
                No Amber chapters yet. Take a chapter test — the queue builds itself from your
                errors.
              </EmptyNote>
            ) : (
              <ul className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {ambers.slice(0, 12).map((h) => (
                  <li
                    key={`${h.subject}:${h.chapter}`}
                    className="flex items-center justify-between gap-2 text-sm bg-amber-50 border border-amber-200 rounded-lg px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-stone-800 truncate">{h.chapter}</div>
                      <div className="text-xs text-stone-500">
                        {h.subject} · {h.correct}/{h.attempted} correct
                      </div>
                    </div>
                    <Badge className="bg-amber-400 hover:bg-amber-400 text-amber-950 border-0 shrink-0">
                      {h.accuracy}%
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard
            title="Chapters producing repeated failure"
            subtitle="flagged when errors appear across ≥2 different tests"
          >
            {repeatFails.length === 0 ? (
              <EmptyNote>No chapter has failed across 2+ tests yet.</EmptyNote>
            ) : (
              <ul className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {repeatFails.slice(0, 12).map((r) => (
                  <li
                    key={`${r.subject}:${r.chapter}`}
                    className="flex items-center justify-between gap-2 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-stone-800 truncate">{r.chapter}</div>
                      <div className="text-xs text-stone-500">{r.subject}</div>
                    </div>
                    <Badge variant="outline" className="border-red-300 text-red-700 shrink-0">
                      failed {r.tests_failed} tests · {r.wrongs} wrong
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>

      {/* Revision due strip */}
      <SectionCard
        title="Revision due"
        subtitle="schedule: same night → next day → 3–4 days → 1 week"
        action={
          <Button size="sm" variant="outline" onClick={() => nav.go("syllabus")}>
            Open tracker
          </Button>
        }
      >
        {due.length === 0 ? (
          <EmptyNote>Nothing due. Mark revisions in the syllabus tracker to start the loop.</EmptyNote>
        ) : (
          <div className="flex flex-wrap gap-2">
            {due.slice(0, 24).map((s) => (
              <Badge
                key={s.id}
                variant="outline"
                className="border-emerald-300 bg-emerald-50 text-emerald-800 text-xs"
              >
                {s.chapter} · due {s.next_revision === today ? "tonight" : s.next_revision}
              </Badge>
            ))}
            {due.length > 24 ? (
              <span className="text-xs text-stone-400 self-center">+{due.length - 24} more</span>
            ) : null}
          </div>
        )}
      </SectionCard>

      {/* charts grid */}
      <div className="grid md:grid-cols-2 gap-6">
        <SectionCard
          title="Score timeline"
          subtitle="every test — in-app, PDF and external — on one line"
          className="md:col-span-2"
        >
          {timeline.length === 0 ? (
            <EmptyNote>Log a test (CBT, PDF or external) and the line appears here.</EmptyNote>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={timeline} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip {...chartTooltip} />
                  <Line
                    type="monotone"
                    dataKey="score"
                    stroke={CH.green}
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: CH.green }}
                    name="score"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Accuracy by subject" subtitle="in-app attempts only">
          {totals.attempted === 0 ? (
            <EmptyNote>No attempts recorded yet.</EmptyNote>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={subjAcc} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                  <XAxis dataKey="subject" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                  <Tooltip {...chartTooltip} />
                  <ReferenceLine y={70} stroke={CH.green} strokeDasharray="4 4" />
                  <Bar dataKey="accuracy" name="accuracy %" radius={[4, 4, 0, 0]}>
                    {subjAcc.map((s) => (
                      <Cell
                        key={s.subject}
                        fill={s.accuracy >= 70 ? CH.green : s.accuracy >= 40 ? CH.amber : CH.red}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Error tags" subtitle="C / F / A / R / T / G distribution of wrong answers">
          {totals.wrong === 0 ? (
            <EmptyNote>No wrong answers yet — either perfect or untested.</EmptyNote>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={tags} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                  <XAxis dataKey="tag" tick={{ fontSize: 10 }} interval={0} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip {...chartTooltip} />
                  <Bar dataKey="count" name="wrong answers" fill={CH.blueGray} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Marks lost to negatives"
          subtitle="actual score vs what it would be with guesses skipped"
        >
          {negs.length === 0 ? (
            <EmptyNote>No tests yet.</EmptyNote>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={negs} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                  <XAxis dataKey="label" tick={{ fontSize: 9 }} interval={0} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip {...chartTooltip} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="actual" name="actual" fill={CH.green} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="ifSkipped" name="if guesses skipped" fill={CH.stone} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Time by subject" subtitle="total seconds spent per subject (in-app tests)">
          {timeSubj.length === 0 ? (
            <EmptyNote>No time recorded yet.</EmptyNote>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={timeSubj} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                  <XAxis dataKey="subject" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip {...chartTooltip} />
                  <Bar dataKey="minutes" name="minutes" fill={CH.amber} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>
      </div>

      {/* recent tests */}
      <SectionCard
        title="Recent tests"
        subtitle="every test gets tagged within 24 hours — or it didn't happen"
        action={
          <Button size="sm" variant="outline" onClick={() => nav.go("external")}>
            + Log external
          </Button>
        }
      >
        {sortedTests.length === 0 ? (
          <EmptyNote>No tests logged yet. Start with a 10-question chapter test.</EmptyNote>
        ) : (
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-stone-400 uppercase">
                <tr>
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Test</th>
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3 text-right">Score</th>
                  <th className="py-2 pr-3 text-right">P</th>
                  <th className="py-2 pr-3 text-right">C</th>
                  <th className="py-2 pr-3 text-right">M</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {sortedTests.map((t) => (
                  <tr key={t.id} className="border-t border-stone-100">
                    <td className="py-2 pr-3 text-stone-500 whitespace-nowrap">{t.date}</td>
                    <td className="py-2 pr-3 font-medium text-stone-800 max-w-52 truncate">
                      {t.name}
                    </td>
                    <td className="py-2 pr-3">
                      <Badge variant="outline" className="text-[10px] border-stone-300 text-stone-500">
                        {t.type}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3 text-right font-semibold tabular-nums">
                      {t.score}
                      <span className="text-stone-400 font-normal">/{t.max_score}</span>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-stone-600">
                      {t.subject_scores.Physics ?? "—"}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-stone-600">
                      {t.subject_scores.Chemistry ?? "—"}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-stone-600">
                      {t.subject_scores.Mathematics ?? "—"}
                    </td>
                    <td className="py-2 text-right">
                      {t.type !== "external" ? (
                        <Button size="sm" variant="ghost" onClick={() => nav.openResults(t.id)}>
                          Review
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ─── Today card ──────────────────────────────────────────────────────────────
const BLOCKS: { key: keyof DailyLog["blocks"]; label: string }[] = [
  { key: "math", label: "Math — 2h" },
  { key: "physics", label: "Physics — 1h 45m" },
  { key: "chemistry", label: "Chemistry — 1h 45m" },
  { key: "recall", label: "Recall + errors — 30m" },
];

function TodayCard({ log, date }: { log: DailyLog | undefined; date: string }) {
  const [chapters, setChapters] = useState(log?.chapters ?? "");
  const [editing, setEditing] = useState(false);

  async function toggle(key: keyof DailyLog["blocks"]) {
    const base: DailyLog =
      log ?? { date, blocks: { math: false, physics: false, chemistry: false, recall: false }, chapters: "" };
    const next: DailyLog = {
      ...base,
      blocks: { ...base.blocks, [key]: !base.blocks[key] },
      chapters: chapters || base.chapters,
    };
    await put("daily_log", next);
  }

  async function saveChapters() {
    const base: DailyLog =
      log ?? { date, blocks: { math: false, physics: false, chemistry: false, recall: false }, chapters: "" };
    await put("daily_log", { ...base, chapters, date });
    setEditing(false);
  }

  const done = log ? BLOCKS.filter((b) => log.blocks[b.key]).length : 0;

  return (
    <SectionCard
      title="Today"
      subtitle={date}
      action={
        <Badge
          variant="outline"
          className={
            done === 4
              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
              : "border-stone-300 text-stone-500"
          }
        >
          {done}/4 blocks
        </Badge>
      }
    >
      <ul className="space-y-2">
        {BLOCKS.map((b) => (
          <li key={b.key}>
            <label className="flex items-center gap-3 rounded-lg border border-stone-200 px-3 py-2.5 cursor-pointer hover:bg-stone-50 transition-colors">
              <Checkbox
                checked={log?.blocks[b.key] ?? false}
                onCheckedChange={() => toggle(b.key)}
                aria-label={b.label}
              />
              <span
                className={
                  log?.blocks[b.key]
                    ? "text-sm text-stone-400 line-through"
                    : "text-sm text-stone-800"
                }
              >
                {b.label}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-3">
        <div className="text-[11px] uppercase tracking-wide text-stone-400 font-medium mb-1">
          Tonight&apos;s chapters
        </div>
        {editing ? (
          <div className="flex gap-2">
            <Input
              value={chapters}
              onChange={(e) => setChapters(e.target.value)}
              placeholder="e.g. Electrostatics PYQs, GOC notes, 1-3-7 rev of Kinematics"
              onKeyDown={(e) => {
                if (e.key === "Enter") saveChapters();
              }}
              autoFocus
            />
            <Button size="sm" onClick={saveChapters} className="bg-emerald-700 hover:bg-emerald-800">
              Save
            </Button>
          </div>
        ) : (
          <button
            className="w-full text-left text-sm rounded-lg border border-dashed border-stone-300 px-3 py-2.5 text-stone-600 hover:bg-stone-50 transition-colors"
            onClick={() => {
              setChapters(log?.chapters ?? "");
              setEditing(true);
            }}
          >
            {log?.chapters ? log.chapters : "Click to write what you will physically do tonight…"}
          </button>
        )}
      </div>
      <p className="text-[11px] text-stone-400 mt-3">
        A plan fails if Tuesday night arrives and you don&apos;t know what to physically do. This
        card answers that in one glance.
      </p>
    </SectionCard>
  );
}
