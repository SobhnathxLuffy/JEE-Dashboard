"use client";

// ─── Papers library: stored PDFs, ready to import again without re-uploading ─
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { EmptyNote, PageTitle, SectionCard } from "./shared";
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

export function PapersView({ nav }: { nav: NavController }) {
  const papers = useLive("papers");
  const [renameTarget, setRenameTarget] = useState<PaperRecord | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<PaperRecord | null>(null);
  const [storageUsed, setStorageUsed] = useState<string | null>(null);

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

  const rows = useMemo(() => [...papers].sort((a, b) => b.added_at - a.added_at), [papers]);
  const totalBytes = useMemo(() => rows.reduce((a, p) => a + (p.size || 0), 0), [rows]);

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

      {rows.length === 0 ? (
        <EmptyNote>
          No papers stored yet. Upload a PDF in <strong>PDF Test</strong> and it lands here
          automatically — then import it any time with one click.
        </EmptyNote>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
            <Badge variant="outline" className="border-stone-300 text-stone-600">
              {rows.length} paper{rows.length === 1 ? "" : "s"}
            </Badge>
            <Badge variant="outline" className="border-stone-300 text-stone-600">
              {fmtBytes(totalBytes)} of PDFs
            </Badge>
            {storageUsed ? (
              <span className="text-stone-400">browser storage used: {storageUsed}</span>
            ) : null}
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            {rows.map((p) => (
              <SectionCard
                key={p.id}
                title={
                  <span className="block truncate pr-2" title={p.name}>
                    {p.name}
                  </span>
                }
                subtitle={`${p.num_pages} page${p.num_pages === 1 ? "" : "s"} · ${fmtBytes(p.size)} · added ${fmtWhen(p.added_at)} · last used ${fmtWhen(p.last_used_at)}`}
              >
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => importPaper(p)}
                    className="bg-emerald-700 hover:bg-emerald-800 min-h-[40px]"
                  >
                    Import test
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => download(p)}>
                    Download
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setRenameTarget(p);
                      setRenameDraft(p.name);
                    }}
                  >
                    Rename
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-500 hover:text-red-600 hover:bg-red-50"
                    onClick={() => setDeleteTarget(p)}
                  >
                    Delete
                  </Button>
                </div>
              </SectionCard>
            ))}
          </div>
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
              className="bg-emerald-700 hover:bg-emerald-800"
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
