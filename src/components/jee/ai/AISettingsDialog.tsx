"use client";

// ─── AI settings — paste your provider (AI Credits / OpenRouter / …), pick a
// model, test, done. Everything stays on this device: the key lives in
// localStorage, results + usage live in IndexedDB, nothing server-side.
import { useMemo, useState } from "react";
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
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useLive } from "@/lib/idb";
import {
  MODEL_PRESETS,
  aiConfigured,
  loadAISettings,
  saveAISettings,
  testAIConnection,
  type AISettings,
} from "@/lib/ai";

export function AISettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [draft, setDraft] = useState<AISettings>({ baseUrl: "", apiKey: "", model: "" });
  const [loaded, setLoaded] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testOk, setTestOk] = useState<string | null>(null);

  const usage = useLive("ai_usage");

  // hydrate the draft from localStorage when the dialog opens (not on mount —
  // SSR-safe; remounts per open so edits never leak between opens)
  if (open && !loaded) {
    setDraft(loadAISettings());
    setLoaded(true);
    setTestOk(null);
  }
  if (!open && loaded) setLoaded(false);

  const monthUsage = useMemo(() => {
    const prefix = new Date().toISOString().slice(0, 7); // YYYY-MM
    const rows = usage.filter((u) => new Date(u.created_at).toISOString().startsWith(prefix));
    const cost = rows.reduce((a, r) => a + r.cost_inr, 0);
    const byFeature = new Map<string, number>();
    for (const r of rows) byFeature.set(r.feature, (byFeature.get(r.feature) ?? 0) + 1);
    return { calls: rows.length, cost, byFeature };
  }, [usage]);

  function set<K extends keyof AISettings>(k: K, v: string) {
    setDraft((d) => ({ ...d, [k]: v }));
    setTestOk(null);
  }

  function save() {
    const baseUrl = draft.baseUrl.trim().replace(/\/+$/, "");
    if (!baseUrl || !draft.apiKey.trim() || !draft.model.trim()) {
      toast.error("Fill in all three: base URL, API key, model");
      return;
    }
    saveAISettings({ baseUrl, apiKey: draft.apiKey.trim(), model: draft.model.trim() });
    toast.success("AI settings saved on this device");
    onOpenChange(false);
  }

  async function runTest() {
    // test the DRAFT (not just the saved settings) so the user can validate before saving
    saveAISettings({
      baseUrl: draft.baseUrl.trim().replace(/\/+$/, ""),
      apiKey: draft.apiKey.trim(),
      model: draft.model.trim(),
    });
    setTesting(true);
    setTestOk(null);
    const r = await testAIConnection();
    setTesting(false);
    if (r.ok) setTestOk(r.model);
    else toast.error(r.error);
  }

  const configured = aiConfigured(draft);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>AI settings</DialogTitle>
          <DialogDescription>
            Works with any OpenAI-compatible credits API — AI Credits, OpenRouter, DeepSeek direct,
            Gemini&apos;s OpenAI endpoint. The key is stored <strong>only on this device</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3.5">
          <div className="space-y-1.5">
            <Label className="text-xs">Base URL</Label>
            <Input
              value={draft.baseUrl}
              onChange={(e) => set("baseUrl", e.target.value)}
              placeholder="https://your-provider.example/v1"
              className="font-mono text-xs"
              aria-label="API base URL"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-[10px] text-muted-foreground/70 leading-snug">
              Usually ends with <code className="font-mono">/v1</code>. Pasting the full
              <code className="font-mono"> …/chat/completions</code> URL also works.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">API key</Label>
            <Input
              type="password"
              value={draft.apiKey}
              onChange={(e) => set("apiKey", e.target.value)}
              placeholder="sk-…"
              className="font-mono text-xs"
              aria-label="API key"
              autoComplete="off"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Model</Label>
            <Input
              value={draft.model}
              onChange={(e) => set("model", e.target.value)}
              placeholder="deepseek-chat"
              className="font-mono text-xs"
              aria-label="Model name"
              autoComplete="off"
              spellCheck={false}
            />
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {MODEL_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  title={`${p.hint} · ≈ ₹${p.inCost}/M in · ₹${p.outCost}/M out`}
                  onClick={() => set("model", p.id)}
                  className={cn(
                    "press px-2 py-1 rounded-full text-[11px] border transition-colors",
                    draft.model === p.id
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted text-muted-foreground border-transparent hover:border-border hover:text-foreground"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground/70 leading-snug">
              On ₹50 of credits, DeepSeek V3 runs roughly 400+ doubt explanations, 15–20 full paper
              extractions and dozens of coach reports. Any model name your provider accepts works —
              just type it.
            </p>
          </div>

          <div className="flex items-center gap-2.5 pt-1 flex-wrap">
            <Button size="sm" variant="outline" onClick={() => void runTest()} disabled={testing || !configured}>
              {testing ? "Testing…" : "Test connection"}
            </Button>
            {testOk ? (
              <Badge className="bg-sage-600 dark:bg-sage-500 hover:bg-sage-600 dark:hover:bg-sage-500 text-white dark:text-sage-950 border-0">
                ✓ Connected — {testOk}
              </Badge>
            ) : null}
          </div>

          {monthUsage.calls > 0 ? (
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-xs space-y-1">
              <div className="font-medium text-foreground">
                This month: {monthUsage.calls} AI call{monthUsage.calls === 1 ? "" : "s"} ·{" "}
                <span className="font-mono tabular-nums">≈ ₹{monthUsage.cost.toFixed(2)}</span>
                <span className="text-muted-foreground font-normal"> (estimate)</span>
              </div>
              <div className="text-muted-foreground">
                {[...monthUsage.byFeature.entries()].map(([f, n]) => `${f}: ${n}`).join(" · ")}
              </div>
            </div>
          ) : null}

          <p className="text-[10px] leading-relaxed text-muted-foreground/70">
            Privacy: questions you send go to your AI provider when you press Explain / Extract /
            Coach — never in the background, never anywhere else. Explanations and reports are
            cached in IndexedDB, so re-viewing is free.
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={save}
            className="bg-emerald-700 hover:bg-emerald-800 dark:bg-emerald-500 dark:hover:bg-emerald-600 dark:text-emerald-950"
          >
            Save settings
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
