"use client";

// ─── Shared UI atoms for the JEE app views ──────────────────────────────────
// "NOVA" system: deep-space glass surfaces floating on aurora light, electric
// violet→cyan brand energy, mono-tabular numerals with glow (numbers are the
// heroes), type hierarchy via display face + weight. Fully theme-aware —
// chart colors + tooltips ride CSS vars, so both themes need zero per-chart
// work. Motion atoms live in ./motion.tsx.
import { useId } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ChapterStatus, Subject } from "@/lib/types";
import type { LucideIcon } from "lucide-react";
import { HoverLift, Spotlight } from "./motion";

// ─── Shared chart vocabulary (Performance + Dashboard use the same voice) ───
// Values are CSS vars defined per-theme in globals.css — the SAME component
// code renders correct colors in light and dark. SVG fill/stroke resolve vars.
export const CH = {
  green: "var(--sem-emerald)",
  amber: "var(--sem-amber)",
  red: "var(--sem-red)",
  stone: "var(--sem-stone)",
  blueGray: "var(--sem-slate)",
  violet: "var(--sem-violet)",
};
// Inline-style tooltip (recharts contentStyle) — vars resolve in inline styles.
// For a richer tooltip use <ChartTip/> below.
export const TIP = {
  contentStyle: {
    fontSize: 12,
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--popover)",
    color: "var(--popover-foreground)",
    boxShadow: "var(--tip-shadow)",
  },
};
export const GRID = { strokeDasharray: "3 3", stroke: "var(--chart-grid)" };
export const TICK = { fontSize: 10, fill: "var(--chart-tick)" };
// numeric axes read as data → mono (Geist "tabular numerals for numbers")
export const TICK_MONO = { fontSize: 11, fill: "var(--chart-tick)", fontFamily: "var(--font-geist-mono)" };

// ─── Glass chart tooltip — one design for every chart in the app ─────────────
type TipEntry = {
  dataKey?: string | number;
  name?: string | number;
  value?: number | string;
  color?: string;
  stroke?: string;
  fill?: string;
};
export function ChartTip({
  active,
  payload,
  label,
  suffix,
  formats,
}: {
  active?: boolean;
  payload?: TipEntry[];
  label?: string | number;
  /** appended to the label line, e.g. "· 12 May" */
  suffix?: string;
  /** per-dataKey value formatter, e.g. { accuracy: (v) => `${v}%` } */
  formats?: Record<string | number, (v: number | string) => string>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-popover text-popover-foreground px-3 py-2 backdrop-blur-2xl shadow-[var(--tip-shadow)] text-xs max-w-64">
      {label !== undefined && label !== "" ? (
        <div className="font-medium text-foreground mb-1 leading-tight">
          {label}
          {suffix ? <span className="text-muted-foreground font-normal"> {suffix}</span> : null}
        </div>
      ) : null}
      <div className="space-y-0.5">
        {payload.map((p, i) => {
          const raw = p.value;
          const fmt = p.dataKey !== undefined ? formats?.[p.dataKey] : undefined;
          const shown =
            typeof raw === "number"
              ? fmt
                ? fmt(raw)
                : String(Math.round(raw * 10) / 10)
              : String(raw ?? "—");
          return (
            <div key={i} className="flex items-center gap-1.5 leading-snug">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: p.color || p.stroke || p.fill || "var(--sem-stone)" }}
                aria-hidden="true"
              />
              <span className="text-muted-foreground">{p.name ?? String(p.dataKey)}</span>
              <span className="ml-auto font-mono tabular-nums font-medium pl-2">{shown}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── ChartNote — a plain-English caption saying what the graph denotes ──────
// (user rule: "what graphs denote" — every chart gets one line of meaning)
export function ChartNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] leading-relaxed text-muted-foreground/75 mt-2 flex gap-1.5">
      <span aria-hidden="true" className="select-none">◦</span>
      <span>{children}</span>
    </p>
  );
}

// ─── Sparkline — 34px gradient area for StatCards, no axes, pure shape ───────
export function Spark({
  data,
  color = "var(--sem-emerald)",
  height = 34,
}: {
  data: number[];
  color?: string;
  height?: number;
}) {
  const gid = useId();
  if (!data || data.length < 2) return null;
  return (
    <div style={{ height }} className="mt-2 -mx-1 pointer-events-none" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data.map((v, i) => ({ i, v }))} margin={{ top: 2, right: 2, bottom: 0, left: 2 }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#${gid})`}
            dot={false}
            activeDot={false}
            isAnimationActive
            animationDuration={600}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PageTitle({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
      <div>
        {/* display voice + a subtle energy tick — the page header reads as
           instrumentation, not a document heading */}
        <h1 className="flex items-center gap-2.5 font-display text-xl font-semibold tracking-tight text-foreground">
          <span aria-hidden="true" className="inline-block h-4 w-1 rounded-full bg-gradient-to-b from-violet-500 to-cyan-400 dark:from-violet-400 dark:to-cyan-300" />
          {title}
        </h1>
        {subtitle ? (
          <p className="text-[13px] text-muted-foreground mt-1 max-w-2xl leading-relaxed">{subtitle}</p>
        ) : null}
      </div>
      {right ? <div className="flex items-center gap-2">{right}</div> : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
  spark,
  sparkColor,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "default" | "good" | "warn" | "bad" | "accent";
  /** recent series → renders a tiny gradient sparkline under the number */
  spark?: number[];
  sparkColor?: string;
}) {
  const toneCls = {
    default: "text-foreground",
    good: "text-emerald-600 dark:text-emerald-300",
    warn: "text-amber-600 dark:text-amber-300",
    bad: "text-red-600 dark:text-red-300",
    accent: "text-violet-600 dark:text-violet-300",
  }[tone];
  return (
    <Spotlight className="shadow-[inset_0_1px_0_0_var(--glass-highlight)]">
      <Card className="border-border bg-card/70 h-full transition-colors hairline-top">
        <CardContent className="p-4">
          {/* CAPS micro-label reads as instrumentation chrome */}
          <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/90 font-medium">{label}</div>
          {/* every number is data → mono tabular, display-sized */}
          <div className={cn("font-mono tabular-nums text-[26px] font-semibold tracking-tight mt-1.5", toneCls)}>
            {value}
          </div>
          {hint ? <div className="text-xs text-muted-foreground/80 mt-1">{hint}</div> : null}
          {spark && spark.length > 1 ? <Spark data={spark} color={sparkColor} /> : null}
        </CardContent>
      </Card>
    </Spotlight>
  );
}

export function TierBadge({ tier }: { tier: 1 | 2 | 3 }) {
  if (tier === 1) {
    return (
      <Badge className="bg-emerald-700 hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-500 text-white dark:text-emerald-950 border-0">T1</Badge>
    );
  }
  if (tier === 2) {
    return <Badge variant="outline" className="border-border text-muted-foreground">T2</Badge>;
  }
  return <Badge variant="outline" className="border-border/70 text-muted-foreground/60">T3</Badge>;
}

export function HealthChip({ color, accuracy }: { color: string; accuracy: number | null }) {
  if (accuracy === null || color === "gray") {
    return <Badge variant="outline" className="border-border text-muted-foreground/60">no data</Badge>;
  }
  const cls =
    color === "green"
      ? "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30"
      : color === "amber"
        ? "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30"
        : "bg-red-100 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/30";
  return <Badge variant="outline" className={cls}>{accuracy}%</Badge>;
}

const STATUS_CLS: Record<ChapterStatus, string> = {
  "Not Started": "border-border text-muted-foreground",
  Learning: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300",
  "PYQs Done": "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300",
  "70% Gate Passed": "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
  Maintenance: "border-stone-300 bg-stone-100 text-stone-700 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-300",
};

export function StatusBadge({ status }: { status: ChapterStatus }) {
  return (
    <Badge variant="outline" className={STATUS_CLS[status]}>
      {status}
    </Badge>
  );
}

export function SubjectDot({ subject }: { subject: Subject }) {
  const cls =
    subject === "Physics"
      ? "bg-amber-500 shadow-[0_0_6px_var(--sem-amber)]"
      : subject === "Chemistry"
        ? "bg-emerald-500 dark:bg-emerald-400 shadow-[0_0_6px_var(--sem-emerald)]"
        : "bg-slate-600 dark:bg-slate-300 shadow-[0_0_6px_var(--sem-slate)]";
  return <span className={cn("inline-block w-2 h-2 rounded-full mr-1.5 align-middle", cls)} />;
}

export function SectionCard({
  title,
  subtitle,
  children,
  action,
  className,
}: {
  title: React.ReactNode;
  subtitle?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("border-border bg-card/70", className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="font-display text-[14px] font-semibold tracking-tight text-foreground">{title}</CardTitle>
            {subtitle ? <p className="text-xs text-muted-foreground/80 mt-0.5">{subtitle}</p> : null}
          </div>
          {action}
        </div>
      </CardHeader>
      <CardContent className="pt-0">{children}</CardContent>
    </Card>
  );
}

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-sm text-muted-foreground border border-dashed border-border rounded-lg px-4 py-6 text-center">
      {children}
    </div>
  );
}

// ─── NN/g empty-state pattern: status + teaching + ONE direct pathway ────────
// (research: NN/g "Designing Empty States", shadcn Empty conventions)
export function EmptyState({
  icon: Icon,
  title,
  description,
  primary,
  primaryLabel,
  secondary,
  secondaryLabel,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  primary?: () => void;
  primaryLabel?: string;
  secondary?: () => void;
  secondaryLabel?: string;
}) {
  return (
    <div className="border border-dashed border-border rounded-2xl px-6 py-12 flex flex-col items-center text-center bg-card/40 backdrop-blur-sm relative overflow-hidden">
      {/* faint energy field behind the empty state */}
      <div aria-hidden="true" className="absolute -top-16 left-1/2 -translate-x-1/2 w-64 h-32 rounded-full bg-violet-500/10 dark:bg-violet-500/15 blur-3xl pointer-events-none" />
      <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/25 shadow-[0_0_24px_-4px_var(--glow-primary)] grid place-items-center mb-4">
        <Icon className="w-5 h-5" strokeWidth={1.5} aria-hidden="true" />
      </div>
      <div className="font-display text-sm font-semibold text-foreground">{title}</div>
      <p className="text-[13px] text-muted-foreground mt-1.5 max-w-sm leading-relaxed">{description}</p>
      {primary && primaryLabel ? (
        <div className="flex items-center gap-2 mt-5">
          <Button size="sm" onClick={primary} className="press">
            {primaryLabel}
          </Button>
          {secondary && secondaryLabel ? (
            <Button size="sm" variant="ghost" onClick={secondary} className="text-muted-foreground">
              {secondaryLabel}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ─── Answer comparison — what MY answer contained vs what the key contained ──
const ANSWER_LETTERS = ["A", "B", "C", "D"];

export function AnswerBits({
  selected,
  correctAnswer,
  type,
  options,
  isPdf,
  tolerance,
  attempted,
  status,
}: {
  selected: number | string | null;
  correctAnswer: number | string;
  type: "MCQ" | "numerical";
  options?: string[];
  isPdf: boolean;
  tolerance?: number;
  attempted: boolean;
  /** outcome tint for "You" — right=emerald, wrong=red (review-screen semantics) */
  status?: "right" | "wrong" | null;
}) {
  const letterOf = (v: number | string | null) => {
    const i = Number(v);
    return Number.isInteger(i) && i >= 0 && i < 4 ? ANSWER_LETTERS[i] : String(v);
  };
  const num = type === "numerical";
  const keyPending = String(correctAnswer) === "?" || String(correctAnswer) === "";

  // what I answered, verbatim — option text included when the paper provides it
  let mine = "—";
  if (attempted && selected !== null && selected !== undefined) {
    if (num) {
      mine = String(selected);
    } else {
      const idx = Number(selected);
      const hasText =
        !isPdf && Array.isArray(options) && options.length === 4;
      mine =
        hasText && Number.isInteger(idx) && idx >= 0 && idx < 4
          ? `(${ANSWER_LETTERS[idx]}) ${options[idx]}`
          : letterOf(selected);
    }
  }

  // what the correct answer contained, verbatim
  let theirs = "—";
  if (!keyPending) {
    if (num) {
      theirs = String(correctAnswer);
    } else {
      const idx = Number(correctAnswer);
      const hasText = !isPdf && Array.isArray(options) && options.length === 4;
      theirs =
        hasText && Number.isInteger(idx) && idx >= 0 && idx < 4
          ? `(${ANSWER_LETTERS[idx]}) ${options[idx]}`
          : isPdf
            ? String(correctAnswer) // "B" or "B/C" multi-answer key
            : letterOf(correctAnswer);
    }
  }

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
      <span className={attempted && mine !== "—" ? "text-muted-foreground" : "text-muted-foreground/60"}>
        You:{" "}
        <strong
          className={cn(
            "break-all",
            status === "wrong"
              ? "text-red-600 dark:text-red-400"
              : status === "right"
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-foreground"
          )}
          title={mine}
        >
          {mine}
          {!attempted ? " (skipped)" : ""}
        </strong>
      </span>
      <span className={keyPending ? "text-muted-foreground/60" : "text-emerald-700 dark:text-emerald-400"}>
        Correct:{" "}
        <strong className="break-all" title={theirs}>
          {theirs}
          {num && !keyPending && tolerance && tolerance > 0 ? ` (±${tolerance})` : ""}
        </strong>
      </span>
    </div>
  );
}
