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
  kvSet,
  wipeAll,
  useLive,
  type StoreName,
} from "@/lib/idb";
import { buildDemoQuestions } from "@/lib/demo-questions";
import { SYLLABUS_SEED } from "@/lib/syllabus-seed";

/** Every row must be an object with a usable key before anything is written. */
function validateRows(store: StoreName, rows: unknown[]): void {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (typeof r !== "object" || r === null || Array.isArray(r)) {
      throw new Error(`${store}[${i}] is not an object`);
    }
    const rec = r as Record<string, unknown>;
    if (store === "kv") {
      if (typeof rec.key !== "string" || rec.key === "") {
        throw new Error(`${store}[${i}] is missing a string "key"`);
      }
    } else if (typeof rec.id !== "string" || rec.id === "") {
      throw new Error(`${store}[${i}] is missing a string "id"`);
    }
  }
}

export function DataView() {
  const questions = useLive("questions");
  const tests = useLive("tests");
  const responses = useLive("responses");
  const syllabus = useLive("syllabus");
  const formula = useLive("formula");
  const daily = useLive("daily_log");
  const fileRef = useRef<HTMLInputElement>(null);

  async function exportAll() {
    try {
      const kvRows = await getAll("kv");
      // binary (Blob/File) values — e.g. the pdf-blob — can't survive JSON
      const excluded = kvRows
        .filter((r) => r.value instanceof Blob)
        .map((r) => r.key);
      const data: Record<string, unknown> = {
        _meta: {
          app: "jee-study-app",
          version: 1,
          exported_at: new Date().toISOString(),
          pdf_blob_included: false,
          note:
            excluded.length > 0
              ? `pdf blob not included (kv entries with binary values skipped): ${excluded.join(", ")}`
              : "pdf blob not included (kv entries with binary values are always skipped)",
        },
      };
      for (const s of STORES) {
        data[s] =
          s === "kv" ? kvRows.filter((r) => !(r.value instanceof Blob)) : await getAll(s);
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `jee-study-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      await kvSet("last-export-at", new Date().toISOString());
      toast.success(
        excluded.length > 0 ? "Backup downloaded (pdf blob not included)" : "Backup downloaded"
      );
    } catch (e) {
      toast.error(`Export failed: ${String(e)}`);
    }
  }

  async function importAll(file: File) {
    let data: Record<string, unknown>;
    try {
      const text = await file.text();
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      toast.error("Import failed: that file is not valid JSON");
      return;
    }
    const meta = data._meta;
    if (
      typeof meta !== "object" ||
      meta === null ||
      (meta as Record<string, unknown>).app !== "jee-study-app"
    ) {
      toast.error("Import failed: not a JEE Study App backup (_meta.app mismatch) — refusing");
      return;
    }
    // validate every store first — nothing is written unless the whole file checks out
    const toWrite: { store: StoreName; rows: Record<string, unknown>[] }[] = [];
    const counts: string[] = [];
    try {
      for (const s of STORES) {
        const rows = data[s];
        if (rows === undefined) continue; // store absent from this backup
        if (!Array.isArray(rows)) throw new Error(`"${s}" is not an array`);
        validateRows(s, rows as unknown[]);
        if (rows.length > 0) {
          toWrite.push({ store: s, rows: rows as Record<string, unknown>[] });
          counts.push(`${s}: ${rows.length}`);
        }
      }
    } catch (e) {
      toast.error(`Import failed: ${String(e)}`);
      return;
    }
    try {
      let total = 0;
      for (const { store, rows } of toWrite) {
        await bulkPut(store, rows as never[]);
        total += rows.length;
      }
      toast.success(
        total === 0
          ? "Nothing to import — the backup has no records"
          : `Imported ${total} records (${counts.join(", ")}) — existing ids were merged`
      );
    } catch (e) {
      toast.error(`Import failed while writing: ${String(e)}`);
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
            <p className="text-[11px] text-stone-400">
              The stored question-PDF blob is binary — it is excluded from backups (marked in
              _meta). Re-attach a PDF when you start a new PDF test.
            </p>
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
