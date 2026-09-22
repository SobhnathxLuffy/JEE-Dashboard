"use client";

// ─── Page-Mode PDF import: upload → range → paste key → take test ───────────
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import type { NavController } from "./App";
import { EmptyNote, PageTitle, SectionCard } from "./shared";
import { useLive, kvSet } from "@/lib/idb";
import {
  SUBJECTS,
  uid,
  type ActiveSession,
  type Subject,
} from "@/lib/types";

interface ParsedKey {
  no: number;
  answer: string;
}

function parseAnswerKey(text: string): ParsedKey[] {
  const out: ParsedKey[] = [];
  const re =
    /(\d{1,3})\s*[.):\-]?\s*([A-Da-d])(?![A-Za-z0-9])|(\d{1,3})\s*[.):\-]\s*(\d+(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[1] !== undefined && m[2] !== undefined) {
      out.push({ no: Number(m[1]), answer: m[2].toUpperCase() });
    } else if (m[3] !== undefined && m[4] !== undefined) {
      out.push({ no: Number(m[3]), answer: m[4] });
    }
  }
  // dedupe by question number (last wins)
  const map = new Map<number, string>();
  for (const k of out) map.set(k.no, k.answer);
  return [...map.entries()]
    .map(([no, answer]) => ({ no, answer }))
    .sort((a, b) => a.no - b.no);
}

export function PdfImportView({ nav }: { nav: NavController }) {
  const syllabus = useLive("syllabus");
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [loading, setLoading] = useState(false);

  const [subject, setSubject] = useState<Subject>("Physics");
  const [chapter, setChapter] = useState("");
  const [startPage, setStartPage] = useState("1");
  const [endPage, setEndPage] = useState("1");
  const [totalQ, setTotalQ] = useState("10");
  const [duration, setDuration] = useState("10");
  const [keyText, setKeyText] = useState("");
  const [name, setName] = useState("");

  const parsedKey = useMemo(() => parseAnswerKey(keyText), [keyText]);

  const chapters = useMemo(
    () => syllabus.filter((s) => s.subject === subject).map((s) => s.chapter),
    [syllabus, subject]
  );

  const keyCoverage = useMemo(() => {
    const total = Number(totalQ) || 0;
    const have = new Set(parsedKey.map((k) => k.no));
    const missing: number[] = [];
    for (let i = 1; i <= total; i++) {
      if (!have.has(i)) missing.push(i);
    }
    return { found: total - missing.length, missing };
  }, [parsedKey, totalQ]);

  async function onFile(file: File) {
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("That's not a PDF");
      return;
    }
    setLoading(true);
    try {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const buf = await file.arrayBuffer();
      const doc = await pdfjs.getDocument({ data: buf.slice(0) }).promise;
      setNumPages(doc.numPages);
      doc.destroy();
      setBlob(file);
      setFileName(file.name);
      setEndPage(String(Math.min(5, doc.numPages)));
      if (!name) setName(`PDF test — ${file.name.replace(/\.pdf$/i, "").slice(0, 40)}`);
      toast.success(`Loaded ${doc.numPages} pages`);
    } catch (e) {
      toast.error(`Could not read PDF: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  async function startTest() {
    const sp = Number(startPage) || 1;
    const ep = Number(endPage) || sp;
    const tq = Number(totalQ) || 0;
    if (!blob) {
      toast.error("Upload a PDF first");
      return;
    }
    if (tq <= 0) {
      toast.error("Total questions must be ≥ 1");
      return;
    }
    if (parsedKey.length === 0) {
      toast.error("Answer key did not parse — paste something like: 1. A  2. C  3. B");
      return;
    }
    if (keyCoverage.missing.length > 0) {
      const ok = window.confirm(
        `${keyCoverage.missing.length} of ${tq} questions have no key (${keyCoverage.missing
          .slice(0, 8)
          .join(", ")}${keyCoverage.missing.length > 8 ? "…" : ""}). They will be scored as unattempted. Start anyway?`
      );
      if (!ok) return;
    }
    const session: ActiveSession = {
      key: "active",
      test_id: uid(),
      mode: "pdf",
      test_type: "pdf",
      name: name.trim() || "PDF test",
      subject_order: [subject],
      question_ids: [],
      pdf_meta: {
        subject,
        chapter: chapter || "PDF questions",
        start_page: sp,
        end_page: Math.max(sp, ep),
        total_questions: tq,
        key: parsedKey,
      },
      duration_min: Math.max(1, Number(duration) || 1),
      started_at: Date.now(),
      answers: {},
      marked: [],
      current: 0,
      q_times: {},
      q_entered_at: Date.now(),
    };
    await kvSet("pdf-blob", blob);
    nav.startSession(session, blob);
  }

  return (
    <div className="space-y-6">
      <PageTitle
        title="Page-Mode PDF Test"
        subtitle="Scanned Arihant pages, NTA papers, coaching sheets — anything. Keep the NTA answer-key tab open while pasting keys."
      />

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <SectionCard title="1 · Upload PDF" subtitle="stays local — never uploaded anywhere">
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full border-2 border-dashed border-stone-300 rounded-xl px-6 py-10 text-center hover:border-emerald-500 hover:bg-emerald-50/40 transition-colors"
            >
              <div className="text-sm font-medium text-stone-700">
                {loading ? "Reading PDF…" : fileName ? `✓ ${fileName}` : "Click to choose a PDF file"}
              </div>
              {numPages > 0 ? (
                <div className="text-xs text-stone-400 mt-1">{numPages} pages detected</div>
              ) : (
                <div className="text-xs text-stone-400 mt-1">
                  rendered locally with pdf.js — no upload
                </div>
              )}
            </button>
          </SectionCard>

          <SectionCard title="2 · Map questions to pages" subtitle="e.g. pages 3–15 hold Q1–50">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Subject</Label>
                <Select
                  value={subject}
                  onValueChange={(v) => {
                    setSubject(v as Subject);
                    setChapter("");
                  }}
                >
                  <SelectTrigger aria-label="Subject"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SUBJECTS.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Chapter label</Label>
                <Select value={chapter} onValueChange={setChapter}>
                  <SelectTrigger aria-label="Chapter">
                    <SelectValue placeholder="pick or leave generic" />
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    <SelectItem value="PDF questions">PDF questions (generic)</SelectItem>
                    {chapters.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Start page</Label>
                <Input value={startPage} onChange={(e) => setStartPage(e.target.value)} inputMode="numeric" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">End page</Label>
                <Input value={endPage} onChange={(e) => setEndPage(e.target.value)} inputMode="numeric" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Total questions</Label>
                <Input value={totalQ} onChange={(e) => setTotalQ(e.target.value)} inputMode="numeric" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Duration (min)</Label>
                <Input value={duration} onChange={(e) => setDuration(e.target.value)} inputMode="numeric" />
              </div>
            </div>
            <div className="space-y-1.5 mt-3">
              <Label className="text-xs">Test name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Arihant Electrostatics drill" />
            </div>
          </SectionCard>
        </div>

        <div className="space-y-6">
          <SectionCard
            title="3 · Paste the answer key"
            subtitle="formats: “1. A  2. C”, “1A 2C 3B”, “1. 42  2. 17” — numbers and letters both work"
          >
            <Textarea
              value={keyText}
              onChange={(e) => setKeyText(e.target.value)}
              rows={7}
              placeholder={"1. A\n2. C\n3. B\n4. D\n5. 42"}
              className="font-mono text-sm"
            />
            {parsedKey.length > 0 ? (
              <div className="mt-3 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className="bg-emerald-700 hover:bg-emerald-700 text-white border-0">
                    {parsedKey.length} keys parsed
                  </Badge>
                  {Number(totalQ) > 0 ? (
                    keyCoverage.missing.length === 0 ? (
                      <Badge variant="outline" className="border-emerald-300 text-emerald-700">
                        full coverage of Q1–{totalQ}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-amber-400 text-amber-700">
                        missing: {keyCoverage.missing.slice(0, 10).join(", ")}
                        {keyCoverage.missing.length > 10 ? ` +${keyCoverage.missing.length - 10}` : ""}
                      </Badge>
                    )
                  ) : null}
                </div>
                <div className="text-xs text-stone-500 bg-stone-50 border border-stone-200 rounded-lg p-2 font-mono max-h-24 overflow-y-auto">
                  {parsedKey.slice(0, 60).map((k) => `${k.no}:${k.answer}`).join("  ")}
                  {parsedKey.length > 60 ? " …" : ""}
                </div>
              </div>
            ) : (
              <EmptyNote>Paste a key above — the parser preview appears here.</EmptyNote>
            )}
          </SectionCard>

          <SectionCard title="4 · Start" subtitle="pages render inside the player next to the palette">
            <ul className="text-xs text-stone-500 space-y-1.5 list-disc pl-4 mb-4">
              <li>The player shows the page holding the current question and follows you as you move.</li>
              <li>Answer A–D or type numbers, exactly like the key.</li>
              <li>Scoring is automatic at submit — then tag every mistake.</li>
            </ul>
            <Button
              className="w-full bg-emerald-700 hover:bg-emerald-800"
              disabled={!blob || parsedKey.length === 0}
              onClick={() => void startTest()}
            >
              Start PDF test
            </Button>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
