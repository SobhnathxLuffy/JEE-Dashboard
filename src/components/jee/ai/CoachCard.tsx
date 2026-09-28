"use client";

// ─── CoachCard — AI mentor on the Dashboard: diagnosis + 7-day plan ──────────
// Reads the user's REAL state (pending to-dos, tomorrow's calendar, syllabus
// coverage incl. untouched chapters, every test score) and asks the model for
// a strict JSON report. The plan converts into calendar time-blocks in one tap.
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { SectionCard } from "../shared";
import { AISettingsDialog } from "./AISettingsDialog";
import { kvGet, get, put, useLive } from "@/lib/idb";
import { addDays, todayStr, uid, type CalEventRecord, type EventColor } from "@/lib/types";
import { aiCacheSet, aiConfigured, callAI, AIConfigError } from "@/lib/ai";
import {
  buildCoachSnapshot,
  coachUserPrompt,
  isCoachReport,
  type CoachPlanBlock,
  type CoachReport,
} from "@/lib/coach";
import type { ResponseRecord, SyllabusRow, Task, TestRecord } from "@/lib/types";

const COACH_SYSTEM =
  "You are a sharp, honest JEE mentor. You receive a compact JSON snapshot of a student's prep app (pending to-dos, tomorrow's calendar, syllabus coverage, weak chapters, every recent test). Output ONLY valid JSON — no markdown fences, no commentary. Be concrete and quantitative; never generic.";

const KIND_COLOR: Record<CoachPlanBlock["kind"], EventColor> = {
  study: "slate",
  revision: "kraft",
  test: "coral",
};

function fmtMin(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function dayLabel(day: number, today: string): string {
  if (day === 0) return "Today";
  if (day === 1) return "Tomorrow";
  const d = new Date(`${addDays(today, day)}T12:00:00`);
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

export function CoachCard({
  tests,
  responses,
  syllabus,
}: {
  tests: TestRecord[];
  responses: ResponseRecord[];
  syllabus: SyllabusRow[];
}) {
  const tasks = useLive("tasks");
  const events = useLive("cal_events");

  const [report, setReport] = useState<CoachReport | null>(null);
  const [reportAt, setReportAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null); // null = not read yet

  // load the last cached report + config state on mount
  useEffect(() => {
    let alive = true;
    (async () => {
      const rec = await get("ai_cache", "coach:latest");
      if (!alive) return;
      if (rec && isCoachReport(rec.payload)) {
        setReport(rec.payload);
        setReportAt(rec.created_at);
      }
      setConfigured(aiConfigured());
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const examDate = await kvGet<string>("target-exam-date");
      const snapshot = buildCoachSnapshot({ tests, responses, tasks, events, syllabus, examDate });
      const { text } = await callAI({
        feature: "coach",
        system: COACH_SYSTEM,
        user: coachUserPrompt(snapshot),
        jsonMode: true,
        temperature: 0.4,
      });
      const { parseLooseJson } = await import("@/lib/ai");
      const parsed = parseLooseJson<CoachReport>(text);
      if (!parsed || !isCoachReport(parsed)) {
        throw new Error("The model returned a report in the wrong shape — try again (or switch to DeepSeek / a stronger model).");
      }
      parsed.plan = parsed.plan
        .filter((b) => b.day >= 0 && b.day <= 6 && b.durationMin >= 15 && b.durationMin <= 300)
        .slice(0, 40);
      setReport(parsed);
      setReportAt(Date.now());
      await aiCacheSet("coach", "latest", parsed);
    } catch (e) {
      if (e instanceof AIConfigError) {
        setError(e.message);
        setConfigured(false);
      } else {
        setError((e as Error).message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function addPlanToCalendar() {
    if (!report || report.plan.length === 0) return;
    if (planMarker && events.some((e) => (e.notes ?? "").includes(planMarker))) {
      toast.info("This plan is already in your Calendar");
      return;
    }
    const today = todayStr();
    const rows: CalEventRecord[] = report.plan.map((b) => ({
      id: uid(),
      title: b.title,
      notes: planMarker ? `${planMarker} · ${b.subject ?? "General"}` : `AI Coach · ${b.subject ?? "General"}`,
      date: addDays(today, b.day),
      start_min: Math.max(0, Math.min(1439, Math.round(b.startMin))),
      end_min: Math.max(1, Math.min(1440, Math.round(b.startMin) + Math.round(b.durationMin))),
      allDay: false,
      color: KIND_COLOR[b.kind] ?? "slate",
      created_at: Date.now(),
      updated_at: Date.now(),
    }));
    for (const r of rows) await put("cal_events", r);
    toast.success(`${rows.length} plan blocks added to the Calendar`);
  }

  const today = todayStr();
  const totalBlocks = useMemo(() => report?.plan.length ?? 0, [report]);
  const totalHours = useMemo(
    () => Math.round((report?.plan.reduce((a, b) => a + b.durationMin, 0) ?? 0) / 60 * 10) / 10,
    [report]
  );

  // Idempotent add: the marker lives on the events themselves (survives the
  // Dashboard's dataVersion remounts — local component state does not).
  const planMarker = report && reportAt ? `AI Coach plan ${reportAt}` : null;
  const alreadyAdded = useMemo(
    () => !!planMarker && events.some((e) => (e.notes ?? "").includes(planMarker)),
    [events, planMarker]
  );

  return (
    <SectionCard
      title={
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="text-primary">✦</span> AI Coach
        </span>
      }
      subtitle="reads your to-dos, calendar, syllabus coverage and every test — then tells you what to fix and plans your week"
      action={
        <div className="flex items-center gap-2">
          {reportAt ? (
            <span className="hidden sm:inline text-[10px] text-muted-foreground/70">
              {new Date(reportAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
            </span>
          ) : null}
          {configured === false ? (
            <Button size="sm" variant="outline" onClick={() => setSettingsOpen(true)}>
              Connect AI
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => void generate()}
              disabled={busy || configured === null}
              className="bg-emerald-700 hover:bg-emerald-800 dark:bg-emerald-500 dark:hover:bg-emerald-600 dark:text-emerald-950"
            >
              {busy ? "Thinking…" : report ? "↻ Regenerate" : "✦ Generate report"}
            </Button>
          )}
        </div>
      }
    >
      {configured === false && !report ? (
        <div className="text-sm text-muted-foreground py-2 space-y-2">
          <p>
            The coach needs a one-time AI setup — your AI Credits (or any OpenAI-compatible) URL,
            key and model. Reports cost roughly ₹0.3 each on DeepSeek.
          </p>
          <Button size="sm" variant="outline" onClick={() => setSettingsOpen(true)}>
            Open AI settings
          </Button>
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10 px-3.5 py-2.5 text-sm text-red-700 dark:text-red-300 space-y-2">
          <p>{error}</p>
          <Button size="sm" variant="outline" onClick={() => void generate()}>
            Retry
          </Button>
        </div>
      ) : !report ? (
        <p className="text-sm text-muted-foreground py-2">
          {busy
            ? "Reading your to-dos, calendar, syllabus and test history…"
            : "No report yet — hit “Generate report”. It looks at everything you've logged and plans the next 7 days."}
        </p>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{report.summary}</p>

          {report.weakChapters.length > 0 ? (
            <div className="space-y-1.5">
              <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground font-medium">Weak chapters</div>
              <div className="flex flex-wrap gap-1.5">
                {report.weakChapters.slice(0, 8).map((w, i) => (
                  <Badge
                    key={i}
                    variant="outline"
                    className="border-red-200 bg-red-50/60 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300 text-[11px] font-normal"
                    title={w.reason}
                  >
                    {w.subject.slice(0, 1)} · {w.chapter}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}

          {report.notStartedFocus.length > 0 ? (
            <div className="space-y-1.5">
              <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground font-medium">
                Syllabus gaps worth starting
              </div>
              <div className="flex flex-wrap gap-1.5">
                {report.notStartedFocus.slice(0, 6).map((c, i) => (
                  <Badge
                    key={i}
                    variant="outline"
                    className="border-amber-200 bg-amber-50/60 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300 text-[11px] font-normal"
                    title={c.why}
                  >
                    {c.subject.slice(0, 1)} · {c.chapter}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}

          {report.insights.length > 0 ? (
            <ul className="text-sm text-muted-foreground space-y-1">
              {report.insights.slice(0, 5).map((ins, i) => (
                <li key={i} className="flex gap-1.5">
                  <span aria-hidden="true" className="text-primary select-none">◦</span>
                  <span className="leading-snug">{typeof ins === "string" ? ins : ins.message}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {totalBlocks > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground font-medium">
                  7-day plan · {totalBlocks} blocks · {totalHours}h
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void addPlanToCalendar()}
                  disabled={alreadyAdded}
                  title={alreadyAdded ? "This plan is already in the Calendar — regenerate for a fresh one" : "Creates time blocks in the Calendar tab"}
                >
                  {alreadyAdded ? "✓ In Calendar" : "+ Add plan to Calendar"}
                </Button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                {Array.from({ length: 7 }, (_, day) => {
                  const blocks = report.plan.filter((b) => b.day === day);
                  return (
                    <div key={day} className="rounded-lg border border-border bg-muted/30 px-2.5 py-2 min-h-20">
                      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                        {dayLabel(day, today)}
                      </div>
                      {blocks.length === 0 ? (
                        <div className="text-[10px] text-muted-foreground/50">rest / self-study</div>
                      ) : (
                        <ul className="space-y-1.5">
                          {blocks.map((b, i) => (
                            <li key={i} className="text-[11px] leading-tight">
                              <span className="font-mono tabular-nums text-muted-foreground/80 block">
                                {fmtMin(b.startMin)} · {Math.round(b.durationMin)}m
                              </span>
                              <span
                                className={cn(
                                  "font-medium",
                                  b.kind === "test" ? "text-red-600 dark:text-red-400" : "text-foreground"
                                )}
                              >
                                {b.title}
                              </span>
                              {b.subject ? (
                                <span className="text-muted-foreground/60"> · {b.subject.slice(0, 1)}</span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      )}

      <AISettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </SectionCard>
  );
}
