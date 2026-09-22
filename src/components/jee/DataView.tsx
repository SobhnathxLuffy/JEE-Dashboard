"use client";

// ─── Data: JSON export / import, demo seed, wipe ────────────────────────────
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { PageTitle, SectionCard } from "./shared";
import {
  STORES,
  bulkPut,
  del,
  getAll,
  wipeAll,
  useLive,
} from "@/lib/idb";
import { buildDemoQuestions } from "@/lib/demo-questions";
import { SYLLABUS_SEED } from "@/lib/syllabus-seed";

export function DataView() {
  const questions = useLive("questions");
  const tests = useLive("tests");
  const responses = useLive("responses");
  const syllabus = useLive("syllabus");
  const formula = useLive("formula");
  const daily = useLive("daily_log");
  const fileRef = useRef<HTMLInputElement>(null);

  async function exportAll() {
    const data: Record<string, unknown> = {
      _meta: { app: "jee-study-app", version: 1, exported_at: new Date().toISOString() },
    };
    for (const s of STORES) {
      data[s] = await getAll(s);
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `jee-study-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Backup downloaded");
  }

  async function importAll(file: File) {
    try {
      const text = await file.text();
      const data = JSON.parse(text) as Record<string, unknown>;
      let total = 0;
      for (const s of STORES) {
        const rows = data[s];
        if (Array.isArray(rows) && rows.length > 0) {
          await bulkPut(s, rows as never[]);
          total += rows.length;
        }
      }
      toast.success(`Imported ${total} records (existing ids were merged)`);
    } catch (e) {
      toast.error(`Import failed: ${String(e)}`);
    }
  }

  async function loadDemo() {
    await bulkPut("questions", buildDemoQuestions());
    toast.success("12 demo questions added — go to New CBT and pick chapters");
  }

  async function removeDemo() {
    const demoList = questions.filter((q) => q.source === "demo");
    for (const q of demoList) {
      await del("questions", q.id);
    }
    toast.success(`${demoList.length} demo questions removed`);
  }

  async function restoreSyllabus() {
    await bulkPut("syllabus", SYLLABUS_SEED);
    toast.success("Syllabus seed restored (progress merged by chapter id)");
  }

  return (
    <div className="space-y-6">
      <PageTitle
        title="Data"
        subtitle="Local-first means your data lives in this browser's IndexedDB. Export a backup before clearing browser data."
      />

      <div className="grid md:grid-cols-2 gap-6">
        <SectionCard title="Backup & restore" subtitle="plain JSON — no cloud, no account">
          <div className="flex flex-col gap-3">
            <div className="text-xs text-stone-500 grid grid-cols-3 gap-2">
              <span>questions: <strong>{questions.length}</strong></span>
              <span>tests: <strong>{tests.length}</strong></span>
              <span>responses: <strong>{responses.length}</strong></span>
              <span>syllabus: <strong>{syllabus.length}</strong></span>
              <span>formula: <strong>{formula.length}</strong></span>
              <span>daily logs: <strong>{daily.length}</strong></span>
            </div>
            <Button onClick={exportAll} className="bg-emerald-700 hover:bg-emerald-800">
              Export JSON backup
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importAll(f);
              }}
            />
            <Button variant="outline" onClick={() => fileRef.current?.click()}>
              Import JSON (merge)
            </Button>
          </div>
        </SectionCard>

        <SectionCard title="Seeds" subtitle="demo questions & syllabus reset">
          <div className="flex flex-col gap-3">
            <Button variant="outline" onClick={loadDemo}>
              Load 12 demo questions
            </Button>
            <Button variant="outline" onClick={removeDemo}>
              Remove demo questions
            </Button>
            <Button variant="outline" onClick={restoreSyllabus}>
              Restore full syllabus seed
            </Button>
          </div>
        </SectionCard>

        <SectionCard
          title="Danger zone"
          subtitle="wipes every store in this browser — export first"
          className="md:col-span-2"
        >
          <Button
            variant="destructive"
            onClick={async () => {
              const ok = window.confirm(
                "Delete ALL app data in this browser? Question bank, tests, tags, syllabus progress — everything."
              );
              if (!ok) return;
              await wipeAll();
              toast.success("All data wiped");
            }}
          >
            Wipe all data
          </Button>
        </SectionCard>
      </div>
    </div>
  );
}
