"use client";

// ─── Data: JSON export / import, demo seed, wipe ────────────────────────────
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { PageTitle, SectionCard } from "./shared";
import { FileDrop } from "./FileDrop";
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

/** Papers (PDF blobs) are base64-packed into the JSON up to this total size. */
const PAPERS_EXPORT_CAP = 60 * 1024 * 1024;

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(b);
  });
}

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
    } else if (store === "papers") {
      if (typeof rec.id !== "string" || rec.id === "") {
        throw new Error(`papers[${i}] is missing a string "id"`);
      }
      if (typeof rec.data !== "string" || !rec.data.startsWith("data:")) {
        throw new Error(`papers[${i}] has no base64 PDF payload`);
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
  const papers = useLive("papers");
  const tasks = useLive("tasks");
  const fileRef = useRef<HTMLInputElement>(null);

  async function exportAll() {
    try {
      const kvRows = await getAll("kv");
      // binary (Blob/File) values — e.g. the pdf-blob — can't survive JSON
      const excluded = kvRows
        .filter((r) => r.value instanceof Blob)
        .map((r) => r.key);
      // papers: base64-embed the PDFs (capped) so the library survives a backup
      const paperRows = await getAll("papers");
      const totalPaperBytes = paperRows.reduce((a, p) => a + (p.size || 0), 0);
      const paperOut: Record<string, unknown>[] = [];
      let papersSkipped = 0;
      if (totalPaperBytes <= PAPERS_EXPORT_CAP) {
        for (const p of paperRows) {
          try {
            paperOut.push({ ...p, data: await blobToDataUrl(p.data) });
          } catch {
            papersSkipped += 1;
          }
        }
      } else {
        papersSkipped = paperRows.length;
      }
      const data: Record<string, unknown> = {
        _meta: {
          app: "jee-study-app",
          version: 1,
          exported_at: new Date().toISOString(),
          pdf_blob_included: false,
          papers_included: paperOut.length,
          note:
            excluded.length > 0
              ? `pdf blob not included (kv entries with binary values skipped): ${excluded.join(", ")}`
              : "pdf blob not included (kv entries with binary values are always skipped)",
          papers_note:
            papersSkipped > 0
              ? `${papersSkipped} paper(s) skipped — papers total exceeds the ${Math.round(PAPERS_EXPORT_CAP / 1048576)} MB backup cap`
              : "papers embedded as base64",
        },
      };
      for (const s of STORES) {
        if (s === "papers") continue; // handled above (base64-embedded)
        data[s] =
          s === "kv" ? kvRows.filter((r) => !(r.value instanceof Blob)) : await getAll(s);
      }
      data.papers = paperOut;
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
        if (store === "papers") {
          // base64 payload → Blob again
          const asRows = await Promise.all(
            (rows as { data: string }[]).map(async (r) => ({
              ...r,
              data: await (await fetch(r.data)).blob(),
            }))
          );
          await bulkPut("papers", asRows as never[]);
          total += asRows.length;
        } else {
          await bulkPut(store, rows as never[]);
          total += rows.length;
        }
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
            <div className="text-xs text-muted-foreground grid grid-cols-3 gap-2">
              <span>questions: <strong>{questions.length}</strong></span>
              <span>tests: <strong>{tests.length}</strong></span>
              <span>responses: <strong>{responses.length}</strong></span>
              <span>syllabus: <strong>{syllabus.length}</strong></span>
              <span>formula: <strong>{formula.length}</strong></span>
              <span>daily logs: <strong>{daily.length}</strong></span>
              <span>papers: <strong>{papers.length}</strong></span>
              <span>tasks: <strong>{tasks.length}</strong></span>
            </div>
            <Button onClick={exportAll} className="bg-emerald-700 hover:bg-emerald-800 dark:bg-emerald-500 dark:hover:bg-emerald-600 dark:text-emerald-950">
              Export JSON backup
            </Button>
            <p className="text-[11px] text-muted-foreground/70">
              Papers-library PDFs are embedded in the backup as base64 (up to 60 MB total). The
              transient in-test PDF blob is still excluded — re-attach a PDF only if a test was
              running when you backed up.
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
            <FileDrop
              accept=".json,application/json"
              label="Drop your backup .json here — or click to browse"
              hint="merged into what you already have; nothing is deleted"
              className="text-left"
              onFiles={(files) => void importAll(files[0])}
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
