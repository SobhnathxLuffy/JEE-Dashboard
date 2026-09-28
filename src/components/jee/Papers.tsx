"use client";

// ─── Papers library: stored PDFs, ready to import again without re-uploading ─
// Row pattern (research: Drive/Notion lists + shadcn data-table guide): compact
// rows, hover-revealed icon actions, search toolbar, honest storage line.
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { FileText, Search, Download, Pencil, Trash2, FolderOpen, HardDrive } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import type { NavController } from "./App";
import { EmptyState, PageTitle } from "./shared";
import { del, put, useLive } from "@/lib/idb";
import type { PaperRecord } from "@/lib/types";

function fmtBytes(n: number): string {
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

function fmtWhen(ms: number | undefined): string {
  if (!ms) return "never";
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// no-results (search) empty — distinct from the zero-data empty above (NN/g)
function EmptyNoteFallback({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <div className="text-sm text-muted-foreground border border-dashed border-border rounded-lg px-4 py-6 text-center">
      No papers match “{query}”.{" "}
      <button
        onClick={onClear}
        className="text-emerald-700 dark:text-emerald-400 font-medium underline underline-offset-2 hover:text-emerald-800 dark:text-emerald-300"
      >
        Clear search
      </button>
    </div>
  );
}

export function PapersView({ nav }: { nav: NavController }) {
  const papers = useLive("papers");
  const [renameTarget, setRenameTarget] = useState<PaperRecord | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<PaperRecord | null>(null);
  const [storageUsed, setStorageUsed] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // best-effort storage footprint (Chrome/Firefox expose the estimate)
  useEffect(() => {
    let alive = true;
    navigator.storage
      ?.estimate?.()
      .then((e) => {
        if (alive && typeof e.usage === "number") setStorageUsed(fmtBytes(e.usage));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [papers.length]);

  const rows = useMemo(
    () =>
      [...papers]
        .sort((a, b) => b.added_at - a.added_at)
        .filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase())),
    [papers, query]
  );
  const totalBytes = useMemo(
    () => papers.reduce((a, p) => a + (p.size || 0), 0),
    [papers]
  );

  function importPaper(p: PaperRecord) {
    toast.success(`“${p.name.slice(0, 32)}” loaded — no re-upload needed`);
    nav.importPaper(p);
  }

  function download(p: PaperRecord) {
    const url = URL.createObjectURL(p.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = p.name;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function saveRename() {
    if (!renameTarget) return;
    const name = renameDraft.trim();
    if (!name) return;
    await put("papers", { ...renameTarget, name });
    setRenameTarget(null);
    toast.success("Paper renamed");
  }

  async function removePaper(p: PaperRecord) {
    await del("papers", p.id);
    setDeleteTarget(null);
    toast.success("Paper removed from the library");
  }

  return (
    <div className="space-y-6">
      <PageTitle
        title="Papers library"
        subtitle="Every PDF you upload is kept here automatically. Start a new test from any of them — no re-uploading, ever."
        right={
          <Button variant="outline" size="sm" onClick={() => nav.go("pdf")}>
            + Upload a new PDF
          </Button>
        }
      />

      {papers.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="No papers yet"
          description="Add a paper once — it stays in this library and every future test starts from here. Zero re-uploading."
          primary={() => nav.go("pdf")}
          primaryLabel="Upload the first paper"
        />
      ) : (
        <>
          {/* toolbar: search + honest counters (status, not decoration) */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search
                className="w-3.5 h-3.5 text-muted-foreground/70 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search papers…"
                className="h-9 w-56 pl-8 text-sm"
                aria-label="Search papers by name"
              />
            </div>
            <Badge variant="outline" className="border-border text-muted-foreground font-mono tabular-nums">
              {rows.length === papers.length
                ? `${papers.length} paper${papers.length === 1 ? "" : "s"}`
                : `${rows.length} of ${papers.length}`}
            </Badge>
            <Badge variant="outline" className="border-border text-muted-foreground font-mono tabular-nums">
              {fmtBytes(totalBytes)}
            </Badge>
            {storageUsed ? (
              <span className="text-[11px] text-muted-foreground/70 flex items-center gap-1">
                <HardDrive className="w-3 h-3" aria-hidden="true" /> browser storage used: {storageUsed}
              </span>
            ) : null}
          </div>

          {/* compact rows — actions appear on hover (desktop) / always (touch) */}
          {rows.length === 0 ? (
            <EmptyNoteFallback query={query} onClear={() => setQuery("")} />
          ) : (
            <ul className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
              {rows.map((p) => (
                <li
                  key={p.id}
                  className="group flex items-center gap-3 px-3 py-2.5 hover:bg-accent/50 transition-colors"
                >
                  <div className="w-9 h-9 rounded-md bg-muted text-muted-foreground/70 grid place-items-center shrink-0">
                    <FileText className="w-4 h-4" strokeWidth={1.5} aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-foreground truncate" title={p.name}>
                      {p.name}
                    </div>
                    <div
                      className="text-[11px] text-muted-foreground/80 font-mono tabular-nums truncate"
                      title={`${p.num_pages} page${p.num_pages === 1 ? "" : "s"} · ${fmtBytes(p.size)} · added ${fmtWhen(p.added_at)} · last used ${fmtWhen(p.last_used_at)}`}
                    >
                      {p.num_pages} page{p.num_pages === 1 ? "" : "s"} · {fmtBytes(p.size)} · added{" "}
                      {fmtWhen(p.added_at)} · last used {fmtWhen(p.last_used_at)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 max-md:opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 transition-opacity">
                    <Button
                      size="sm"
                      onClick={() => importPaper(p)}
                      className="bg-emerald-700 hover:bg-emerald-800 dark:bg-emerald-500 dark:hover:bg-emerald-600 dark:text-emerald-950 press h-8"
                    >
                      Import test
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                      onClick={() => download(p)}
                      aria-label={`Download ${p.name}`}
                    >
                      <Download className="w-4 h-4" aria-hidden="true" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setRenameTarget(p);
                        setRenameDraft(p.name);
                      }}
                      aria-label={`Rename ${p.name}`}
                    >
                      <Pencil className="w-4 h-4" aria-hidden="true" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:bg-red-500/10 dark:hover:bg-red-500/10"
                      onClick={() => setDeleteTarget(p)}
                      aria-label={`Delete ${p.name}`}
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* rename dialog */}
      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => !open && setRenameTarget(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Rename paper</DialogTitle>
            <DialogDescription>
              The name shows up pre-filled as the test name at import time.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="paper-name" className="text-xs">
              Paper name
            </Label>
            <Input
              id="paper-name"
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveRename();
              }}
              maxLength={120}
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" size="sm" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-emerald-700 hover:bg-emerald-800 dark:bg-emerald-500 dark:hover:bg-emerald-600 dark:text-emerald-950"
              onClick={() => void saveRename()}
              disabled={!renameDraft.trim()}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* delete confirmation */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteTarget?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The PDF is removed from the library. Tests you already gave from it keep their
              results — but you would have to re-upload the file to give this paper again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => deleteTarget && void removePaper(deleteTarget)}
            >
              Delete paper
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
