"use client";

// ─── PdfExtractPanel — drop a question-bank PDF, AI turns it into bank rows ──
// pdf.js pulls the text layer → chunks → one JSON-mode AI call per chunk →
// every model row is validated through the SAME parseQuestionsJson validator
// as manual JSON import → user reviews/edits/deletes → import. Scanned PDFs
// (no text layer) are rejected up front with an honest explanation.
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { EmptyNote, SectionCard } from "../shared";
import { FileDrop } from "../FileDrop";
import { bulkPut } from "@/lib/idb";
import { SUBJECTS, type Question } from "@/lib/types";
import { parseQuestionsJson } from "@/lib/question-json";
import {
  AIConfigError,
  AIProviderError,
  callAI,
  chunkText,
  extractPdfText,
  parseLooseJson,
} from "@/lib/ai";

const LETTERS = ["A", "B", "C", "D"];
const MAX_QUESTIONS = 300;

/** Model row as produced (pre-validation) — validated through parseQuestionsJson. */
interface RawRow {
  subject?: unknown;
  chapter?: unknown;
  type?: unknown;
  question?: unknown;
  options?: unknown;
  answer?: unknown;
  tolerance?: unknown;
}

interface RowState {
  key: number;
  raw: RawRow;
  question: Question | null;
  error: string | null;
  deleted: boolean;
}

function revalidate(raw: RawRow, source: string): { question: Question | null; error: string | null } {
  // the canonical validator decides — one rulebook for manual JSON and AI output
  const res = parseQuestionsJson(JSON.stringify([raw]));
  if (res.ok.length === 1) {
    return { question: { ...res.ok[0], source }, error: null };
  }
  const msg = res.errors[0]?.msg ?? "unparseable";
  // rows the model skipped options for on purpose → offer as numerical fallback
  if (/MCQ needs an options array/.test(msg) && normalizeTypeLoose(raw.type) === "MCQ") {
    return { question: null, error: "no options in the PDF text — fix or delete this row" };
  }
  return { question: null, error: msg };
}

function normalizeTypeLoose(v: unknown): string {
  return String(v ?? "").toLowerCase();
}

const EXTRACT_SYSTEM =
  "You are a precise question-extraction engine for JEE question papers. " +
  "Output ONLY valid JSON — no markdown fences, no commentary, no explanations.";

function extractPrompt(chunk: string, paperName: string): string {
  return [
    "Extract every COMPLETE, self-contained question from this part of a JEE paper.",
    "Return JSON exactly in this shape:",
    '{"questions":[{"subject":"Physics|Chemistry|Mathematics","chapter":"best-guess JEE chapter name","type":"MCQ|numerical","question":"full question text in plain text","options":["opt1","opt2","opt3","opt4"],"answer":0,"tolerance":0,"source":"' +
      paperName +
      '"}]}',
    "",
    "Rules:",
    "- subject: Physics / Chemistry / Mathematics — infer from the section or content.",
    "- type MCQ → options MUST be the 4 option texts (strip (1)/(A)/(a) prefixes), answer = 0-based index of the correct option (A=0, B=1, C=2, D=3).",
    "- type numerical → no options key; answer = the numeric answer (solve it); tolerance 0 unless stated.",
    "- The answer is YOUR best solved answer — it will be shown for human review, so attempt every question seriously.",
    "- Skip instructions, headings, blank fragments, and continuation stubs without a full question.",
    "- Plain text only: write x^2, CO2, sqrt(), -> instead of LaTeX or unicode math.",
    "- If this part contains no complete questions, return {\"questions\":[]}.",
    "",
    "PAPER PART:",
    chunk,
  ].join("\n");
}

export function PdfExtractPanel({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<"idle" | "reading" | "extracting" | "review">("idle");
  const [pdfName, setPdfName] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>("");
  const [rows, setRows] = useState<RowState[]>([]);
  const [sourceName, setSourceName] = useState("AI PDF extract");

  const validRows = useMemo(() => rows.filter((r) => !r.deleted && r.question), [rows]);
  const errorRows = useMemo(() => rows.filter((r) => !r.deleted && !r.question), [rows]);

  async function handleFile(file: File) {
    if (!file || phase === "reading" || phase === "extracting") return;
    // local const — the setState value would be stale inside this async closure
    const srcName = `AI extract · ${file.name.replace(/\.pdf$/i, "").slice(0, 40)}`;
    setPdfName(file.name);
    setSourceName(srcName);
    setPhase("reading");
    setRows([]);
    setProgress("Reading PDF text…");

    let text = "";
    try {
      text = await extractPdfText(file, (p, total) =>
        setProgress(`Reading PDF text — page ${p}/${total}…`)
      );
    } catch (e) {
      setPhase("idle");
      toast.error(`Could not read that PDF: ${(e as Error).message}`);
      return;
    }

    if (text.replace(/\s/g, "").length < 200) {
      setPhase("idle");
      toast.error(
        "No readable text — this PDF looks scanned (image-only). AI extraction needs a digital PDF with a text layer."
      );
      return;
    }

    setPhase("extracting");
    const chunks = chunkText(text);
    const acc: RowState[] = [];
    let key = 0;
    for (let i = 0; i < chunks.length; i++) {
      setProgress(`AI extracting — part ${i + 1} of ${chunks.length}… (${acc.length} questions so far)`);
      try {
        const { text: out } = await callAI({
          feature: "extract",
          system: EXTRACT_SYSTEM,
          user: extractPrompt(chunks[i], sourceName),
          jsonMode: true,
          temperature: 0,
        });
        const parsed = parseLooseJson<{ questions?: RawRow[] }>(out);
        const qs = Array.isArray(parsed?.questions) ? parsed!.questions! : [];
        for (const raw of qs.slice(0, MAX_QUESTIONS - acc.length)) {
          const v = revalidate(raw, srcName);
          acc.push({ key: key++, raw, ...v, deleted: false });
        }
      } catch (e) {
        if (e instanceof AIConfigError) {
          setPhase("idle");
          toast.error(e.message);
          return;
        }
        // one bad chunk shouldn't kill the whole extraction
        if (!(e instanceof AIProviderError)) {
          setPhase("idle");
          toast.error((e as Error).message);
          return;
        }
        toast.warning(`Part ${i + 1} failed — ${((e as Error).message || "").slice(0, 120)}`);
      }
      if (acc.length >= MAX_QUESTIONS) break;
    }

    if (acc.length === 0) {
      setPhase("idle");
      toast.error("No questions could be extracted from this PDF.");
      return;
    }
    setRows(acc);
    setPhase("review");
    setProgress("");
    toast.success(`${acc.length} questions extracted — review below, then import`);
  }

  function editRow(key: number, patch: Partial<RawRow>) {
    setRows((rs) =>
      rs.map((r) => {
        if (r.key !== key) return r;
        const raw = { ...r.raw, ...patch };
        const v = revalidate(raw, sourceName);
        return { ...r, raw, ...v };
      })
    );
  }

  async function importAll() {
    if (validRows.length === 0) return;
    await bulkPut("questions", validRows.map((r) => r.question!));
    toast.success(`Imported ${validRows.length} question${validRows.length === 1 ? "" : "s"} from ${pdfName ?? "PDF"}`);
    onClose();
  }

  const busy = phase === "reading" || phase === "extracting";

  return (
    <SectionCard
      title="AI extract: PDF → Question Bank"
      subtitle="drop a digital question-bank PDF — the AI pulls out questions, options and answers for your review"
      action={
        <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
          Close
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="bg-amber-50 border border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/25 rounded-lg px-3.5 py-2.5 text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
          <strong>How it works:</strong> the PDF&apos;s text layer is split into parts; each part is
          one cheap AI call. Answers are the model&apos;s best attempt — <strong>always skim the
          review list before importing</strong> (edit or delete any row). Scanned/image-only PDFs
          can&apos;t be read — those need text.
        </div>

        {phase === "idle" ? (
          <FileDrop
            accept="application/pdf,.pdf"
            label={pdfName ? `Try again: ${pdfName}` : "Drop a question-bank PDF here — or click to browse"}
            hint="digital PDF with selectable text · coaching modules, PYQ books, question sets"
            onFiles={(files) => void handleFile(files[0])}
          />
        ) : null}

        {busy ? (
          <div className="rounded-lg border border-border bg-muted/40 px-4 py-6 text-center space-y-2">
            <div className="flex items-center justify-center gap-2 text-sm font-medium text-foreground">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse" aria-hidden="true" />
              {progress || "Working…"}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Roughly ₹0.3–0.6 per 20-page paper on DeepSeek — you&apos;ll see exact usage in AI settings.
            </p>
          </div>
        ) : null}

        {phase === "review" ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-sage-600 dark:bg-sage-500 hover:bg-sage-600 dark:hover:bg-sage-500 text-white dark:text-sage-950 border-0">
                {validRows.length} ready
              </Badge>
              {errorRows.length > 0 ? (
                <Badge variant="outline" className="border-red-300 text-red-700 dark:border-red-500/40 dark:text-red-300">
                  {errorRows.length} need fixing
                </Badge>
              ) : null}
              <div className="ml-auto flex gap-2">
                <Button
                  size="sm"
                  onClick={() => void importAll()}
                  disabled={validRows.length === 0}
                  className="bg-emerald-700 hover:bg-emerald-800 dark:bg-emerald-500 dark:hover:bg-emerald-600 dark:text-emerald-950"
                >
                  Import {validRows.length} question{validRows.length === 1 ? "" : "s"}
                </Button>
              </div>
            </div>

            {rows.length === 0 ? (
              <EmptyNote>Nothing extracted.</EmptyNote>
            ) : (
              <ul className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
                {rows.map((r) => (
                  <li
                    key={r.key}
                    className={cn(
                      "border rounded-lg p-3 transition-colors",
                      r.deleted
                        ? "border-border/50 bg-muted/20 opacity-50"
                        : r.question
                          ? "border-border hover:bg-accent/40"
                          : "border-red-200 bg-red-50/40 dark:border-red-500/30 dark:bg-red-500/5"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0 flex-1 space-y-2">
                        <p className="text-sm text-foreground leading-snug">
                          {String(r.raw.question ?? "(no text)")}
                        </p>
                        {!r.question && r.error ? (
                          <p className="text-xs text-red-600 dark:text-red-400">{r.error}</p>
                        ) : null}
                        {r.question && r.question.type === "MCQ" ? (
                          <p className="text-[11px] text-muted-foreground truncate" title={r.question.options.join(" · ")}>
                            Correct:{" "}
                            <span className="text-sage-700 dark:text-sage-400 font-medium">
                              {LETTERS[r.question.answer as number]} · {r.question.options[r.question.answer as number]}
                            </span>
                          </p>
                        ) : r.question ? (
                          <p className="text-[11px] text-muted-foreground">
                            Answer:{" "}
                            <span className="text-sage-700 dark:text-sage-400 font-medium">
                              {r.question.answer as number}
                              {r.question.tolerance ? ` ± ${r.question.tolerance}` : " (exact)"}
                            </span>
                          </p>
                        ) : null}
                        <div className="flex flex-wrap gap-2 items-center">
                          <div className="w-36">
                            <Select
                              value={String(r.raw.subject ?? "")}
                              onValueChange={(v) => editRow(r.key, { subject: v })}
                            >
                              <SelectTrigger className="h-7 text-[11px]" aria-label="Subject">
                                <SelectValue placeholder="subject" />
                              </SelectTrigger>
                              <SelectContent>
                                {SUBJECTS.map((s) => (
                                  <SelectItem key={s} value={s}>{s}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="flex-1 min-w-[140px]">
                            <Input
                              value={String(r.raw.chapter ?? "")}
                              onChange={(e) => editRow(r.key, { chapter: e.target.value })}
                              className="h-7 text-[11px]"
                              placeholder="chapter"
                              aria-label="Chapter"
                            />
                          </div>
                        </div>
                      </div>
                      <div className="shrink-0 flex flex-col gap-1 items-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          className={cn(
                            "h-7 text-xs",
                            r.deleted ? "text-muted-foreground" : "text-red-500 dark:text-red-400 hover:text-red-600"
                          )}
                          onClick={() =>
                            setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, deleted: !x.deleted } : x)))
                          }
                        >
                          {r.deleted ? "Undo" : "Delete"}
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : null}

        {phase === "idle" ? (
          <p className="text-[11px] text-muted-foreground/70">
            Extracted questions land in the bank tagged{" "}
            <code className="font-mono">AI extract · &lt;paper&gt;</code> so you can filter them later.
          </p>
        ) : null}
      </div>
    </SectionCard>
  );
}
