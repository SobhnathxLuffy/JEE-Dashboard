"use client";

// ─── Shared UI atoms for the JEE app views ──────────────────────────────────
// "Quiet Cockpit" system: warm stone neutrals, ONE emerald accent, hairline
// structure (1px borders, no loud shadows), mono-tabular numerals everywhere
// (Geist rule: numbers are data), type hierarchy via weight+color not size.
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ChapterStatus, Subject } from "@/lib/types";
import type { LucideIcon } from "lucide-react";

// ─── Shared chart vocabulary (Performance + Dashboard use the same voice) ───
export const CH = {
  green: "#047857",
  amber: "#d97706",
  red: "#dc2626",
  stone: "#78716c",
  blueGray: "#475569",
};
export const TIP = {
  contentStyle: {
    fontSize: 12,
    borderRadius: 8,
    border: "1px solid #e7e5e4",
    background: "#fff",
    boxShadow: "0 8px 24px -12px rgba(28,25,23,0.18)",
  },
};
export const GRID = { strokeDasharray: "3 3", stroke: "#e7e5e4" };
export const TICK = { fontSize: 10, fill: "#78716c" };
// numeric axes read as data → mono (Geist "tabular numerals for numbers")
export const TICK_MONO = { fontSize: 11, fill: "#78716c", fontFamily: "var(--font-geist-mono)" };

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
        {/* hierarchy via weight+tracking, not size — Linear "don't compete for
           attention you haven't earned" */}
        <h1 className="text-lg font-semibold tracking-tight text-foreground">{title}</h1>
        {subtitle ? (
          <p className="text-[13px] text-muted-foreground mt-0.5 max-w-2xl leading-relaxed">{subtitle}</p>
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
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "good" | "warn" | "bad" | "accent";
}) {
  const toneCls = {
    default: "text-foreground",
    good: "text-emerald-700",
    warn: "text-amber-600",
    bad: "text-red-600",
    accent: "text-emerald-700",
  }[tone];
  return (
    <Card className="border-border bg-card shadow-[0_1px_2px_0_rgba(28,25,23,0.04)]">
      <CardContent className="p-4">
        {/* Geist Label-12-CAPS: tertiary labels in busy views read as chrome */}
        <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground font-medium">{label}</div>
        {/* every number is data → mono tabular (taste-skill cockpit rule) */}
        <div className={cn("font-mono tabular-nums text-[22px] font-semibold tracking-tight mt-1", toneCls)}>
          {value}
        </div>
        {hint ? <div className="text-xs text-muted-foreground/80 mt-1">{hint}</div> : null}
      </CardContent>
    </Card>
  );
}

export function TierBadge({ tier }: { tier: 1 | 2 | 3 }) {
  if (tier === 1) {
    return (
      <Badge className="bg-emerald-700 hover:bg-emerald-700 text-white border-0">T1</Badge>
    );
  }
  if (tier === 2) {
    return <Badge variant="outline" className="border-stone-300 text-stone-600">T2</Badge>;
  }
  return <Badge variant="outline" className="border-stone-200 text-stone-400">T3</Badge>;
}

export function HealthChip({ color, accuracy }: { color: string; accuracy: number | null }) {
  if (accuracy === null || color === "gray") {
    return <Badge variant="outline" className="border-stone-200 text-stone-400">no data</Badge>;
  }
  const cls =
    color === "green"
      ? "bg-emerald-100 text-emerald-800 border-emerald-200"
      : color === "amber"
        ? "bg-amber-100 text-amber-800 border-amber-300"
        : "bg-red-100 text-red-700 border-red-200";
  return <Badge variant="outline" className={cls}>{accuracy}%</Badge>;
}

const STATUS_CLS: Record<ChapterStatus, string> = {
  "Not Started": "border-stone-200 text-stone-500",
  Learning: "border-sky-200 bg-sky-50 text-sky-700",
  "PYQs Done": "border-violet-200 bg-violet-50 text-violet-700",
  "70% Gate Passed": "border-emerald-200 bg-emerald-50 text-emerald-700",
  Maintenance: "border-stone-300 bg-stone-100 text-stone-700",
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
      ? "bg-amber-500"
      : subject === "Chemistry"
        ? "bg-emerald-600"
        : "bg-stone-800";
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
    <Card className={cn("border-border bg-card shadow-[0_1px_2px_0_rgba(28,25,23,0.04)]", className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-[13px] font-semibold text-foreground">{title}</CardTitle>
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
    <div className="border border-dashed border-border rounded-xl px-6 py-10 flex flex-col items-center text-center bg-card/50">
      <div className="w-11 h-11 rounded-xl bg-stone-100 text-stone-400 grid place-items-center mb-3">
        <Icon className="w-5 h-5" strokeWidth={1.5} aria-hidden="true" />
      </div>
      <div className="text-sm font-semibold text-foreground">{title}</div>
      <p className="text-[13px] text-muted-foreground mt-1 max-w-sm leading-relaxed">{description}</p>
      {primary && primaryLabel ? (
        <div className="flex items-center gap-2 mt-4">
          <Button size="sm" onClick={primary} className="bg-emerald-700 hover:bg-emerald-800 press">
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
      <span className={attempted && mine !== "—" ? "text-stone-600" : "text-stone-400"}>
        You:{" "}
        <strong
          className={cn(
            "break-all",
            status === "wrong" ? "text-red-600" : status === "right" ? "text-emerald-700" : "text-stone-700"
          )}
          title={mine}
        >
          {mine}
          {!attempted ? " (skipped)" : ""}
        </strong>
      </span>
      <span className={keyPending ? "text-stone-400" : "text-emerald-700"}>
        Correct:{" "}
        <strong className="break-all" title={theirs}>
          {theirs}
          {num && !keyPending && tolerance && tolerance > 0 ? ` (±${tolerance})` : ""}
        </strong>
      </span>
    </div>
  );
}
