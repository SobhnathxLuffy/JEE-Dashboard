"use client";

// ─── App shell: navigation + north-star header + view switching ─────────────
import { useCallback, useEffect, useRef, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { PwaRegister } from "./PwaRegister";
import { cn } from "@/lib/utils";
import {
  clearSession,
  getAll,
  kvDel,
  kvGet,
  kvSet,
  loadSession,
  put,
  bulkPut,
  useDataVersion,
  useLive,
} from "@/lib/idb";
import { SYLLABUS_SEED } from "@/lib/syllabus-seed";
import type { ActiveSession, TestRecord } from "@/lib/types";
import { todayStr } from "@/lib/types";
import { northStar } from "@/lib/analytics";

import { DashboardView } from "./Dashboard";
import { QuestionBankView } from "./QuestionBank";
import { TestCreateView, type TestCreatePrefill } from "./TestCreate";
import { PlayerView } from "./Player";
import { ResultsView } from "./Results";
import { PdfImportView } from "./PdfImport";
import { ExternalLogView } from "./ExternalLog";
import { SyllabusView } from "./Syllabus";
import { FormulaView } from "./FormulaSheet";
import { DataView } from "./DataView";

export type ViewName =
  | "dashboard"
  | "bank"
  | "test"
  | "pdf"
  | "external"
  | "syllabus"
  | "formula"
  | "data"
  | "player"
  | "results";

const NAV: { id: ViewName; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "test", label: "New CBT" },
  { id: "pdf", label: "PDF Test" },
  { id: "external", label: "Log External" },
  { id: "bank", label: "Question Bank" },
  { id: "syllabus", label: "Syllabus" },
  { id: "formula", label: "Formula Sheet" },
  { id: "data", label: "Data" },
];

// every legal view name — used to validate a restored deep link
const ALL_VIEWS: ViewName[] = [...NAV.map((n) => n.id), "player", "results"];

const DEFAULT_EXAM_DATE = "2027-01-22"; // JEE Main 2027 Session 1

export interface NavController {
  go: (v: ViewName) => void;
  openResults: (testId: string) => void;
  startSession: (s: ActiveSession, pdfBlob?: Blob | null) => void;
  /** open TestCreate with an optional subject/chapter preselected (action-linked analytics) */
  toTestCreate: (prefill?: TestCreatePrefill) => void;
}

export function AppRoot() {
  const [view, setView] = useState<ViewName>("dashboard");
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [resumable, setResumable] = useState<ActiveSession | null>(null);
  const [resultsTestId, setResultsTestId] = useState<string | null>(null);
  const [testPrefill, setTestPrefill] = useState<TestCreatePrefill | undefined>(undefined);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const pdfBlobRef = useRef<Blob | null>(null);
  const seededRef = useRef(false);
  const dataVersion = useDataVersion();

  const tests = useLive("tests");
  const responses = useLive("responses");

  // First load: persist storage, seed syllabus if empty, check for a resumable
  // session, restore deep links (last view + results target)
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    // C4: request durable storage once — fire-and-forget, never surfaces
    try {
      void Promise.resolve(navigator.storage?.persist?.()).catch(() => {});
    } catch {
      // ancient browsers without the API — ignore
    }
    (async () => {
      try {
        const rows = await getAll("syllabus");
        if (rows.length === 0) {
          await bulkPut("syllabus", SYLLABUS_SEED);
        }
      } catch {
        // seeding is best-effort; the app still works without it
      }
      const s = await loadSession().catch(() => undefined);
      if (s) setResumable(s);
      // C5 deep links: restore last view + results test id.
      // A resumable-session banner renders above any view, so restoring is safe —
      // the only forbidden jump is INTO the player (session not loaded here).
      try {
        const [v, rid] = await Promise.all([
          kvGet<ViewName>("view"),
          kvGet<string>("results-testid"),
        ]);
        let restored: ViewName = "dashboard";
        if (v && ALL_VIEWS.includes(v)) restored = v;
        if (restored === "player") restored = "dashboard";
        if (restored === "results") {
          if (rid) setResultsTestId(rid);
          else restored = "dashboard";
        }
        setView(restored);
      } catch {
        // deep links are best-effort
      }
    })();
  }, []);

  // C5: every view change is written to kv so a refresh keeps context
  const applyView = useCallback((v: ViewName) => {
    setView(v);
    void kvSet("view", v).catch(() => {});
  }, []);

  const go = useCallback(
    (v: ViewName) => {
      setTestPrefill(undefined); // plain navigation never carries a stale chapter prefill
      applyView(v);
    },
    [applyView]
  );

  const openResults = useCallback(
    (testId: string) => {
      setResultsTestId(testId);
      applyView("results");
      void kvSet("results-testid", testId).catch(() => {});
    },
    [applyView]
  );

  const startSession = useCallback(
    (s: ActiveSession, pdfBlob?: Blob | null) => {
      pdfBlobRef.current = pdfBlob ?? null;
      setResumable(null);
      setSession(s);
      applyView("player");
      // persist immediately — a 3h mock must survive an accidental tab close
      void import("@/lib/idb").then((m) => m.saveSession(s).catch(() => {}));
    },
    [applyView]
  );

  const resume = useCallback(
    async () => {
      if (!resumable) return;
      const s = resumable;
      if (s.mode === "pdf") {
        try {
          const blob = await (await import("@/lib/idb")).kvGet<Blob>("pdf-blob");
          pdfBlobRef.current = blob ?? null;
        } catch {
          pdfBlobRef.current = null;
        }
      }
      setSession(s);
      setResumable(null);
      applyView("player");
    },
    [resumable, applyView]
  );

  const discardSession = useCallback(async () => {
    await clearSession();
    await kvDel("pdf-blob");
    setResumable(null);
  }, []);

  const finishSession = useCallback(
    async (testId: string) => {
      await clearSession();
      await kvDel("pdf-blob");
      pdfBlobRef.current = null;
      setSession(null);
      openResults(testId);
    },
    [openResults]
  );

  // D5: action-linked analytics — amber / repeated-failure rows jump straight
  // into TestCreate with the chapter preselected
  const toTestCreate = useCallback(
    (p?: TestCreatePrefill) => {
      setTestPrefill(p);
      applyView("test");
    },
    [applyView]
  );

  const star = northStar(tests, responses);

  const nav: NavController = { go, openResults, startSession, toTestCreate };

  return (
    <div className="min-h-screen flex flex-col bg-stone-50">
      <PwaRegister />
      <Toaster position="bottom-right" />
      <header className="bg-white border-b border-stone-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-emerald-700 text-white grid place-items-center font-black text-sm shrink-0">
              JEE
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-stone-900 leading-tight truncate">JEE Study App</div>
              <div className="text-[11px] text-stone-400 leading-tight">
                local-first · all data stays in this browser
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 shrink-0">
            {/* E1: exam countdown chip — wraps below the north-star on mobile */}
            <CountdownChip />
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wide text-stone-400 font-medium">
                Correct under time
              </div>
              <div className="text-xl font-black text-emerald-700 tabular-nums leading-none">
                {star}
              </div>
            </div>
          </div>
        </div>
        <nav className="max-w-7xl mx-auto px-4 pb-2 flex gap-1.5 overflow-x-auto" aria-label="Main">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => go(n.id)}
              className={cn(
                "px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors",
                view === n.id
                  ? "bg-emerald-700 text-white font-medium"
                  : "bg-stone-100 text-stone-600 hover:bg-stone-200"
              )}
            >
              {n.label}
            </button>
          ))}
        </nav>
      </header>

      {resumable && !session ? (
        <div className="bg-amber-50 border-b border-amber-200">
          <div className="max-w-7xl mx-auto px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm text-amber-800">
              <Badge className="bg-amber-500 hover:bg-amber-500 text-white border-0 mr-2">
                paused test
              </Badge>
              “{resumable.name}” is still open — the clock never stopped.
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={resume} className="bg-emerald-700 hover:bg-emerald-800">
                Resume
              </Button>
              {/* C5: discarding a paused session asks for confirmation */}
              <Button size="sm" variant="outline" onClick={() => setConfirmDiscard(true)}>
                Discard
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 py-6">
        {view === "dashboard" ? <DashboardView nav={nav} key={`d-${dataVersion}`} /> : null}
        {view === "bank" ? <QuestionBankView /> : null}
        {view === "test" ? (
          <TestCreateView
            key={testPrefill ? `t-${testPrefill.subject}:${testPrefill.chapter}` : "t-blank"}
            nav={nav}
            prefill={testPrefill}
          />
        ) : null}
        {view === "player" && session ? (
          <PlayerView
            session={session}
            pdfBlob={pdfBlobRef.current}
            onPersist={setSession}
            onFinish={finishSession}
          />
        ) : null}
        {view === "results" && resultsTestId ? (
          <ResultsView testId={resultsTestId} nav={nav} />
        ) : null}
        {view === "pdf" ? <PdfImportView nav={nav} /> : null}
        {view === "external" ? <ExternalLogView nav={nav} /> : null}
        {view === "syllabus" ? <SyllabusView /> : null}
        {view === "formula" ? <FormulaView nav={nav} /> : null}
        {view === "data" ? <DataView /> : null}
      </main>

      <footer className="mt-auto bg-white border-t border-stone-200">
        <div className="max-w-7xl mx-auto px-4 py-3 text-xs text-stone-400 flex justify-between gap-2 flex-wrap">
          <span>
            The app follows the plan — never the reverse. Building stopped at MVP; studying wins.
          </span>
          <span>Every test logged &amp; tagged within 24h, or it didn&apos;t happen.</span>
        </div>
      </footer>

      {/* C5: discard confirmation — answers are lost, only the attempt record stays */}
      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard “{resumable?.name ?? "this test"}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The timer will keep this attempt only as a record — answers are lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep solving</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => {
                setConfirmDiscard(false);
                void discardSession();
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── E1: exam countdown chip (target date in kv, editable via popover) ──────
function daysUntil(fromStr: string, toStr: string): number {
  const a = new Date(`${fromStr}T12:00:00`).getTime();
  const b = new Date(`${toStr}T12:00:00`).getTime();
  return Math.ceil((b - a) / 86400000);
}

function CountdownChip() {
  const [target, setTarget] = useState<string | null>(null); // null = not loaded yet
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    let alive = true;
    kvGet<string>("target-exam-date")
      .then((v) => {
        if (alive) {
          setTarget(typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : DEFAULT_EXAM_DATE);
        }
      })
      .catch(() => {
        if (alive) setTarget(DEFAULT_EXAM_DATE);
      });
    return () => {
      alive = false;
    };
  }, []);

  async function saveDate() {
    if (!draft || !/^\d{4}-\d{2}-\d{2}$/.test(draft)) return;
    setTarget(draft);
    setOpen(false);
    try {
      await kvSet("target-exam-date", draft);
      const n = daysUntil(todayStr(), draft);
      toast.success(
        n > 0
          ? `Countdown set — ${n} day${n === 1 ? "" : "s"} to go`
          : n === 0
            ? "Countdown set — exam day is today"
            : "Countdown set — date is in the past"
      );
    } catch {
      toast.error("Could not save the target date");
    }
  }

  // render only after the kv read resolves (client-only) — no SSR mismatch
  if (target === null) return null;

  const n = daysUntil(todayStr(), target);
  const label =
    n > 0
      ? `${n} day${n === 1 ? "" : "s"} · JEE Main`
      : n === 0
        ? "Exam day!"
        : `${-n} day${n === -1 ? "" : "s"} since`;

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setDraft(target);
      }}
    >
      <PopoverTrigger asChild>
        <button
          className="rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-100 transition-colors whitespace-nowrap tabular-nums"
          aria-label={`Exam countdown: ${label}. Change target date.`}
        >
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="end">
        <div className="space-y-2">
          <div className="text-xs font-semibold text-stone-800">Target exam date</div>
          <Input
            type="date"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Target exam date"
          />
          <Button
            size="sm"
            className="w-full bg-emerald-700 hover:bg-emerald-800"
            onClick={() => void saveDate()}
            disabled={!draft}
          >
            Set countdown
          </Button>
          <p className="text-[10px] text-stone-400 leading-snug">
            Default: JEE Main 2027 Session 1 (Jan 22). Stored locally on this device.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export type { TestRecord };
