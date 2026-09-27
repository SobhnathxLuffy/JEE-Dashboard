// ─── JEE Study App — data model ──────────────────────────────────────────────
// Local-first: everything lives in IndexedDB. No backend, no auth.

export type Subject = "Physics" | "Chemistry" | "Mathematics";

export type QuestionType = "MCQ" | "numerical";

export type TestType =
  | "chapter"
  | "mixed"
  | "part"
  | "full"
  | "pdf"
  | "external";

/** Error tags: Concept / Formula / Algebra-calc / Read wrong / Time-strategy / Guess */
export type ErrorTag = "C" | "F" | "A" | "R" | "T" | "G";

export const ERROR_TAGS: { code: ErrorTag; label: string; hint: string }[] = [
  { code: "C", label: "Concept", hint: "Didn't know / misunderstood the concept" },
  { code: "F", label: "Formula", hint: "Knew the idea, forgot the formula → goes to formula sheet" },
  { code: "A", label: "Algebra-calc", hint: "Concept fine, arithmetic / algebra slipped" },
  { code: "R", label: "Read wrong", hint: "Misread the question" },
  { code: "T", label: "Time-strategy", hint: "Right approach, ran out of time or bad call" },
  { code: "G", label: "Guess", hint: "Blind guess — should have been left" },
];

export interface Question {
  id: string;
  question: string;
  options: string[]; // 4 entries for MCQ, [] for numerical
  answer: number | string; // option index (MCQ) or numeric answer (numerical)
  tolerance: number; // numerical only, default 0 (exact match)
  type: QuestionType;
  subject: Subject;
  chapter: string;
  source: string;
  source_url?: string;
  created_at: number;
}

export interface TestRecord {
  id: string;
  date: string; // YYYY-MM-DD
  created_at: number;
  name: string;
  source: string; // in-app / pdf filename / Abhyas / SATHEE / Allen / other
  type: TestType;
  duration_min: number;
  score: number;
  max_score: number;
  subject_scores: Partial<Record<Subject, number>>;
  // in-app CBT
  question_ids?: string[];
  // pdf mode
  pdf_meta?: {
    subject: Subject;
    chapter: string;
    start_page: number;
    end_page: number;
    total_questions: number;
    key: { no: number; answer: string }[]; // "A".."D" or numeric string
  };
  // external summary
  external_meta?: {
    attempts: number;
    wrong: number;
  };
}

export interface ResponseRecord {
  id: string; // `${test_id}:${question_id}`
  test_id: string;
  question_id: string; // bank question id, or `pdf:${testId}:${no}` for pdf tests
  selected: number | string | null; // option index / numeric answer / null = unattempted
  correct: boolean;
  attempted: boolean;
  time_spent: number; // seconds
  error_tag: ErrorTag | null;
  // denormalized so analytics never needs a join with pdf meta
  subject: Subject;
  chapter: string;
  question_snippet: string;
  correct_answer: number | string;
  type: QuestionType;
  options?: string[];
}

export type ChapterStatus =
  | "Not Started"
  | "Learning"
  | "PYQs Done"
  | "70% Gate Passed"
  | "Maintenance";

export const CHAPTER_STATUSES: ChapterStatus[] = [
  "Not Started",
  "Learning",
  "PYQs Done",
  "70% Gate Passed",
  "Maintenance",
];

/** Revision schedule: same night → next day → 3–4 days → 1 week */
export const REVISION_INTERVALS_DAYS = [0, 1, 3, 7];

export interface SyllabusRow {
  id: string; // `${subject}:${chapter}`
  chapter: string;
  subject: Subject;
  tier: 1 | 2 | 3;
  status: ChapterStatus;
  notes: string;
  last_revised: string | null; // YYYY-MM-DD
  revision_stage: number; // 0..3 index into REVISION_INTERVALS_DAYS
  next_revision: string | null; // YYYY-MM-DD
}

export interface FormulaEntry {
  id: string;
  test_id: string;
  question_id: string;
  subject: Subject;
  chapter: string;
  snippet: string;
  created_at: number;
}

export interface DailyLog {
  date: string; // YYYY-MM-DD (key)
  blocks: {
    math: boolean;
    physics: boolean;
    chemistry: boolean;
    recall: boolean;
  };
  chapters: string; // editable "today's chapters" line
}

/** In-progress test session (survives refresh via IndexedDB) */
export interface ActiveSession {
  key: "active";
  test_id: string;
  mode: "cbt" | "pdf";
  test_type: TestType;
  name: string;
  subject_order: Subject[];
  question_ids: string[]; // cbt: bank ids in order
  pdf_meta?: TestRecord["pdf_meta"];
  duration_min: number;
  started_at: number; // epoch ms
  answers: Record<string, number | string | null>; // by question slot id
  marked: string[];
  current: number; // global question index
  q_times: Record<string, number>; // accumulated seconds per question
  q_entered_at: number; // epoch ms when current question was entered
  pdf_file_bytes?: ArrayBuffer; // kept only in memory, not persisted
}

export const SUBJECTS: Subject[] = ["Physics", "Chemistry", "Mathematics"];
export const SUBJECT_SHORT: Record<Subject, string> = {
  Physics: "P",
  Chemistry: "C",
  Mathematics: "M",
};

export function todayStr(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function fmtSecs(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  if (m >= 60) {
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  }
  return `${m}m ${`${sec}`.padStart(2, "0")}s`;
}
