// ─── Analytics engine — every number the dashboard shows ────────────────────
import type {
  ErrorTag,
  ResponseRecord,
  Subject,
  SyllabusRow,
  TestRecord,
} from "./types";
import { ERROR_TAGS, SUBJECTS, todayStr } from "./types";

export interface ChapterHealth {
  chapter: string;
  subject: Subject;
  attempted: number;
  correct: number;
  wrong: number;
  accuracy: number | null; // null = no data
  color: "green" | "amber" | "red" | "gray";
  last_seen: number; // epoch of latest response
}

export function computeChapterHealth(
  responses: ResponseRecord[],
  tests: TestRecord[]
): Map<string, ChapterHealth> {
  const testTime = new Map(tests.map((t) => [t.id, t.created_at]));
  const map = new Map<string, ChapterHealth>();
  for (const r of responses) {
    if (!r.attempted) continue;
    const key = `${r.subject}::${r.chapter}`;
    let h = map.get(key);
    if (!h) {
      h = {
        chapter: r.chapter,
        subject: r.subject,
        attempted: 0,
        correct: 0,
        wrong: 0,
        accuracy: null,
        color: "gray",
        last_seen: 0,
      };
      map.set(key, h);
    }
    h.attempted += 1;
    if (r.correct) h.correct += 1;
    else h.wrong += 1;
    const t = testTime.get(r.test_id) ?? 0;
    h.last_seen = Math.max(h.last_seen, t);
  }
  for (const h of map.values()) {
    h.accuracy = h.attempted > 0 ? Math.round((h.correct / h.attempted) * 100) : null;
    h.color =
      h.accuracy === null
        ? "gray"
        : h.accuracy >= 70
          ? "green"
          : h.accuracy >= 40
            ? "amber"
            : "red";
  }
  return map;
}

/** Amber-first repair queue: 40–70% chapters sorted by most-recently-touched */
export function amberQueue(
  health: ChapterHealth[]
): ChapterHealth[] {
  return health
    .filter((h) => h.color === "amber")
    .sort((a, b) => b.last_seen - a.last_seen);
}

/** Chapters producing repeated failure — wrong answers across ≥2 distinct tests */
export function repeatedFailureChapters(
  responses: ResponseRecord[]
): { chapter: string; subject: Subject; tests_failed: number; wrongs: number }[] {
  const byChapter = new Map<string, Set<string>>();
  const wrongCount = new Map<string, number>();
  for (const r of responses) {
    if (!r.attempted || r.correct) continue;
    const key = `${r.subject}::${r.chapter}`;
    if (!byChapter.has(key)) byChapter.set(key, new Set());
    byChapter.get(key)!.add(r.test_id);
    wrongCount.set(key, (wrongCount.get(key) ?? 0) + 1);
  }
  const out: { chapter: string; subject: Subject; tests_failed: number; wrongs: number }[] = [];
  for (const [key, testIds] of byChapter) {
    if (testIds.size >= 2) {
      const [subject, chapter] = key.split("::") as [Subject, string];
      out.push({
        chapter,
        subject,
        tests_failed: testIds.size,
        wrongs: wrongCount.get(key) ?? 0,
      });
    }
  }
  return out.sort((a, b) => b.wrongs - a.wrongs);
}

export function northStar(tests: TestRecord[], responses: ResponseRecord[]): number {
  const inApp = responses.filter((r) => r.correct).length;
  const external = tests
    .filter((t) => t.type === "external" && t.external_meta)
    .reduce((acc, t) => acc + Math.max(0, t.external_meta!.attempts - t.external_meta!.wrong), 0);
  return inApp + external;
}

export function scoreTimeline(tests: TestRecord[]) {
  return [...tests]
    .filter((t): t is TestRecord & { score: number } => t.score !== null) // skip key-later tests awaiting self-mark
    .sort((a, b) => a.created_at - b.created_at)
    .map((t) => ({
      label: `${t.date.slice(5)} · ${t.source.slice(0, 12)}`,
      score: t.score,
      max: t.max_score,
    }));
}

export function subjectAccuracy(responses: ResponseRecord[]) {
  return SUBJECTS.map((s) => {
    const rows = responses.filter((r) => r.subject === s && r.attempted);
    const attempted = rows.length;
    const correct = rows.filter((r) => r.correct).length;
    return {
      subject: s,
      accuracy: attempted ? Math.round((correct / attempted) * 100) : 0,
      attempted,
      correct,
    };
  });
}

export function errorTagCounts(responses: ResponseRecord[]) {
  return ERROR_TAGS.map((t) => ({
    tag: `${t.code} · ${t.label}`,
    count: responses.filter((r) => r.error_tag === t.code).length,
  }));
}

export function negativeMarksByTest(tests: TestRecord[], responses: ResponseRecord[]) {
  return [...tests]
    .filter((t): t is TestRecord & { score: number } => t.score !== null) // skip key-later tests awaiting self-mark
    .sort((a, b) => a.created_at - b.created_at)
    .slice(-12)
    .map((t) => {
      let wrong = 0;
      if (t.type === "external" && t.external_meta) {
        wrong = t.external_meta.wrong;
      } else {
        wrong = responses.filter((r) => r.test_id === t.id && r.attempted && !r.correct).length;
      }
      return {
        label: `${t.date.slice(5)} · ${t.source.slice(0, 10)}`,
        actual: t.score,
        ifSkipped: t.score + wrong, // each wrong cost −1; skipping would have been 0
        lost: wrong,
      };
    });
}

export function timeBySubject(responses: ResponseRecord[]) {
  return SUBJECTS.map((s) => ({
    subject: s,
    minutes: Math.round(
      responses.filter((r) => r.subject === s).reduce((a, r) => a + (r.time_spent || 0), 0) / 60
    ),
  })).filter((x) => x.minutes > 0);
}

/** Chapters due for revision right now (schedule: same night → +1d → +3d → +7d) */
export function revisionDueRows(syllabus: SyllabusRow[]): SyllabusRow[] {
  const today = todayStr();
  return syllabus.filter(
    (s) => s.next_revision !== null && s.next_revision <= today
  );
}

/** Per-subject score for an in-app test from its responses. */
export function subjectScoresOf(
  responses: ResponseRecord[],
  questionIds: string[]
): Record<Subject, number> {
  const out: Record<Subject, number> = { Physics: 0, Chemistry: 0, Mathematics: 0 };
  const byId = new Map(responses.map((r) => [r.question_id, r]));
  for (const qid of questionIds) {
    const r = byId.get(qid);
    if (!r) continue;
    if (!r.attempted) continue;
    out[r.subject] += r.correct ? 4 : -1;
  }
  return out;
}

export function tagOf(code: ErrorTag | null): string {
  if (!code) return "—";
  const t = ERROR_TAGS.find((x) => x.code === code);
  return t ? `${t.code} · ${t.label}` : "—";
}
