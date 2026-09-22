"use client";

// ─── Formula sheet — auto-collected from F-tagged mistakes ──────────────────
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { EmptyNote, PageTitle, SectionCard, SubjectDot } from "./shared";
import { useLive, del } from "@/lib/idb";
import type { Subject } from "@/lib/types";

export function FormulaView() {
  const entries = useLive("formula");
  const [filter, setFilter] = useState<Subject | "all">("all");

  const shown = useMemo(
    () =>
      entries
        .filter((e) => (filter === "all" ? true : e.subject === filter))
        .sort((a, b) => b.created_at - a.created_at),
    [entries, filter]
  );

  const byChapter = useMemo(() => {
    const m = new Map<string, typeof shown>();
    for (const e of shown) {
      const key = `${e.subject}::${e.chapter}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(e);
    }
    return [...m.entries()];
  }, [shown]);

  return (
    <div className="space-y-6">
      <PageTitle
        title="Formula Sheet"
        subtitle="Auto-built from every mistake tagged F (Formula). This is the leak list — revise it the same night, then next day, then on the 1-3-7 loop."
        right={
          <div className="flex gap-1.5">
            {(["all", "Physics", "Chemistry", "Mathematics"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`px-2.5 py-1 rounded-full text-xs transition-colors ${
                  filter === s ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-500 hover:bg-stone-200"
                }`}
              >
                {s === "all" ? "All" : s.slice(0, 1)}
              </button>
            ))}
          </div>
        }
      />

      {shown.length === 0 ? (
        <EmptyNote>
          Empty — which is good news or bad news. Open any test&apos;s results screen and tag a wrong
          answer with F to land it here.
        </EmptyNote>
      ) : (
        <div className="space-y-4">
          <div className="text-sm text-stone-500 flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">
              {entries.length} entries
            </Badge>
            <span>each one is a question you got wrong for missing the formula</span>
          </div>
          {byChapter.map(([key, list]) => {
            const [subject, chapter] = key.split("::") as [Subject, string];
            return (
              <SectionCard key={key} title={chapter} subtitle={`${list.length} leak${list.length > 1 ? "s" : ""}`}>
                <ul className="space-y-2">
                  {list.map((e) => (
                    <li
                      key={e.id}
                      className="border border-stone-200 rounded-lg px-3 py-2.5 flex items-start justify-between gap-3 hover:bg-stone-50 transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center text-[11px] text-stone-400 mb-0.5">
                          <SubjectDot subject={subject} />
                          {subject}
                        </div>
                        <p className="text-sm text-stone-800">{e.snippet}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-500 hover:text-red-600 hover:bg-red-50 shrink-0"
                        onClick={() => {
                          del("formula", e.id);
                          toast.success("Removed from formula sheet");
                        }}
                      >
                        Got it
                      </Button>
                    </li>
                  ))}
                </ul>
              </SectionCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
