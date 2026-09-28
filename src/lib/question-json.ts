// ─── Question JSON parsing / validation — one canonical implementation ──────
// Consumers: QuestionBank JSON import (manual paste/file) and the AI PDF
// extraction panel (model output goes through the exact same validator, so
// bad AI rows are caught by the same rules the user's own JSON is held to).
import { uid, type Question, type Subject } from "./types";

/** The documented example shown in the import UI + downloaded as sample. */
export const IMPORT_EXAMPLE = `[
  {
    "subject": "Physics",
    "chapter": "Kinematics",
    "type": "MCQ",
    "question": "A car starts from rest and reaches 20 m/s in 5 s. Its acceleration is:",
    "options": ["2 m/s²", "4 m/s²", "5 m/s²", "10 m/s²"],
    "answer": 1,
    "source": "NCERT Ch-3"
  },
  {
    "subject": "Chemistry",
    "chapter": "Some Basic Concepts of Chemistry (Mole Concept)",
    "type": "numerical",
    "question": "The number of moles in 44 g of CO2 is:",
    "answer": 1,
    "tolerance": 0.01
  }
]`;

export function normalizeSubject(v: unknown): Subject | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (s.startsWith("phy")) return "Physics";
  if (s.startsWith("che")) return "Chemistry";
  if (s.startsWith("mat")) return "Mathematics"; // math / maths / mathematics
  return null;
}

export function normalizeType(v: unknown): "MCQ" | "numerical" | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "mcq" || s === "objective") return "MCQ";
  if (["numerical", "num", "numeric", "integer"].includes(s)) return "numerical";
  return null;
}

export function parseQuestionsJson(raw: string): {
  ok: Question[];
  errors: { row: number; msg: string }[];
} {
  const out: { ok: Question[]; errors: { row: number; msg: string }[] } = { ok: [], errors: [] };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    out.errors.push({ row: 0, msg: `Invalid JSON — ${(e as Error).message}` });
    return out;
  }
  if (data && !Array.isArray(data) && typeof data === "object") {
    const qArr = (data as Record<string, unknown>)["questions"];
    if (Array.isArray(qArr)) data = qArr;
  }
  if (!Array.isArray(data)) {
    out.errors.push({ row: 0, msg: 'Top level must be an array of question objects (or {"questions": [...]})' });
    return out;
  }
  const now = Date.now();
  data.forEach((item, i) => {
    const row = i + 1;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      out.errors.push({ row, msg: "not a question object" });
      return;
    }
    const q = item as Record<string, unknown>;
    const subject = normalizeSubject(q.subject);
    if (!subject) {
      out.errors.push({ row, msg: `subject "${String(q.subject)}" must be Physics / Chemistry / Mathematics` });
      return;
    }
    const chapter = String(q.chapter ?? "").trim();
    if (!chapter) {
      out.errors.push({ row, msg: "chapter is required" });
      return;
    }
    const text = String(q.question ?? q.text ?? "").trim();
    if (!text) {
      out.errors.push({ row, msg: "question text is required" });
      return;
    }
    const type = normalizeType(q.type);
    if (!type) {
      out.errors.push({ row, msg: `type "${String(q.type)}" must be MCQ or numerical` });
      return;
    }
    let options: string[] = [];
    let answer: number | string;
    let tolerance = 0;
    if (type === "MCQ") {
      if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 6) {
        out.errors.push({ row, msg: "MCQ needs an options array of 2-6 strings" });
        return;
      }
      options = q.options.map((o) => String(o));
      const ans: unknown = q.answer;
      if (typeof ans === "number" && Number.isInteger(ans) && ans >= 0 && ans < options.length) {
        answer = ans; // 0-based index (A=0, B=1, C=2, D=3)
      } else if (typeof ans === "string" && /^[A-Fa-f]$/.test(ans.trim())) {
        const idx = ans.trim().toUpperCase().charCodeAt(0) - 65;
        if (idx >= options.length) {
          out.errors.push({ row, msg: `answer "${ans}" out of range for ${options.length} options` });
          return;
        }
        answer = idx;
      } else if (typeof ans === "string" && ans.trim()) {
        const idx = options.findIndex((o) => o.trim().toLowerCase() === ans.trim().toLowerCase());
        if (idx === -1) {
          out.errors.push({ row, msg: 'answer must be a 0-based index, a letter (A-D), or exact option text' });
          return;
        }
        answer = idx;
      } else {
        out.errors.push({ row, msg: "answer must be the 0-based option index (A=0, B=1, ...)" });
        return;
      }
    } else {
      const num = typeof q.answer === "number" ? q.answer : parseFloat(String(q.answer ?? ""));
      if (!Number.isFinite(num)) {
        out.errors.push({ row, msg: "numerical answer must be a number" });
        return;
      }
      answer = num;
      if (q.tolerance !== undefined && q.tolerance !== "") {
        const t = typeof q.tolerance === "number" ? q.tolerance : parseFloat(String(q.tolerance));
        if (!Number.isFinite(t) || t < 0) {
          out.errors.push({ row, msg: "tolerance must be a non-negative number" });
          return;
        }
        tolerance = t;
      }
    }
    const image = typeof q.image === "string" && q.image.startsWith("data:image") ? q.image : undefined;
    out.ok.push({
      id: uid(),
      question: text,
      options,
      answer,
      tolerance,
      type,
      subject,
      chapter,
      source: typeof q.source === "string" && q.source.trim() ? q.source.trim() : "JSON import",
      source_url: typeof q.source_url === "string" && q.source_url.trim() ? q.source_url.trim() : undefined,
      image,
      created_at: now,
    });
  });
  return out;
}
