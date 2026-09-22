"use client";

// ─── Shared UI atoms for the JEE app views ──────────────────────────────────
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ChapterStatus, Subject } from "@/lib/types";

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
        <h1 className="text-xl font-semibold tracking-tight text-stone-900">{title}</h1>
        {subtitle ? <p className="text-sm text-stone-500 mt-0.5 max-w-2xl">{subtitle}</p> : null}
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
    default: "text-stone-900",
    good: "text-emerald-700",
    warn: "text-amber-600",
    bad: "text-red-600",
    accent: "text-emerald-700",
  }[tone];
  return (
    <Card className="border-stone-200 shadow-sm">
      <CardContent className="p-4">
        <div className="text-[11px] uppercase tracking-wide text-stone-500 font-medium">{label}</div>
        <div className={cn("text-2xl font-bold mt-1 tabular-nums", toneCls)}>{value}</div>
        {hint ? <div className="text-xs text-stone-400 mt-1">{hint}</div> : null}
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
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("border-stone-200 shadow-sm", className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-semibold text-stone-800">{title}</CardTitle>
            {subtitle ? <p className="text-xs text-stone-400 mt-0.5">{subtitle}</p> : null}
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
    <div className="text-sm text-stone-400 border border-dashed border-stone-200 rounded-lg px-4 py-6 text-center">
      {children}
    </div>
  );
}
