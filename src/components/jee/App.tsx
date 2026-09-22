"use client";

// ─── App shell: navigation + north-star header + view switching ─────────────
import { useCallback, useEffect, useRef, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  clearSession,
  getAll,
  kvDel,
  loadSession,
  put,
  bulkPut,
  useDataVersion,
  useLive,
} from "@/lib/idb";
import { SYLLABUS_SEED } from "@/lib/syllabus-seed";
import type { ActiveSession, TestRecord } from "@/lib/types";
import { northStar } from "@/lib/analytics";

import { DashboardView } from "./Dashboard";
import { QuestionBankView } from "./QuestionBank";
import { TestCreateView } from "./TestCreate";
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

export interface NavController {
  go: (v: ViewName) => void;
  openResults: (testId: string) => void;
  startSession: (s: ActiveSession, pdfBlob?: Blob | null) => void;
}

export function AppRoot() {
  const [view, setView] = useState<ViewName>("dashboard");
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [resumable, setResumable] = useState<ActiveSession | null>(null);
  const [resultsTestId, setResultsTestId] = useState<string | null>(null);
  const pdfBlobRef = useRef<Blob | null>(null);
  const seededRef = useRef(false);
  const dataVersion = useDataVersion();

  const tests = useLive("tests");
  const responses = useLive("responses");

  // First load: seed syllabus if empty, check for a resumable session
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    (async () => {
      const rows = await getAll("syllabus");
      if (rows.length === 0) {
        await bulkPut("syllabus", SYLLABUS_SEED);
      }
      const s = await loadSession();
      if (s) setResumable(s);
    })();
  }, []);

  const go = useCallback((v: ViewName) => {
    setView(v);
  }, []);

  const openResults = useCallback((testId: string) => {
    setResultsTestId(testId);
    setView("results");
  }, []);

  const startSession = useCallback(
    (s: ActiveSession, pdfBlob?: Blob | null) => {
      pdfBlobRef.current = pdfBlob ?? null;
      setResumable(null);
      setSession(s);
      setView("player");
      // persist immediately — a 3h mock must survive an accidental tab close
      void import("@/lib/idb").then((m) => m.saveSession(s).catch(() => {}));
    },
    []
  );

  const resume = useCallback(async () => {
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
    setView("player");
  }, [resumable]);

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

  const star = northStar(tests, responses);

  const nav: NavController = { go, openResults, startSession };

  return (
    <div className="min-h-screen flex flex-col bg-stone-50">
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
          <div className="flex items-center gap-2 shrink-0">
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
              <Button size="sm" variant="outline" onClick={discardSession}>
                Discard
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 py-6">
        {view === "dashboard" ? <DashboardView nav={nav} key={`d-${dataVersion}`} /> : null}
        {view === "bank" ? <QuestionBankView /> : null}
        {view === "test" ? <TestCreateView nav={nav} /> : null}
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
        {view === "formula" ? <FormulaView /> : null}
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
    </div>
  );
}

export type { TestRecord };
