// ─── Answer-key parsing, matching and late-key scoring — shared by PdfImport,
// Player and Results. One implementation, three consumers (C6 spirit). ────────
import type {
  PdfKeyEntry,
  ResponseRecord,
  Subject,
  TestRecord,
} from "./types";

export const LETTERS = ["A", "B", "C", "D"] as const;
export const NUM_RE = /^-?\d+(?:\.\d+)?$/;

/**
 * Answer-key text parser — tolerates the common dirty shapes:
 * "1. A", "1A", "1) b", "7. B or C", "7 B/C", "9. bonus", "1. 42", "1. -12.5".
 * Key numbers are paper numbering (whatever the sheet says).
 */
export function parseAnswerKey(text: string): PdfKeyEntry[] {
  const out: PdfKeyEntry[] = [];
  const re =
    /(\d{1,3})\s*[.):\-]?\s*(bonus|(?:[A-Da-d]\s*(?:\/|,|[oO][rR]\b)\s*)+[A-Da-d]|[A-Da-d])(?![A-Za-z0-9/])|(\d{1,3})\s*[.):\-]\s*(-?\d+(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[1] !== undefined && m[2] !== undefined) {
      const v = m[2].trim();
      if (/^bonus$/i.test(v)) {
        out.push({ no: Number(m[1]), answer: "", bonus: true });
      } else if (v.length > 1) {
        const letters = [
          ...new Set(
            v
              .split(/\s*(?:\/|,|[oO][rR]\b)\s*/)
              .filter(Boolean)
              .map((p) => p.toUpperCase())
          ),
        ].filter((p) => /^[A-D]$/.test(p));
        if (letters.length > 1) {
          out.push({ no: Number(m[1]), answer: letters[0], answers: letters });
        } else if (letters.length === 1) {
          out.push({ no: Number(m[1]), answer: letters[0] });
        }
      } else {
        out.push({ no: Number(m[1]), answer: v.toUpperCase() });
      }
    } else if (m[3] !== undefined && m[4] !== undefined) {
      out.push({ no: Number(m[3]), answer: m[4] });
    }
  }
  // dedupe by question number (last wins)
  const map = new Map<number, PdfKeyEntry>();
  for (const k of out) map.set(k.no, k);
  return [...map.values()].sort((a, b) => a.no - b.no);
}

export type CellResult =
  | { kind: "empty" }
  | { kind: "entry"; entry: PdfKeyEntry }
  | { kind: "invalid" };

/** Interpret one key-grid cell (raw text) — option-number mapping applied here. */
export function parseCell(raw: string, optionNums: boolean): CellResult {
  const t = raw.trim();
  if (t === "") return { kind: "empty" };
  if (/^bonus$/i.test(t)) {
    return { kind: "entry", entry: { no: 0, answer: "", bonus: true } };
  }
  const parts = t
    .split(/\s*(?:\/|,|[oO][rR]\b)\s*/)
    .filter(Boolean);
  if (parts.length > 1) {
    const letters = [
      ...new Set(parts.map((p) => p.toUpperCase())),
    ].filter((p) => /^[A-D]$/.test(p));
    if (letters.length > 1 && letters.length === parts.length) {
      return { kind: "entry", entry: { no: 0, answer: letters[0], answers: letters } };
    }
    return { kind: "invalid" };
  }
  if (/^[A-Da-d]$/.test(t)) {
    return { kind: "entry", entry: { no: 0, answer: t.toUpperCase() } };
  }
  if (optionNums && /^[1-4]$/.test(t)) {
    return { kind: "entry", entry: { no: 0, answer: LETTERS[Number(t) - 1] } };
  }
  if (NUM_RE.test(t)) {
    return { kind: "entry", entry: { no: 0, answer: t } };
  }
  return { kind: "invalid" };
}

// ── key-entry matching (answers[] / bonus aware) ─────────────────────────────

export function entryAccepted(entry: PdfKeyEntry): string[] {
  const acc = entry.answers && entry.answers.length > 0 ? entry.answers : [entry.answer];
  return acc.filter((v) => typeof v === "string" && v.trim() !== "");
}

export function entryIsLetter(entry: PdfKeyEntry): boolean {
  const first = entryAccepted(entry)[0];
  return first !== undefined && /^[A-Da-d]$/.test(first.trim());
}

/** A7 scoring: letters case-insensitive membership; numericals within ±tolerance (+1e-9). */
export function checkPdfAnswer(entry: PdfKeyEntry, selected: string, tolerance: number): boolean {
  const accepted = entryAccepted(entry);
  if (accepted.length === 0) return false;
  if (entryIsLetter(entry)) {
    const u = selected.trim().toUpperCase();
    return accepted.some((v) => v.trim().toUpperCase() === u);
  }
  const u = Number(selected);
  if (Number.isNaN(u)) return false;
  return accepted.some((v) => {
    const a = Number(v);
    return !Number.isNaN(a) && Math.abs(u - a) <= tolerance + 1e-9;
  });
}

/** Human-readable key for the response record ("B", "B/C", "42.5", "bonus"). */
export function keyDisplay(entry: PdfKeyEntry): string {
  const acc = entryAccepted(entry);
  if (acc.length > 0) return acc.join("/");
  return entry.bonus ? "bonus" : "?";
}

/** Paper question range of a pdf_meta — sections when present, synthesized otherwise. */
export function paperRangeOf(meta: NonNullable<TestRecord["pdf_meta"]>): {
  first: number;
  last: number;
} {
  const secs: NonNullable<TestRecord["pdf_meta"]>["sections"] =
    meta.sections && meta.sections.length > 0
      ? meta.sections
      : [
          {
            subject: meta.subject,
            chapter: meta.chapter,
            first_q: meta.first_q ?? 1,
            last_q: (meta.first_q ?? 1) + meta.total_questions - 1,
            start_page: meta.start_page,
            end_page: meta.end_page,
          },
        ];
  return {
    first: Math.min(...secs.map((s) => s.first_q)),
    last: Math.max(...secs.map((s) => s.last_q)),
  };
}

/**
 * Digital key-PDF → concatenated text layer for the key parser.
 * Returns "" when the PDF has no usable text (scanned/image key).
 */
export async function extractKeyTextFromPdf(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf.slice(0) }).promise;
  let text = "";
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    text += tc.items.map((it) => ("str" in it ? it.str : "")).join(" ") + "\n";
    if (text.length > 400_000) break; // safety cap
  }
  doc.destroy();
  return text.slice(0, 400_000);
}

export interface LateKeyResult {
  score: number;
  max: number;
  scoredRows: number; // responses whose correct flag changed to a boolean
}

/**
 * Post-test key application: write the key into pdf_meta, re-evaluate every
 * response of the test with the SAME rules as the player's submit path
 * (attempted + entry → check; missing entry → pending-null, scored 0;
 * bonus → +4 for everyone), then recompute score + subject scores.
 * Fresh reads everywhere — the caller's snapshots may be stale.
 */
export async function applyLateKey(
  testId: string,
  key: PdfKeyEntry[],
  tolerance: number
): Promise<LateKeyResult> {
  const { getAll, get, put, bulkPut } = await import("./idb");
  const { marksFor } = await import("./scoring");
  const test = await get("tests", testId);
  if (!test || !test.pdf_meta) throw new Error("Not a PDF test");
  const tol = Math.max(0, Number(tolerance) || 0);
  const keyByNo = new Map(key.map((k) => [k.no, k] as const));

  const rows = (await getAll("responses")).filter((r) => r.test_id === testId);
  const subjectScores: Record<Subject, number> = {
    Physics: 0,
    Chemistry: 0,
    Mathematics: 0,
  };
  let score = 0;
  let scoredRows = 0;

  const updated: ResponseRecord[] = rows.map((r) => {
    const entry = typeof r.q_no === "number" ? keyByNo.get(r.q_no) : undefined;
    const isBonus = entry?.bonus === true;
    let correct: boolean | null;
    if (isBonus) {
      correct = true; // dropped question — everyone gets +4
    } else if (r.attempted && entry && r.selected !== null && r.selected !== undefined) {
      correct = checkPdfAnswer(entry, String(r.selected), tol);
      scoredRows += 1;
    } else {
      correct = null; // unattempted, or attempted with no key entry → 0, never −1
    }
    const marks = marksFor(r.attempted || isBonus, correct, isBonus);
    score += marks;
    subjectScores[r.subject] += marks;
    return {
      ...r,
      correct,
      correct_answer: entry ? keyDisplay(entry) : r.correct_answer,
      type: entry ? (entryIsLetter(entry) ? "MCQ" : "numerical") : r.type,
      options:
        entry && entryIsLetter(entry)
          ? ["A", "B", "C", "D"]
          : entry
            ? []
            : r.options,
    };
  });

  await bulkPut("responses", updated);
  await put("tests", {
    ...test,
    score,
    subject_scores: subjectScores,
    pdf_meta: { ...test.pdf_meta, key, tolerance: tol, key_later: false },
  });
  return { score, max: test.max_score, scoredRows };
}
