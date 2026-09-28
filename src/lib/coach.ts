// ─── AI Coach data layer — pure, testable snapshot of the whole app state ────
// Gathers what the user asked for: remaining to-dos, what's on the calendar
// tomorrow, syllabus coverage (which chapters are NOT done), and performance
// on every test. The model receives this compact JSON and returns a strict
// report + a 7-day plan that can be written into the calendar as time blocks.
import type {
  CalEventRecord,
  Subject,
  SyllabusRow,
  Task,
  TestRecord,
  ResponseRecord,
} from "./types";
import { SUBJECTS, addDays, todayStr } from "./types";
import { computeChapterHealth, repeatedFailureChapters, subjectAccuracy } from "./analytics";

// ─── report shape (what the model must return) ───────────────────────────────

export interface CoachPlanBlock {
  day: number; // 0 = today … 6
  title: string;
  subject?: string;
  startMin: number; // minutes from midnight
  durationMin: number;
  kind: "study" | "revision" | "test";
}

export interface CoachReport {
  summary: string;
  strengths: string[];
  weakChapters: { subject: Subject; chapter: string; reason: string }[];
  notStartedFocus: { subject: Subject; chapter: string; why: string }[];
  /** models occasionally emit {message:"…"} objects instead of strings — both accepted */
  insights: (string | { message: string })[];
  plan: CoachPlanBlock[];
}

export function isCoachReport(v: unknown): v is CoachReport {
  const r = v as CoachReport;
  return (
    !!r &&
    typeof r.summary === "string" &&
    Array.isArray(r.insights) &&
    Array.isArray(r.plan) &&
    r.plan.every(
      (b) =>
        typeof b.day === "number" &&
        typeof b.title === "string" &&
        typeof b.startMin === "number" &&
        typeof b.durationMin === "number" &&
        ["study", "revision", "test"].includes(b.kind)
    )
  );
}

// ─── snapshot (compact JSON for the prompt) ──────────────────────────────────

const CAP = 14;

function fmtMin(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export interface CoachSnapshotInput {
  tests: TestRecord[];
  responses: ResponseRecord[];
  tasks: Task[];
  events: CalEventRecord[];
  syllabus: SyllabusRow[];
  examDate?: string;
}

export function buildCoachSnapshot(input: CoachSnapshotInput): Record<string, unknown> {
  const today = todayStr();
  const tomorrow = addDays(today, 1);

  // ── to-dos ──
  const pendingTasks = input.tasks.filter((t) => !t.done);
  const overdue = pendingTasks.filter((t) => t.due_date && t.due_date < today);
  const dueToday = pendingTasks.filter((t) => t.due_date === today);

  // ── tomorrow on the calendar ──
  const tomorrowEvents = input.events
    .filter((e) => e.date === tomorrow)
    .map((e) => ({
      title: e.title,
      time: e.allDay ? "all-day" : `${fmtMin(e.start_min)}–${fmtMin(e.end_min)}`,
    }));
  const tomorrowTests = input.tests.filter((t) => t.date === tomorrow).map((t) => t.name);
  const tomorrowRevisions = input.syllabus
    .filter((s) => s.next_revision === tomorrow)
    .map((s) => `${s.chapter} (${s.subject})`);
  const tomorrowTasks = pendingTasks.filter((t) => t.due_date === tomorrow).map((t) => t.text);

  // ── syllabus coverage ──
  const syllabusBySubj = SUBJECTS.map((s) => {
    const rows = input.syllabus.filter((r) => r.subject === s);
    const notStarted = rows.filter((r) => r.status === "Not Started");
    const learning = rows.filter((r) => r.status === "Learning");
    const done = rows.filter((r) => r.status !== "Not Started" && r.status !== "Learning");
    return {
      subject: s,
      totalChapters: rows.length,
      notStarted: notStarted.length,
      learning: learning.length,
      progressed: done.length,
      coveragePct: rows.length ? Math.round((done.length / rows.length) * 100) : 0,
      notStartedList: notStarted.slice(0, CAP).map((r) => `${r.chapter} (tier ${r.tier})`),
    };
  });

  // ── chapter performance ──
  const health = [...computeChapterHealth(input.responses, input.tests).values()];
  const weak = health
    .filter((h) => h.color === "red" || h.color === "amber")
    .sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0))
    .slice(0, CAP)
    .map((h) => ({
      chapter: h.chapter,
      subject: h.subject,
      accuracy: h.accuracy,
      attempted: h.attempted,
      color: h.color,
    }));
  const repeatFails = repeatedFailureChapters(input.responses).slice(0, 8);

  // ── tests ──
  const scored = [...input.tests]
    .filter((t) => t.score !== null)
    .sort((a, b) => b.created_at - a.created_at);
  const recent = scored.slice(0, 12).map((t) => ({
    date: t.date,
    name: t.name.slice(0, 40),
    type: t.type,
    score: `${t.score}/${t.max_score}`,
    pct: Math.round((t.score! / Math.max(1, t.max_score)) * 100),
    subjects: t.subject_scores,
  }));

  // ── error tags ──
  const tagCounts: Record<string, number> = {};
  for (const r of input.responses) {
    if (r.error_tag) tagCounts[r.error_tag] = (tagCounts[r.error_tag] ?? 0) + 1;
  }

  const examDaysLeft = input.examDate
    ? Math.ceil((new Date(`${input.examDate}T12:00:00`).getTime() - Date.now()) / 86400000)
    : null;

  return {
    today,
    exam: input.examDate ? { date: input.examDate, daysLeft: examDaysLeft } : null,
    todos: {
      pendingTotal: pendingTasks.length,
      overdue: overdue.length,
      dueToday: dueToday.length,
      pendingList: pendingTasks.slice(0, CAP).map((t) => ({
        text: t.text.slice(0, 80),
        due: t.due_date ?? null,
      })),
    },
    calendarTomorrow: {
      date: tomorrow,
      events: tomorrowEvents,
      tests: tomorrowTests,
      revisions: tomorrowRevisions,
      tasks: tomorrowTasks,
    },
    syllabusCoverage: syllabusBySubj,
    weakChapters: weak,
    repeatedFailures: repeatFails,
    subjectAccuracy: subjectAccuracy(input.responses),
    recentTests: recent,
    errorTags: tagCounts,
    overall: {
      testsLogged: input.tests.length,
      questionsAttempted: input.responses.filter((r) => r.attempted).length,
    },
  };
}

// ─── prompts ─────────────────────────────────────────────────────────────────

const COACH_SYSTEM =
  "You are a sharp, honest JEE mentor who has coached hundreds of students. " +
  "You receive a compact JSON snapshot of a student's prep app: pending to-dos, " +
  "tomorrow's calendar, syllabus coverage, weak chapters and every recent test score. " +
  "Output ONLY valid JSON — no markdown fences, no commentary. Be concrete and " +
  "quantitative; never generic. Do not invent data that is not in the snapshot.";

const PLAN_SHAPE =
  '{"summary":"3-4 sentence honest diagnosis with numbers","strengths":["..."],"weakChapters":[{"subject":"Physics","chapter":"...","reason":"one line, quantitative"}],"notStartedFocus":[{"subject":"Physics","chapter":"...","why":"one line (yield/sequencing)"}],"insights":["2-5 sharp observations: negatives, time, tagging discipline, revision debt"],"plan":[{"day":0,"title":"...","subject":"Physics","startMin":540,"durationMin":90,"kind":"study"}]}';

export function coachUserPrompt(snapshot: Record<string, unknown>): string {
  return [
    "STUDENT SNAPSHOT (JSON):",
    JSON.stringify(snapshot),
    "",
    "Return a JSON object with exactly this shape:",
    PLAN_SHAPE,
    "",
    "Rules:",
    "- summary: the real diagnosis first (weak subjects/chapters with accuracy numbers), then the single biggest lever. No flattery.",
    "- weakChapters: ONLY chapters with data in the snapshot. If none, empty array.",
    "- notStartedFocus: pick up to 5 'Not Started' chapters with the best marks-per-effort (prefer tier 1 and 2, respect subject balance).",
    "- plan: EXACTLY 7 days (day 0 = today … day 6), 3-5 blocks per day, each 45-120 min.",
    "- startMin: minutes from midnight, between 360 (6am) and 1290 (9:30pm). Blocks must not overlap each other on the same day.",
    "- Avoid the busy times listed in calendarTomorrow.events for day 1 (tomorrow); schedule around them.",
    "- The plan must attack weakChapters FIRST (study/revision), schedule at least one full 'test' block on day 3 or 4, and leave lighter load after the test for review.",
    "- 'kind' is study | revision | test. Subject values must be Physics / Chemistry / Mathematics when present.",
    "- If the snapshot shows almost no data (new user), say exactly what to log first and build a starter plan around it.",
  ].join("\n");
}
