"use client";

// ─── Page-Mode PDF import: upload → structure → answer-key grid → start ─────
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { cn } from "@/lib/utils";
import type { NavController } from "./App";
import { EmptyNote, PageTitle, SectionCard } from "./shared";
import { useLive, kvSet, getAll, put } from "@/lib/idb";
import {
  SUBJECTS,
  uid,
  type ActiveSession,
  type PaperRecord,
  type PdfKeyEntry,
  type PdfSection,
  type Subject,
} from "@/lib/types";
import {
  extractKeyTextFromPdf,
  NUM_RE,
  parseAnswerKey,
  parseCell,
} from "@/lib/pdf-key";

const DURATION_PRESETS = [15, 30, 60, 90, 180];
const MAX_GRID_CELLS = 300; // render guard against typo'd totals (coverage still computed fully)

interface SectionRowState {
  chapter: string; // "" = generic
  first_q: string;
  last_q: string;
  start_page: string;
  end_page: string;
}

const emptyRow = (): SectionRowState => ({
  chapter: "",
  first_q: "",
  last_q: "",
  start_page: "1",
  end_page: "1",
});

export function PdfImportView({
  nav,
  initialPaper,
}: {
  nav: NavController;
  initialPaper?: PaperRecord;
}) {
  const syllabus = useLive("syllabus");
  const fileRef = useRef<HTMLInputElement>(null);
  const keyFileRef = useRef<HTMLInputElement>(null);
  // Coming from the Papers library: the blob arrives in memory, no re-upload.
  // App remounts this view with key={paper.id}, so lazy initializers are safe.
  const [fileName, setFileName] = useState<string | null>(initialPaper?.name ?? null);
  const [blob, setBlob] = useState<Blob | null>(initialPaper?.data ?? null);
  const [numPages, setNumPages] = useState(initialPaper?.num_pages ?? 0);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const [mode, setMode] = useState<"single" | "full">("single");
  const [subject, setSubject] = useState<Subject>("Physics");
  const [chapter, setChapter] = useState("");
  const [startPage, setStartPage] = useState("1");
  const [endPage, setEndPage] = useState(
    initialPaper ? String(Math.min(5, initialPaper.num_pages)) : "1"
  );
  const [totalQ, setTotalQ] = useState("10");
  const [firstQ, setFirstQ] = useState("1");
  const [duration, setDuration] = useState("10");
  const [tolerance, setTolerance] = useState("0");
  const [optionNums, setOptionNums] = useState(false);
  const [keyLater, setKeyLater] = useState(false);
  const [optHintDismissed, setOptHintDismissed] = useState(false);
  const [name, setName] = useState(() =>
    initialPaper
      ? `PDF test — ${initialPaper.name.replace(/\.pdf$/i, "").slice(0, 40)}`
      : ""
  );
  const [rows, setRows] = useState<Record<Subject, SectionRowState>>({
    Physics: { ...emptyRow(), first_q: "1", last_q: "25" },
    Chemistry: { ...emptyRow(), first_q: "26", last_q: "50" },
    Mathematics: { ...emptyRow(), first_q: "51", last_q: "75" },
  });

  const [keyText, setKeyText] = useState("");
  const [keyFileName, setKeyFileName] = useState<string | null>(null);
  const [keyLoading, setKeyLoading] = useState(false);
  const [grid, setGrid] = useState<Record<number, string>>({});
  const editedRef = useRef<Set<number>>(new Set()); // cells typed by hand — paste refill skips them

  const parsedKey = useMemo(() => parseAnswerKey(keyText), [keyText]);

  const chaptersBySubject = useMemo(() => {
    const m = new Map<Subject, string[]>();
    for (const s of SUBJECTS) {
      m.set(s, syllabus.filter((r) => r.subject === s).map((r) => r.chapter));
    }
    return m;
  }, [syllabus]);

  const chapters = useMemo(
    () => chaptersBySubject.get(subject) ?? [],
    [chaptersBySubject, subject]
  );

  // ── paper numbering: palette/paper range = firstQ .. firstQ+total−1 ──
  const firstQN = useMemo(() => {
    if (mode === "full") {
      return Math.min(...SUBJECTS.map((s) => Number(rows[s].first_q) || 1));
    }
    return Number(firstQ) || 1;
  }, [mode, rows, firstQ]);

  const paperTotal = useMemo(() => {
    if (mode === "full") {
      const last = Math.max(...SUBJECTS.map((s) => Number(rows[s].last_q) || 1));
      return Math.max(0, last - firstQN + 1);
    }
    return Number(totalQ) || 0;
  }, [mode, rows, firstQN, totalQ]);

  const paperNos = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < paperTotal; i++) out.push(firstQN + i);
    return out;
  }, [firstQN, paperTotal]);

  // paste/key-PDF parse → bulk-fill the grid (manually edited cells always win)
  useEffect(() => {
    if (parsedKey.length === 0) return;
    setGrid((g) => {
      const next = { ...g };
      for (const k of parsedKey) {
        if (editedRef.current.has(k.no)) continue;
        next[k.no] = k.bonus ? "bonus" : k.answers ? k.answers.join("/") : k.answer;
      }
      return next;
    });
  }, [parsedKey]);

  // re-arm the option-number hint when a different key is pasted
  useEffect(() => {
    setOptHintDismissed(false);
  }, [parsedKey.length]);

  // ── A1 auto-suggest: ≥80% of parsed numeric values ∈ {1,2,3,4} ──
  const optNumSuggest = useMemo(() => {
    if (optionNums) return false;
    const nums = parsedKey.filter((k) => !k.bonus && NUM_RE.test(k.answer));
    if (nums.length < 4) return false;
    const inRange = nums.filter((k) => ["1", "2", "3", "4"].includes(k.answer));
    return inRange.length / nums.length >= 0.8;
  }, [parsedKey, optionNums]);

  // authoritative key: grid cells over the paper range (toggle mapping applied live)
  const gridKey = useMemo(() => {
    const out: PdfKeyEntry[] = [];
    for (const no of paperNos) {
      const raw = grid[no];
      if (raw === undefined) continue;
      const r = parseCell(raw, optionNums);
      if (r.kind === "entry") out.push({ ...r.entry, no });
    }
    return out;
  }, [paperNos, grid, optionNums]);

  const coverage = useMemo(() => {
    const have = new Set(gridKey.map((k) => k.no));
    const missing = paperNos.filter((no) => !have.has(no));
    return { found: gridKey.length, missing };
  }, [gridKey, paperNos]);

  function setCell(no: number, raw: string) {
    editedRef.current.add(no);
    setGrid((g) => {
      const next = { ...g };
      if (raw.trim() === "") delete next[no];
      else next[no] = raw;
      return next;
    });
  }

  function clearGrid() {
    if (Object.keys(grid).length === 0) return;
    if (!window.confirm("Clear all key cells? You can re-fill them from the paste box.")) return;
    editedRef.current = new Set();
    setGrid({});
  }

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
      // persist immediately — a refresh before Start must not lose the file
      await kvSet("pdf-blob", file);
      toast.success(`Loaded ${doc.numPages} pages`);
      // Papers library: keep the file so future imports skip the upload
      try {
        const existing = (await getAll("papers")).find(
          (p) => p.name === file.name && p.size === file.size
        );
        if (existing) {
          await put("papers", {
            ...existing,
            num_pages: doc.numPages,
            last_used_at: Date.now(),
            data: file,
          });
        } else {
          await put("papers", {
            id: uid(),
            name: file.name,
            size: file.size,
            num_pages: doc.numPages,
            added_at: Date.now(),
            data: file,
          });
          toast.info("Saved to Papers library — reuse it anytime without re-uploading");
        }
      } catch {
        // library save is best-effort — the test itself can still start
      }
    } catch (e) {
      toast.error(`Could not read PDF: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  // ── A4: digital key-PDF → text layer → same parser → grid + textarea ──
  async function onKeyFile(file: File) {
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("That's not a PDF");
      return;
    }
    setKeyLoading(true);
    try {
      const text = await extractKeyTextFromPdf(file);
      const parsed = parseAnswerKey(text);
      if (parsed.length < 2) {
        toast.error("No readable text — this key looks scanned. Paste it instead.");
        return;
      }
      setKeyFileName(file.name);
      setKeyText(text); // fills grid via the paste effect
      toast.success(`${parsed.length} keys extracted from key PDF`);
    } catch (e) {
      toast.error(`Could not read key PDF: ${String(e)}`);
    } finally {
      setKeyLoading(false);
    }
  }

  async function startTest() {
    if (!blob) {
      toast.error("Upload a PDF first");
      return;
    }
    const tol = Math.max(0, Number(tolerance) || 0);
    let meta: NonNullable<ActiveSession["pdf_meta"]>;
    let subjectOrder: Subject[];

    if (mode === "full") {
      const secs: PdfSection[] = [];
      for (const s of SUBJECTS) {
        const r = rows[s];
        const fq = Number(r.first_q);
        const lq = Number(r.last_q);
        const spg = Number(r.start_page);
        const epg = Number(r.end_page);
        if (!Number.isFinite(fq) || !Number.isFinite(lq) || fq < 1 || lq < fq) {
          toast.error(`${s}: check first / last question numbers`);
          return;
        }
        if (!Number.isFinite(spg) || !Number.isFinite(epg) || spg < 1 || epg < spg) {
          toast.error(`${s}: check start / end pages`);
          return;
        }
        secs.push({
          subject: s,
          chapter: r.chapter || `${s} questions`,
          first_q: fq,
          last_q: lq,
          start_page: spg,
          end_page: epg,
        });
      }
      secs.sort((a, b) => a.first_q - b.first_q);
      for (let i = 1; i < secs.length; i++) {
        if (secs[i].first_q <= secs[i - 1].last_q) {
          toast.error("Sections overlap in question numbers — fix the section rows");
          return;
        }
      }
      meta = {
        subject: secs[0].subject,
        chapter: "Full paper",
        start_page: Math.min(...secs.map((s) => s.start_page)),
        end_page: Math.max(...secs.map((s) => s.end_page)),
        total_questions: secs[secs.length - 1].last_q - secs[0].first_q + 1,
        key: keyLater ? [] : gridKey,
        key_later: keyLater,
        sections: secs,
        first_q: secs[0].first_q,
        tolerance: tol,
      };
      subjectOrder = [...SUBJECTS];
    } else {
      const sp = Number(startPage) || 1;
      const ep = Number(endPage) || sp;
      const tq = Number(totalQ) || 0;
      const fq = Number(firstQ) || 1;
      if (tq <= 0) {
        toast.error("Total questions must be ≥ 1");
        return;
      }
      if (fq < 1) {
        toast.error("First question # must be ≥ 1");
        return;
      }
      const chap = chapter || "PDF questions";
      meta = {
        subject,
        chapter: chap,
        start_page: sp,
        end_page: Math.max(sp, ep),
        total_questions: tq,
        key: keyLater ? [] : gridKey,
        key_later: keyLater,
        sections: [
          {
            subject,
            chapter: chap,
            first_q: fq,
            last_q: fq + tq - 1,
            start_page: sp,
            end_page: Math.max(sp, ep),
          },
        ],
        first_q: fq,
        tolerance: tol,
      };
      subjectOrder = [subject];
    }

    if (!keyLater && gridKey.length === 0) {
      toast.error("Answer key is empty — paste the key, upload a digital key PDF, fill the grid, or switch on “score later”");
      return;
    }
    if (!keyLater && coverage.missing.length > 0) {
      const ok = window.confirm(
        `${coverage.missing.length} of ${paperTotal} questions have no key (${coverage.missing
          .slice(0, 8)
          .join(", ")}${coverage.missing.length > 8 ? "…" : ""}). They will be scored as unattempted. Start anyway?`
      );
      if (!ok) return;
    }

    const session: ActiveSession = {
      key: "active",
      test_id: uid(),
      mode: "pdf",
      test_type: "pdf",
      name: name.trim() || "PDF test",
      subject_order: subjectOrder,
      question_ids: [],
      pdf_meta: meta,
      duration_min: Math.max(1, Number(duration) || 1),
      started_at: Date.now(),
      answers: {},
      marked: [],
      current: 0,
      q_times: {},
      q_entered_at: Date.now(),
    };
    await kvSet("pdf-blob", blob); // idempotent with the file-pick write
    if (initialPaper) {
      try {
        const fresh = await (await import("@/lib/idb")).get("papers", initialPaper.id);
        if (fresh) await put("papers", { ...fresh, last_used_at: Date.now() });
      } catch {
        // usage stamp is best-effort
      }
    }
    nav.startSession(session, blob);
  }

  const renderCells = paperNos.slice(0, MAX_GRID_CELLS);

  return (
    <div className="space-y-6">
      <PageTitle
        title="Page-Mode PDF Test"
        subtitle="Scanned Arihant pages, NTA papers, coaching sheets — anything. Keep the NTA answer-key tab open while pasting keys."
      />

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <SectionCard
            title="1 · Upload PDF"
            subtitle="stays local — never uploaded anywhere · every PDF is auto-saved to the Papers library for reuse"
          >
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
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) void onFile(f);
              }}
              className={cn(
                "w-full border-2 border-dashed rounded-xl px-6 py-10 text-center transition-all",
                dragOver
                  ? "border-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 ring-2 ring-emerald-500/30"
                  : "border-border hover:border-emerald-500 dark:hover:border-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10"
              )}
              aria-label="Upload PDF: drag a file here or click to browse"
            >
              <div className="text-sm font-medium text-foreground/80">
                {loading
                  ? "Reading PDF…"
                  : fileName
                    ? `✓ ${fileName}`
                    : dragOver
                      ? "Drop to upload"
                      : "Drag the PDF here, or click to browse"}
              </div>
              {numPages > 0 ? (
                <div className="text-xs text-muted-foreground/70 mt-1">
                  {numPages} pages detected
                  {initialPaper ? " · loaded from Papers library" : " · saved to Papers library"}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground/70 mt-1">
                  rendered locally with pdf.js — no upload
                </div>
              )}
            </button>
            <p className="text-[11px] text-muted-foreground/70 mt-2">
              Already uploaded this paper?{" "}
              <button
                type="button"
                className="underline text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:text-emerald-300"
                onClick={() => nav.go("papers")}
              >
                Pick it from the Papers library
              </button>{" "}
              — no re-upload needed.
            </p>
          </SectionCard>

          <SectionCard
            title="2 · Structure"
            subtitle={mode === "single" ? "map one subject's questions to pages" : "full paper — one row per section"}
          >
            <div className="space-y-1.5 mb-4 max-w-xs">
              <Label className="text-xs">Mode</Label>
              <Select
                value={mode}
                onValueChange={(v) => setMode(v as "single" | "full")}
              >
                <SelectTrigger aria-label="Mode"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="single">Single section</SelectItem>
                  <SelectItem value="full">Full paper (3 sections)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {mode === "single" ? (
              <>
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
                    <Label className="text-xs">First question #</Label>
                    <Input
                      value={firstQ}
                      onChange={(e) => setFirstQ(e.target.value)}
                      inputMode="numeric"
                      aria-label="First question number"
                    />
                    <p className="text-[11px] text-muted-foreground/70">sheet says Q21? put 21 — the palette mirrors the paper</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Total questions</Label>
                    <Input value={totalQ} onChange={(e) => setTotalQ(e.target.value)} inputMode="numeric" />
                    <p className="text-[11px] text-muted-foreground/70">your PDF decides</p>
                  </div>
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <p className="text-[11px] text-muted-foreground/70">
                  Question numbers are the paper&apos;s own numbering. 2025 pattern preset: 25 Qs per subject — edit freely.
                </p>
                {SUBJECTS.map((s) => {
                  const r = rows[s];
                  const set = (patch: Partial<SectionRowState>) =>
                    setRows((prev) => ({ ...prev, [s]: { ...prev[s], ...patch } }));
                  return (
                    <div key={s} className="border border-border rounded-lg p-3 space-y-2 bg-muted/40">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-foreground/80">{s}</span>
                        <Select
                          value={r.chapter === "" ? "generic" : r.chapter}
                          onValueChange={(v) => set({ chapter: v === "generic" ? "" : v })}
                        >
                          <SelectTrigger className="h-8 text-xs max-w-[220px]" aria-label={`${s} chapter`}>
                            <SelectValue placeholder="chapter (generic)" />
                          </SelectTrigger>
                          <SelectContent className="max-h-64">
                            <SelectItem value="generic">PDF questions (generic)</SelectItem>
                            {(chaptersBySubject.get(s) ?? []).map((c) => (
                              <SelectItem key={c} value={c}>{c}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-4 gap-2">
                        <div className="space-y-1">
                          <Label className="text-[10px] text-muted-foreground/70">First Q</Label>
                          <Input className="h-8 text-sm" value={r.first_q} onChange={(e) => set({ first_q: e.target.value })} inputMode="numeric" aria-label={`${s} first question`} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] text-muted-foreground/70">Last Q</Label>
                          <Input className="h-8 text-sm" value={r.last_q} onChange={(e) => set({ last_q: e.target.value })} inputMode="numeric" aria-label={`${s} last question`} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] text-muted-foreground/70">Start p.</Label>
                          <Input className="h-8 text-sm" value={r.start_page} onChange={(e) => set({ start_page: e.target.value })} inputMode="numeric" aria-label={`${s} start page`} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] text-muted-foreground/70">End p.</Label>
                          <Input className="h-8 text-sm" value={r.end_page} onChange={(e) => set({ end_page: e.target.value })} inputMode="numeric" aria-label={`${s} end page`} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="space-y-1.5 mt-4">
              <Label className="text-xs">Duration (min)</Label>
              <div className="flex flex-wrap gap-1.5">
                {DURATION_PRESETS.map((p) => {
                  const hot = mode === "full" && (p === 90 || p === 180);
                  const active = Number(duration) === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setDuration(String(p))}
                      className={cn(
                        "px-3 py-1.5 rounded-full border text-xs font-medium transition-colors",
                        active
                          ? "bg-emerald-700 dark:bg-emerald-500 text-white dark:text-emerald-950 border-emerald-700 dark:border-emerald-500"
                          : hot
                            ? "border-emerald-300 dark:border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 hover:bg-emerald-100"
                            : "border-border text-muted-foreground hover:bg-accent"
                      )}
                      aria-pressed={active}
                      aria-label={`Set duration to ${p} minutes`}
                    >
                      {p}m
                    </button>
                  );
                })}
              </div>
              <Input value={duration} onChange={(e) => setDuration(e.target.value)} inputMode="numeric" className="mt-2 max-w-[120px]" aria-label="Duration minutes" />
            </div>

            <div className="space-y-1.5 mt-3">
              <Label className="text-xs">Test name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Arihant Electrostatics drill" />
            </div>
          </SectionCard>
        </div>

        <div className="space-y-6">
          <SectionCard
            title="3 · Answer key"
            subtitle="paste, upload a digital key PDF, or type into the grid — grid edits always win"
          >
            <div className="flex items-center gap-2 mb-3 bg-muted border border-border rounded-lg px-3 py-2">
              <Switch
                id="key-later"
                checked={keyLater}
                onCheckedChange={(v) => setKeyLater(v)}
                aria-label="No key — score later by self-marking"
              />
              <Label htmlFor="key-later" className="text-xs cursor-pointer">
                No answer key? Score later — self-mark each answer in Results
              </Label>
            </div>
            <Textarea
              value={keyText}
              onChange={(e) => setKeyText(e.target.value)}
              rows={6}
              disabled={keyLater}
              placeholder={"1. A\n2. C\n7. B or C\n9. bonus\n5. 42"}
              className="font-mono text-sm"
            />

            <div className="flex flex-wrap items-center gap-3 mt-3">
              <input
                ref={keyFileRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onKeyFile(f);
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => keyFileRef.current?.click()}
                disabled={keyLoading || keyLater}
              >
                {keyLoading
                  ? "Reading key PDF…"
                  : keyFileName
                    ? `✓ Key PDF: ${keyFileName.slice(0, 28)}`
                    : "Upload answer-key PDF (digital)"}
              </Button>
              <div className="flex items-center gap-2">
                <Switch
                  id="opt-nums"
                  checked={optionNums}
                  onCheckedChange={(v) => setOptionNums(v)}
                  aria-label="Key uses option numbers 1 to 4"
                />
                <Label htmlFor="opt-nums" className="text-xs cursor-pointer">
                  Key uses option numbers (1)–(4)
                </Label>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground/70 mt-1.5">
              Option-number mapping turns key values 1–4 into A–D, live. Turn it off if numerical answers can legitimately be 1–4.
            </p>

            {optNumSuggest && !optHintDismissed ? (
              <div className="mt-2 flex items-center justify-between gap-2 bg-amber-50 dark:bg-amber-500/10 border border-amber-300 dark:border-amber-500/40 rounded-lg px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                <span>
                  {parsedKey.filter((k) => ["1", "2", "3", "4"].includes(k.answer)).length} of your key values
                  look like option numbers (1)–(4) — turn on the mapping above?
                </span>
                <button
                  type="button"
                  onClick={() => setOptHintDismissed(true)}
                  className="text-amber-700 dark:text-amber-300 hover:text-amber-900 font-medium shrink-0"
                  aria-label="Dismiss suggestion"
                >
                  Dismiss
                </button>
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-3 mt-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Tolerance ± (numerical keys)</Label>
                <Input
                  value={tolerance}
                  onChange={(e) => setTolerance(e.target.value)}
                  inputMode="decimal"
                  aria-label="Numerical tolerance"
                />
                <p className="text-[11px] text-muted-foreground/70">0 = exact match; answers within ±tolerance score +4</p>
              </div>
              <div className="flex items-end">
                <Button type="button" variant="ghost" size="sm" className="text-red-500 dark:text-red-400 hover:text-red-600 hover:bg-red-50 dark:bg-red-500/10 dark:hover:bg-red-500/10" onClick={clearGrid}>
                  Clear grid
                </Button>
              </div>
            </div>

            {/* editable key grid — authoritative key */}
            <div className={keyLater ? "mt-4 pointer-events-none opacity-50" : "mt-4"}>
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <Badge className="bg-emerald-700 dark:bg-emerald-500 hover:bg-emerald-700 dark:hover:bg-emerald-500 text-white dark:text-emerald-950 border-0">
                  {gridKey.length} key{gridKey.length === 1 ? "" : "s"} in grid
                </Badge>
                {parsedKey.length > 0 ? (
                  <Badge variant="outline" className="border-border text-muted-foreground">
                    {parsedKey.length} parsed from text
                  </Badge>
                ) : null}
                {paperTotal > 0 ? (
                  coverage.missing.length === 0 ? (
                    <Badge variant="outline" className="border-emerald-300 dark:border-emerald-500/40 text-emerald-700 dark:text-emerald-400">
                      full coverage of Q{firstQN}–{firstQN + paperTotal - 1}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-amber-400 dark:border-amber-500/50 text-amber-700 dark:text-amber-300">
                      missing: {coverage.missing.slice(0, 10).join(", ")}
                      {coverage.missing.length > 10 ? ` +${coverage.missing.length - 10}` : ""}
                    </Badge>
                  )
                ) : null}
                {paperTotal > MAX_GRID_CELLS ? (
                  <Badge variant="outline" className="border-amber-400 dark:border-amber-500/50 text-amber-700 dark:text-amber-300">
                    showing first {MAX_GRID_CELLS} cells
                  </Badge>
                ) : null}
              </div>

              {renderCells.length === 0 ? (
                <EmptyNote>
                  Set the question range (left), then paste a key or fill cells here. Format: A–D, “B/C”,
                  “bonus”, or a number.
                </EmptyNote>
              ) : (
                <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-1.5 max-h-96 overflow-y-auto p-0.5">
                  {renderCells.map((no) => {
                    const raw = grid[no] ?? "";
                    const res = raw.trim() === "" ? null : parseCell(raw, optionNums);
                    const invalid = res !== null && res.kind === "invalid";
                    return (
                      <div key={no} className="space-y-0.5">
                        <div className={cn("text-[10px] leading-none", invalid ? "text-red-500 dark:text-red-400 font-semibold" : "text-muted-foreground/70")}>
                          Q{no}
                        </div>
                        <Input
                          value={raw}
                          onChange={(e) => setCell(no, e.target.value)}
                          className={cn(
                            "h-8 text-xs font-mono px-1.5 text-center",
                            invalid && "border-red-400 focus-visible:ring-red-300"
                          )}
                          aria-label={`Key for question ${no}`}
                          placeholder="—"
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </SectionCard>

          <SectionCard title="4 · Start" subtitle="pages render inside the player next to the palette">
            <ul className="text-xs text-muted-foreground space-y-1.5 list-disc pl-4 mb-4">
              <li>The player shows the page holding the current question and follows you as you move.</li>
              <li>Answer A–D or type numbers, exactly like the key — multi-answer keys (“B/C”) accept either.</li>
              {keyLater ? (
                <li className="text-amber-700 dark:text-amber-300 font-medium">
                  Score later is ON — you’ll self-mark each attempted question in Results; score and analytics fill in as you mark.
                </li>
              ) : (
                <li>Scoring is automatic at submit — then tag every mistake.</li>
              )}
            </ul>
            <Button
              className="w-full bg-emerald-700 hover:bg-emerald-800 dark:bg-emerald-500 dark:hover:bg-emerald-600 dark:text-emerald-950"
              disabled={!blob || (!keyLater && gridKey.length === 0) || loading}
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
