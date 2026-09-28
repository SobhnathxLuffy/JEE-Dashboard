"use client";

// ─── App shell: navigation + north-star header + view switching ─────────────
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import { useTheme } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LayoutDashboard,
  FilePlus2,
  FileText,
  FolderOpen,
  ClipboardList,
  Library,
  ChartLine,
  ListTree,
  Sigma,
  Database,
  Sun,
  Moon,
  Monitor,
  Check,
  type LucideIcon,
} from "lucide-react";
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
import { EASE } from "./motion";
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
import type { ActiveSession, PaperRecord, TestRecord } from "@/lib/types";
import { todayStr } from "@/lib/types";
import { northStar } from "@/lib/analytics";

import { DashboardView } from "./Dashboard";
import { QuestionBankView } from "./QuestionBank";
import { TestCreateView, type TestCreatePrefill } from "./TestCreate";
import { PlayerView } from "./Player";
import { ResultsView } from "./Results";
import { PdfImportView } from "./PdfImport";
import { PapersView } from "./Papers";
import { PerformanceView } from "./Performance";
import { ExternalLogView } from "./ExternalLog";
import { SyllabusView } from "./Syllabus";
import { FormulaView } from "./FormulaSheet";
import { DataView } from "./DataView";

export type ViewName =
  | "dashboard"
  | "bank"
  | "test"
  | "pdf"
  | "papers"
  | "external"
  | "performance"
  | "syllabus"
  | "formula"
  | "data"
  | "player"
  | "results";

const NAV: { id: ViewName; label: string; icon: LucideIcon }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "test", label: "New CBT", icon: FilePlus2 },
  { id: "pdf", label: "PDF Test", icon: FileText },
  { id: "papers", label: "Papers", icon: FolderOpen },
  { id: "external", label: "Log External", icon: ClipboardList },
  { id: "bank", label: "Question Bank", icon: Library },
  { id: "performance", label: "Performance", icon: ChartLine },
  { id: "syllabus", label: "Syllabus", icon: ListTree },
  { id: "formula", label: "Formula Sheet", icon: Sigma },
  { id: "data", label: "Data", icon: Database },
];

// nav groups → hairline separators between functional clusters (Kombai rule:
// one style family; Linear rule: structure felt, not seen)
const NAV_GROUPS: ViewName[][] = [
  ["dashboard"],
  ["test", "pdf", "papers", "external"],
  ["bank", "performance", "syllabus", "formula"],
  ["data"],
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
  /** open PDF Test pre-loaded with a stored paper (no re-upload) */
  importPaper: (p: PaperRecord) => void;
}

export function AppRoot() {
  const [view, setView] = useState<ViewName>("dashboard");
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [resumable, setResumable] = useState<ActiveSession | null>(null);
  const [resultsTestId, setResultsTestId] = useState<string | null>(null);
  const [testPrefill, setTestPrefill] = useState<TestCreatePrefill | undefined>(undefined);
  const [paperForImport, setPaperForImport] = useState<PaperRecord | null>(null);
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

  // Papers library → PDF Test with the blob already in hand (no re-upload)
  const importPaper = useCallback(
    (p: PaperRecord) => {
      setPaperForImport(p);
      applyView("pdf");
    },
    [applyView]
  );

  const star = northStar(tests, responses);

  const nav: NavController = { go, openResults, startSession, toTestCreate, importPaper };

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen flex flex-col relative">
        {/* NOVA ambience — aurora light field + blueprint grid behind everything */}
        <AuroraBackground />
        <PwaRegister />
        <Toaster position="bottom-right" />
        {/* floating glass chrome — the deck reads as one translucent instrument */}
        <header className="bg-background/55 dark:bg-background/45 backdrop-blur-2xl border-b border-border/70 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 via-violet-600 to-cyan-500 text-white grid place-items-center font-display font-bold text-[13px] tracking-tight shrink-0 shadow-[0_0_20px_-2px_var(--glow-primary)]">
                JEE
              </div>
              <div className="min-w-0">
                <div className="font-display font-semibold text-foreground leading-tight truncate tracking-tight">JEE Study App</div>
                <div className="text-[11px] text-muted-foreground leading-tight truncate hidden sm:block">
                  local-first · all data stays in this browser
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 shrink-0">
              {/* E1: exam countdown chip — wraps below the north-star on mobile */}
              <CountdownChip />
              <ThemeToggle />
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-medium">
                  Correct under time
                </div>
                <div className="font-mono tabular-nums text-xl font-bold tracking-tight leading-none text-gradient glow-text">
                  {star}
                </div>
              </div>
            </div>
          </div>
        <nav className="max-w-7xl mx-auto px-4 pb-2 flex gap-1 overflow-x-auto" aria-label="Main">
          {NAV_GROUPS.map((group, gi) => (
            <div key={gi} className="flex items-center gap-1">
              {gi > 0 ? <span className="mx-1.5 h-5 w-px bg-border shrink-0" aria-hidden="true" /> : null}
              {group.map((id) => {
                const n = NAV.find((x) => x.id === id)!;
                const Icon = n.icon;
                const active = view === n.id;
                return (
                  <button
                    key={n.id}
                    onClick={() => go(n.id)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "press relative px-2.5 py-1.5 rounded-full text-[13px] whitespace-nowrap flex items-center gap-1.5",
                      active
                        ? "text-primary-foreground font-medium"
                        : "text-muted-foreground hover:bg-accent/70 hover:text-foreground"
                    )}
                  >
                    {/* sliding pill — layoutId glides it between nav items,
                        lit from within so the active section feels powered */}
                    {active ? (
                      <motion.span
                        layoutId="nav-pill"
                        className="absolute inset-0 rounded-full bg-primary shadow-[0_0_18px_-2px_var(--glow-primary)]"
                        transition={{ type: "spring", stiffness: 550, damping: 42 }}
                        aria-hidden="true"
                      />
                    ) : null}
                    <Icon
                      className={cn("relative z-10 w-3.5 h-3.5 shrink-0 transition-opacity", active ? "opacity-100" : "opacity-70")}
                      strokeWidth={active ? 2 : 1.5}
                      aria-hidden="true"
                    />
                    <span className="relative z-10">{n.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </header>

      {resumable && !session ? (
        <div className="bg-amber-500/10 border-b border-amber-500/25 backdrop-blur-xl">
          <div className="max-w-7xl mx-auto px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm text-amber-700 dark:text-amber-300">
              <Badge className="bg-amber-500 hover:bg-amber-500 text-white border-0 mr-2">
                paused test
              </Badge>
              “{resumable.name}” is still open — the clock never stopped.
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={resume}>
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
        {/* page transitions: the old view blurs away, the new one materialises */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={view}
            initial={{ opacity: 0, y: 14, filter: "blur(8px)", scale: 0.995 }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)", scale: 1 }}
            exit={{ opacity: 0, y: -8, filter: "blur(6px)" }}
            transition={{ duration: 0.26, ease: EASE }}
          >
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
            {view === "pdf" ? (
              <PdfImportView
                key={paperForImport ? `pdf-${paperForImport.id}` : "pdf-blank"}
                nav={nav}
                initialPaper={paperForImport ?? undefined}
              />
            ) : null}
            {view === "papers" ? <PapersView nav={nav} /> : null}
            {view === "performance" ? <PerformanceView nav={nav} /> : null}
            {view === "external" ? <ExternalLogView nav={nav} /> : null}
            {view === "syllabus" ? <SyllabusView /> : null}
            {view === "formula" ? <FormulaView nav={nav} /> : null}
            {view === "data" ? <DataView /> : null}
          </motion.div>
        </AnimatePresence>
      </main>

      <footer className="mt-auto border-t border-border/60">
        <div className="max-w-7xl mx-auto px-4 py-3 text-[11px] text-muted-foreground/70 flex justify-between gap-2 flex-wrap">
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
    </MotionConfig>
  );
}

// ─── Theme toggle — sun/moon crossfade + Light/Dark/System menu ───────────
function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  // false on the server snapshot, true once hydrated — no setState-in-effect
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const current = mounted ? (theme ?? "system") : "system";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="press h-8 w-8 grid place-items-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-accent"
          aria-label="Change theme"
        >
          {/* both icons always mounted — pure-CSS crossfade means zero hydration
              risk and the icon responds even before React hydrates */}
          <span className="relative w-4 h-4">
            <Sun
              className="absolute inset-0 w-4 h-4 transition-all duration-300 rotate-0 scale-100 dark:-rotate-90 dark:scale-0"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <Moon
              className="absolute inset-0 w-4 h-4 transition-all duration-300 -rotate-90 scale-0 dark:rotate-0 dark:scale-100"
              strokeWidth={1.75}
              aria-hidden="true"
            />
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36">
        {([
          ["light", "Light", Sun],
          ["dark", "Dark", Moon],
          ["system", "System", Monitor],
        ] as const).map(([id, label, Icon]) => (
          <DropdownMenuItem key={id} onClick={() => setTheme(id)} className="gap-2">
            <Icon className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
            {label}
            {current === id ? <Check className="w-3.5 h-3.5 ml-auto text-primary" aria-hidden="true" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
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
          className="press rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors whitespace-nowrap tabular-nums"
          aria-label={`Exam countdown: ${label}. Change target date.`}
        >
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="end">
        <div className="space-y-2">
          <div className="text-xs font-semibold text-foreground">Target exam date</div>
          <Input
            type="date"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Target exam date"
          />
          <Button
            size="sm"
            className="w-full bg-primary hover:bg-primary/90"
            onClick={() => void saveDate()}
            disabled={!draft}
          >
            Set countdown
          </Button>
          <p className="text-[10px] text-muted-foreground/70 leading-snug">
            Default: JEE Main 2027 Session 1 (Jan 22). Stored locally on this device.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export type { TestRecord };

// ─── NOVA ambience — aurora light field + blueprint grid, fixed behind all ──
function AuroraBackground() {
  return (
    <div aria-hidden="true" className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
      {/* blueprint dot grid, fading toward the edges */}
      <div className="absolute inset-0 bg-dots fade-edges" />
      {/* three drifting light masses — violet, cyan, magenta */}
      <div className="aurora-blob aurora-blob-1 w-[42rem] h-[42rem] -top-40 -left-32" />
      <div className="aurora-blob aurora-blob-2 w-[36rem] h-[36rem] top-1/3 -right-40" />
      <div className="aurora-blob aurora-blob-3 w-[30rem] h-[30rem] -bottom-48 left-1/3" />
    </div>
  );
}
