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
  image?: string; // optional figure as dataURL, rendered in bank + player
  created_at: number;
  updated_at?: number; // set when the question is edited in place (bank, Sprint D2)
}

/** One answer-key entry for a PDF paper question (paper numbering). */
export interface PdfKeyEntry {
  no: number;
  /** primary/legacy single value: "B" or "42.5" ("" for bonus-only entries) */
  answer: string;
  /** full accepted set — ["B","C"] for revised NTA keys; omitted when single */
  answers?: string[];
  /** dropped question — everyone gets +4 */
  bonus?: boolean;
}

/** One section of a PDF paper (single-subject mode = 1 element, full paper = 3). */
export interface PdfSection {
  subject: Subject;
  chapter: string;
  first_q: number; // paper numbering, inclusive
  last_q: number; // paper numbering, inclusive
  start_page: number;
  end_page: number;
}

export interface TestRecord {
  id: string;
  date: string; // YYYY-MM-DD
  created_at: number;
  name: string;
  source: string; // in-app / pdf filename / Abhyas / SATHEE / Allen / other
  type: TestType;
  duration_min: number;
  score: number | null; // null = key-later test awaiting self-mark
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
    key: PdfKeyEntry[]; // "A".."D" or numeric string (+ answers[]/bonus flags)
    sections?: PdfSection[]; // 1 = single-subject behavior, 3 = full paper
    first_q?: number; // paper numbering offset (default 1); palette shows first_q..first_q+total-1
    tolerance?: number; // default 0; applies to numerical key entries
    key_later?: boolean; // true = no key provided; self-mark in Results
    page_pins?: Record<string, number>; // paper question number (string) → PDF page override
  };
  // external summary
  external_meta?: {
    attempts: number;
    wrong: number;
  };
}

/** A PDF paper kept in the Papers library — import again without re-uploading. */
export interface PaperRecord {
  id: string;
  name: string; // original filename
  size: number; // bytes
  num_pages: number;
  added_at: number;
  last_used_at?: number;
  data: Blob; // the PDF itself, stored in IndexedDB
}

export interface ResponseRecord {
  id: string; // `${test_id}:${question_id}`
  test_id: string;
  question_id: string; // bank question id, or `pdf:${testId}:${no}` for pdf tests
  selected: number | string | null; // option index / numeric answer / null = unattempted
  correct: boolean | null; // null = pending self-mark (key-later mode)
  attempted: boolean;
  q_no?: number; // original question number as shown in the test/paper (filled at submit)
  note?: string; // optional one-line insight (Results review)
  photo?: string; // optional solution photo dataURL (Results review)
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
  learned?: boolean; // "Mark learned" state
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

/** A to-do item (Dashboard to-do card + Calendar). Simple, local-first. */
export interface Task {
  id: string;
  text: string;
  done: boolean;
  created_at: number;
  done_at?: number;
  due_date?: string; // YYYY-MM-DD, optional
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
