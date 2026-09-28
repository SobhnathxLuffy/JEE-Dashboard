"use client";

// ─── Dashboard: north-star, Today card, Amber queue, all five mock metrics ──
import { useEffect, useId, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
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
import { ChartNote, ChartTip, CH, EmptyNote, GRID, PageTitle, SectionCard, StatCard, TICK, TICK_MONO } from "./shared";
import { CountUp, Stagger, StaggerItem } from "./motion";
import { TodoCard } from "./TodoCard";
import { CoachCard } from "./ai/CoachCard";
import { del, kvGet, kvSet, put, useLive } from "@/lib/idb";
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
import { fmtSecs, todayStr } from "@/lib/types";

// CH, GRID, TICK, TICK_MONO and the shared ChartTip come from shared.tsx —
// one chart vocabulary across Dashboard and Performance.

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
    <div className="rounded-lg border border-border bg-popover text-popover-foreground px-2.5 py-1.5 text-xs shadow-[0_8px_24px_-12px_rgba(28,25,23,0.25)]">
      <div className="font-medium text-foreground">{d.tag}</div>
      <div className="text-muted-foreground tabular-nums">
        {d.count} wrong · {d.pct}% of tagged
      </div>
    </div>
  );
}

export function DashboardView({ nav }: { nav: NavController }) {
  const tests = useLive("tests");
  const responses = useLive("responses");
  const syllabus = useLive("syllabus");

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
  const gradientId = useId();
  const timelineData = useMemo(
    () =>
      timeline.map((d) => ({
        ...d,
        pct: d.max > 0 ? Math.round((d.score / d.max) * 100) : 0,
      })),
    [timeline]
  );

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
            className="bg-emerald-700 hover:bg-emerald-800 dark:bg-emerald-500 dark:hover:bg-emerald-600 dark:text-emerald-950"
          >
            + New CBT
          </Button>
        }
      />

      {/* F3: first-run onboarding — 3 terse steps, dismissible */}
      {onboarded === false ? (
        <div className="border border-emerald-200 bg-emerald-50/70 dark:border-emerald-500/30 dark:bg-emerald-500/10 rounded-lg px-4 py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground mb-1">First 3 moves</div>
            <ol className="list-decimal ml-4 text-sm text-muted-foreground space-y-0.5">
              <li>Load demo questions (Data tab) or your own.</li>
              <li>Take a PDF test — a demo paper ships with the app (/demo-paper.pdf).</li>
              <li>Tag every mistake — that&apos;s where marks come back.</li>
            </ol>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              variant="outline"
              className="h-8 border-emerald-300 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-500/40 dark:text-emerald-300 dark:hover:bg-emerald-500/10"
              onClick={() => {
                void dismissOnboarding();
                nav.go("data");
              }}
            >
              Open Data tab
            </Button>
            <Button
              size="sm"
              className="h-8 bg-emerald-700 hover:bg-emerald-800 dark:bg-emerald-500 dark:hover:bg-emerald-600 dark:text-emerald-950"
              onClick={() => void dismissOnboarding()}
            >
              Got it
            </Button>
          </div>
        </div>
      ) : null}

      {/* headline stats — stagger in, numbers settle with a count-up */}
      <Stagger className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StaggerItem>
          <StatCard
            label="Correct under time"
            value={<CountUp value={star} />}
            tone="accent"
            hint="north-star metric"
            spark={timelineData.map((d) => d.score)}
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Accuracy (all tests)"
            value={<CountUp value={totals.accuracy} format={(v) => `${Math.round(v)}%`} />}
            hint={`${totals.correct}/${totals.attempted} attempted questions`}
            spark={timelineData.map((d) => d.pct)}
            sparkColor="var(--sem-stone)"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Error tagging"
            value={<CountUp value={totals.tagCoverage} format={(v) => `${Math.round(v)}%`} />}
            tone={totals.tagCoverage < 80 ? "warn" : "good"}
            hint="share of wrong answers tagged C/F/A/R/T/G"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Time on record"
            value={fmtSecs(totals.timeTotal)}
            hint="across all in-app tests"
          />
        </StaggerItem>
      </Stagger>

      {/* AI Coach — diagnosis + 7-day plan from real data (todos, calendar, syllabus, tests) */}
      <CoachCard tests={tests} responses={responses} syllabus={syllabus} />

      <div className="grid lg:grid-cols-3 gap-6">
        {/* C3: backup nudge — slim amber banner above the Today card */}
        {backupNudge && !backupDismissed ? (
          <div className="lg:col-span-3 bg-amber-50 border border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/25 rounded-lg px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-amber-800 dark:text-amber-300">
              <span className="font-medium">Last backup: {backupNudge.label}</span> — export a JSON
              backup to keep your data safe.
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8 border-amber-300 text-amber-800 hover:bg-amber-100 dark:border-amber-500/40 dark:text-amber-300 dark:hover:bg-amber-500/10"
                onClick={() => nav.go("data")}
              >
                Export backup
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-amber-700 hover:text-amber-800 hover:bg-amber-100 dark:text-amber-400 dark:hover:text-amber-300 dark:hover:bg-amber-500/10"
                onClick={() => setBackupDismissed(true)}
              >
                Dismiss
              </Button>
            </div>
          </div>
        ) : null}

        {/* To-do card (replaces the old Today blocks card) */}
        <div className="lg:col-span-1">
          <TodoCard />
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
                    className="flex items-center justify-between gap-2 text-sm bg-amber-50 border border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/25 rounded-lg px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-foreground truncate">{h.chapter}</div>
                      <div className="text-xs text-muted-foreground">
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
                    className="flex items-center justify-between gap-2 text-sm bg-red-50 border border-red-200 dark:bg-red-500/10 dark:border-red-500/25 rounded-lg px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-foreground truncate">{r.chapter}</div>
                      <div className="text-xs text-muted-foreground">{r.subject}</div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge variant="outline" className="border-red-300 text-red-700 dark:border-red-500/40 dark:text-red-300">
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
                className="border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300 text-xs"
              >
                {s.chapter} · due {s.next_revision === today ? "tonight" : s.next_revision}
              </Badge>
            ))}
            {due.length > 24 ? (
              <span className="text-xs text-muted-foreground/70 self-center">+{due.length - 24} more</span>
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
                    "press px-2.5 py-0.5 rounded-full text-[11px] transition-colors",
                    timelineMode === m
                      ? "bg-foreground text-background"
                      : "bg-muted text-muted-foreground hover:bg-accent"
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
                <AreaChart data={timelineData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                  <defs>
                    <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CH.coral} stopOpacity={0.22} />
                      <stop offset="100%" stopColor={CH.coral} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid {...GRID} vertical={false} />
                  <XAxis dataKey="label" tick={{ ...TICK_MONO }} />
                  <YAxis
                    tick={TICK_MONO}
                    tickFormatter={timelineMode === "pct" ? (v: number) => `${v}%` : undefined}
                  />
                  <Tooltip content={<ChartTip />} cursor={{ stroke: "var(--chart-tick)", strokeDasharray: "3 3" }} />
                  <Area
                    type="monotone"
                    dataKey={timelineMode === "pct" ? "pct" : "score"}
                    stroke={CH.coral}
                    strokeWidth={2}
                    fill={`url(#${gradientId})`}
                    dot={false}
                    activeDot={{ r: 4, fill: CH.coral, stroke: "var(--background)", strokeWidth: 2 }}
                    name={timelineMode === "pct" ? "% of max" : "score"}
                    isAnimationActive
                    animationDuration={700}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
          <ChartNote>
            {timelineMode === "pct"
              ? "Each point is one logged test as a share of its max marks — papers of different difficulty stay comparable."
              : "Each point is one logged test's raw score. Switch to % to compare across papers of different lengths."}
          </ChartNote>
        </SectionCard>

        <SectionCard title="Accuracy by subject" subtitle="in-app attempts only">
          {totals.attempted === 0 ? (
            <EmptyNote>No attempts recorded yet.</EmptyNote>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={subjAcc} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="subject" tick={{ ...TICK_MONO }} />
                  <YAxis domain={[0, 100]} tick={{ ...TICK_MONO }} />
                  <Tooltip content={<ChartTip />} cursor={{ fill: "var(--chart-grid)" }} />
                  <ReferenceLine y={70} stroke={CH.green} strokeDasharray="4 4" />
                  <Bar maxBarSize={48} dataKey="accuracy" name="accuracy %" radius={[4, 4, 0, 0]}>
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
          <ChartNote>
            Share of attempted questions answered correctly, per subject — the dashed line is the
            70% green gate.
          </ChartNote>
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
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="tag" tick={TICK} interval={0} />
                  <YAxis allowDecimals={false} tick={{ ...TICK_MONO }} />
                  <Tooltip content={<TagPctTooltip />} cursor={{ fill: "var(--chart-grid)" }} />
                  <Bar maxBarSize={48} dataKey="count" name="wrong answers" fill={CH.blueGray} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <ChartNote>
            C = concept gap · F = formula recall · A = accuracy slip · R = revision lapse · T = time
            pressure · G = guess. The tallest bars are where marks come back cheapest.
          </ChartNote>
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
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="label" tick={TICK} interval={0} />
                  <YAxis tick={{ ...TICK_MONO }} />
                  <Tooltip content={<ChartTip />} cursor={{ fill: "var(--chart-grid)" }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar maxBarSize={48} dataKey="actual" name="actual" fill={CH.coral} radius={[3, 3, 0, 0]} />
                  <Bar maxBarSize={48} dataKey="ifSkipped" name="if guesses skipped" fill={CH.stone} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <ChartNote>
            Green = the score you actually got. Grey = what the same paper would pay with guessed
            attempts skipped — the gap is marks leaking to negative marking.
          </ChartNote>
        </SectionCard>

        <SectionCard title="Time by subject" subtitle="total seconds spent per subject (in-app tests)">
          {timeSubj.length === 0 ? (
            <EmptyNote>No time recorded yet.</EmptyNote>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={timeSubj} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="subject" tick={{ ...TICK_MONO }} />
                  <YAxis tick={{ ...TICK_MONO }} />
                  <Tooltip content={<ChartTip />} cursor={{ fill: "var(--chart-grid)" }} />
                  <Bar maxBarSize={48} dataKey="minutes" name="minutes" fill={CH.amber} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <ChartNote>
            Minutes per subject across in-app tests — catch lopsided time allocation before the
            exam does.
          </ChartNote>
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
              <thead className="text-left text-[11px] text-muted-foreground/70 uppercase tracking-[0.06em]">
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
                  <tr key={t.id} className="border-t border-border/60 transition-colors hover:bg-accent/40">
                    <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">{t.date}</td>
                    <td className="py-2 pr-3 font-medium text-foreground max-w-52 truncate">
                      {t.name}
                    </td>
                    <td className="py-2 pr-3">
                      <Badge variant="outline" className="text-[10px] border-border text-muted-foreground">
                        {t.type}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3 text-right font-semibold tabular-nums">
                      {t.score}
                      <span className="text-muted-foreground/60 font-normal">/{t.max_score}</span>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                      {t.subject_scores.Physics ?? "—"}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                      {t.subject_scores.Chemistry ?? "—"}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
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

