"use client";

// ─── Dashboard: north-star, Today card, Amber queue, all five mock metrics ──
import { useEffect, useMemo, useState } from "react";
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
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { NavController } from "./App";
import { EmptyNote, PageTitle, SectionCard, StatCard } from "./shared";
import { get, kvGet, kvSet, put, useLive } from "@/lib/idb";
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
import { addDays, fmtSecs, todayStr, type DailyLog } from "@/lib/types";

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

/** E2: consecutive days where all four blocks are true — ends today if today is
 *  complete, otherwise yesterday (today still in progress never breaks it). */
function computeStreak(logs: DailyLog[], today: string): number {
  const byDate = new Map(logs.map((l) => [l.date, l]));
  const allDone = (l: DailyLog | undefined) => !!l && Object.values(l.blocks).every(Boolean);
  let cursor = allDone(byDate.get(today)) ? today : addDays(today, -1);
  let streak = 0;
  while (allDone(byDate.get(cursor))) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/** E3b: tooltip for the error-tags bar — raw count + share of tagged wrong. */
function TagPctTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload?: { tag?: string; count?: number; pct?: number } }[];
}) {
  if (!active || !payload || payload.length === 0 || !payload[0]?.payload) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs shadow-sm">
      <div className="font-medium text-stone-800">{d.tag}</div>
      <div className="text-stone-500 tabular-nums">
        {d.count} wrong · {d.pct}% of tagged
      </div>
    </div>
  );
}

export function DashboardView({ nav }: { nav: NavController }) {
  const tests = useLive("tests");
  const responses = useLive("responses");
  const syllabus = useLive("syllabus");
  const dailyLogs = useLive("daily_log");

  const today = todayStr();

  // F3: first-run onboarding (kv "onboarded"; undefined = still reading kv)
  const [onboarded, setOnboarded] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    kvGet<string>("onboarded")
      .then((v) => {
        if (alive) setOnboarded(v === "1");
      })
      .catch(() => {
        if (alive) setOnboarded(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  async function dismissOnboarding() {
    setOnboarded(true);
    try {
      await kvSet("onboarded", "1");
      toast.success("You're set. The loop starts tonight.");
    } catch {
      toast.error("Could not save — it will ask again next load");
    }
  }

  // C3: backup nudge — data exists but no export in the last 7 days
  const [lastExportAt, setLastExportAt] = useState<string | null | undefined>(undefined);
  const [backupDismissed, setBackupDismissed] = useState(false);
  useEffect(() => {
    let alive = true;
    kvGet<string>("last-export-at")
      .then((v) => {
        if (alive) setLastExportAt(typeof v === "string" ? v : null);
      })
      .catch(() => {
        if (alive) setLastExportAt(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  const backupNudge = useMemo<{ label: string } | null>(() => {
    if (lastExportAt === undefined || tests.length === 0) return null;
    if (!lastExportAt) return { label: "never" };
    const t = Date.parse(lastExportAt);
    if (Number.isNaN(t)) return { label: "never" };
    const days = Math.floor((Date.now() - t) / 86400000);
    return days > 7 ? { label: `${days} day${days === 1 ? "" : "s"} ago` } : null;
  }, [lastExportAt, tests.length]);

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
      wrong,
      accuracy: attempted ? Math.round((correct / attempted) * 100) : 0,
      tagCoverage: wrong ? Math.round((tagged / wrong) * 100) : 100,
      timeTotal: responses.reduce((a, r) => a + (r.time_spent || 0), 0),
    };
  }, [responses]);

  // E3b: % of tagged-wrong alongside the raw counts (tooltip only — bars stay raw)
  const tagsWithPct = useMemo(
    () =>
      tags.map((t) => ({
        ...t,
        pct: totals.wrong > 0 ? Math.round((t.count / totals.wrong) * 100) : 0,
      })),
    [tags, totals.wrong]
  );

  // E3a: raw / % toggle for the score timeline (component state only, default raw)
  const [timelineMode, setTimelineMode] = useState<"raw" | "pct">("raw");
  const timelineData = useMemo(
    () =>
      timeline.map((d) => ({
        ...d,
        pct: d.max > 0 ? Math.round((d.score / d.max) * 100) : 0,
      })),
    [timeline]
  );

  // E2: study streak from daily_log
  const streak = useMemo(() => computeStreak(dailyLogs, today), [dailyLogs, today]);

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

      {/* F3: first-run onboarding — 3 terse steps, dismissible */}
      {onboarded === false ? (
        <div className="border border-emerald-200 bg-emerald-50/70 rounded-lg px-4 py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-stone-900 mb-1">First 3 moves</div>
            <ol className="list-decimal ml-4 text-sm text-stone-600 space-y-0.5">
              <li>Load demo questions (Data tab) or your own.</li>
              <li>Take a PDF test — a demo paper ships with the app (/demo-paper.pdf).</li>
              <li>Tag every mistake — that&apos;s where marks come back.</li>
            </ol>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              variant="outline"
              className="h-8 border-emerald-300 text-emerald-800 hover:bg-emerald-100"
              onClick={() => {
                void dismissOnboarding();
                nav.go("data");
              }}
            >
              Open Data tab
            </Button>
            <Button
              size="sm"
              className="h-8 bg-emerald-700 hover:bg-emerald-800"
              onClick={() => void dismissOnboarding()}
            >
              Got it
            </Button>
          </div>
        </div>
      ) : null}

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
        {/* C3: backup nudge — slim amber banner above the Today card */}
        {backupNudge && !backupDismissed ? (
          <div className="lg:col-span-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-amber-800">
              <span className="font-medium">Last backup: {backupNudge.label}</span> — export a JSON
              backup to keep your data safe.
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8 border-amber-300 text-amber-800 hover:bg-amber-100"
                onClick={() => nav.go("data")}
              >
                Export backup
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-amber-700 hover:text-amber-800 hover:bg-amber-100"
                onClick={() => setBackupDismissed(true)}
              >
                Dismiss
              </Button>
            </div>
          </div>
        ) : null}

        {/* Today card */}
        <div className="lg:col-span-1">
          <TodayCard log={dailyLogs.find((d) => d.date === today)} date={today} streak={streak} />
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
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge className="bg-amber-400 hover:bg-amber-400 text-amber-950 border-0">
                        {h.accuracy}%
                      </Badge>
                      {/* D5: one click to a pre-filled test for this chapter */}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2.5 text-[11px]"
                        aria-label={`Create a test for ${h.chapter}`}
                        onClick={() => nav.toTestCreate({ subject: h.subject, chapter: h.chapter })}
                      >
                        Test
                      </Button>
                    </div>
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
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge variant="outline" className="border-red-300 text-red-700">
                        failed {r.tests_failed} tests · {r.wrongs} wrong
                      </Badge>
                      {/* D5: one click to a pre-filled test for this chapter */}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2.5 text-[11px]"
                        aria-label={`Create a test for ${r.chapter}`}
                        onClick={() => nav.toTestCreate({ subject: r.subject, chapter: r.chapter })}
                      >
                        Test
                      </Button>
                    </div>
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
          action={
            <div className="flex gap-1" role="group" aria-label="Timeline units">
              {(["raw", "pct"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setTimelineMode(m)}
                  aria-pressed={timelineMode === m}
                  className={cn(
                    "px-2.5 py-0.5 rounded-full text-[11px] transition-colors",
                    timelineMode === m
                      ? "bg-stone-900 text-white"
                      : "bg-stone-100 text-stone-500 hover:bg-stone-200"
                  )}
                >
                  {m === "raw" ? "raw" : "%"}
                </button>
              ))}
            </div>
          }
        >
          {timeline.length === 0 ? (
            <EmptyNote>Log a test (CBT, PDF or external) and the line appears here.</EmptyNote>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={timelineData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickFormatter={timelineMode === "pct" ? (v: number) => `${v}%` : undefined}
                  />
                  <Tooltip {...chartTooltip} />
                  <Line
                    type="monotone"
                    dataKey={timelineMode === "pct" ? "pct" : "score"}
                    stroke={CH.green}
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: CH.green }}
                    name={timelineMode === "pct" ? "% of max" : "score"}
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

        <SectionCard
          title="Error tags"
          subtitle="C / F / A / R / T / G distribution of wrong answers — hover for share of tagged"
        >
          {totals.wrong === 0 ? (
            <EmptyNote>No wrong answers yet — either perfect or untested.</EmptyNote>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={tagsWithPct} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                  <XAxis dataKey="tag" tick={{ fontSize: 10 }} interval={0} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip content={<TagPctTooltip />} cursor={{ fill: "rgba(0,0,0,0.03)" }} />
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

function TodayCard({
  log,
  date,
  streak,
}: {
  log: DailyLog | undefined;
  date: string;
  streak: number;
}) {
  const [chapters, setChapters] = useState(log?.chapters ?? "");
  const [editing, setEditing] = useState(false);

  // E5: read the FRESHEST row before writing — a block toggle must never
  // clobber a concurrent write or the unsaved "tonight's chapters" text.
  // The daily_log object store is keyed "id" (like every non-kv store), so
  // rows are persisted as { id: date, ...log } — a bare {date,…} row throws
  // DataError on put (pre-existing bug: the old Today card never persisted).
  async function freshRow(): Promise<DailyLog & { id: string }> {
    const row = await get("daily_log", date);
    if (row) return { ...row, id: date };
    return {
      id: date,
      date,
      blocks: { math: false, physics: false, chemistry: false, recall: false },
      chapters: "",
    };
  }

  async function toggle(key: keyof DailyLog["blocks"]) {
    const fresh = await freshRow();
    const next: DailyLog & { id: string } = {
      ...fresh,
      id: date,
      blocks: { ...fresh.blocks, [key]: !fresh.blocks[key] },
      // carry unsaved chapter text along instead of wiping it
      chapters: chapters.trim() ? chapters : fresh.chapters,
    };
    await put("daily_log", next);
  }

  async function saveChapters() {
    const fresh = await freshRow();
    const next: DailyLog & { id: string } = { ...fresh, id: date, chapters, date };
    await put("daily_log", next);
    setEditing(false);
  }

  const done = log ? BLOCKS.filter((b) => log.blocks[b.key]).length : 0;

  return (
    <SectionCard
      title="Today"
      subtitle={date}
      action={
        <div className="flex items-center gap-1.5">
          {/* E2: streak chip — plain text, subtle */}
          {streak >= 1 ? (
            <Badge
              variant="outline"
              className={
                streak >= 3
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                  : "border-stone-300 text-stone-600"
              }
            >
              {streak}-day streak
            </Badge>
          ) : null}
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
        </div>
      }
    >
      <ul className="space-y-2">
        {BLOCKS.map((b) => (
          <li key={b.key}>
            <label className="flex items-center gap-3 rounded-lg border border-stone-200 px-3 py-2.5 cursor-pointer hover:bg-stone-50 transition-colors">
              <Checkbox
                checked={log?.blocks[b.key] ?? false}
                onCheckedChange={() => void toggle(b.key)}
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
                if (e.key === "Enter") void saveChapters();
              }}
              onBlur={() => void saveChapters()}
              autoFocus
            />
            <Button size="sm" onClick={() => void saveChapters()} className="bg-emerald-700 hover:bg-emerald-800">
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
