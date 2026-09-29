"use client";

// ─── Sync settings — optional cross-device sync via the user's own free
// Supabase project (the same self-hosted model Super Productivity converged
// on). Passwordless magic-link sign-in; Row-Level Security isolates every
// account's rows; nothing but the user's project ever sees the data.
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Cloud,
  CloudOff,
  Copy,
  Check,
  Loader2,
  LogOut,
  RefreshCw,
  Unplug,
  Mail,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useLive, SYNCED_STORES } from "@/lib/idb";
import {
  disconnectSync,
  initSync,
  loadSyncConfig,
  mapSyncError,
  probeProject,
  saveSyncConfig,
  setAutoSync,
  signIn,
  signOutSync,
  syncNow,
  useSyncStatus,
  verifySignIn,
} from "@/lib/sync";
import { IS_NATIVE } from "@/lib/native";

const SETUP_SQL = `-- JEE Cockpit sync — run once in the Supabase SQL Editor
create table if not exists public.sync_data (
  user_id uuid not null default auth.uid(),
  store text not null,
  rec_id text not null,
  payload jsonb,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  device text,
  primary key (user_id, store, rec_id)
);
alter table public.sync_data enable row level security;
drop policy if exists "own rows" on public.sync_data;
create policy "own rows" on public.sync_data
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create index if not exists sync_data_pull_idx
  on public.sync_data (user_id, updated_at);

-- server-side last-write-wins guard: a stale push can never overwrite a
-- newer row (two devices syncing at once stay monotone)
create or replace function public.sync_push(p_rows jsonb, p_device text)
returns int language plpgsql security invoker as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select x.store, x.rec_id, x.payload, x.updated_at, x.deleted
    from jsonb_to_recordset(p_rows)
      as x(store text, rec_id text, payload jsonb, updated_at timestamptz, deleted boolean)
  loop
    insert into public.sync_data
      (user_id, store, rec_id, payload, updated_at, deleted, device)
    values
      (auth.uid(), r.store, r.rec_id, r.payload, r.updated_at, r.deleted, p_device)
    on conflict (user_id, store, rec_id) do update
      set payload   = excluded.payload,
          updated_at = excluded.updated_at,
          deleted    = excluded.deleted,
          device     = excluded.device
      where sync_data.updated_at < excluded.updated_at;
    n := n + 1;
  end loop;
  return n;
end; $$;`;

const STORE_LABELS: Record<string, string> = {
  questions: "question bank",
  tests: "tests",
  responses: "responses & reviews",
  syllabus: "syllabus progress",
  formula: "formula sheet",
  daily_log: "daily logs",
  tasks: "to-dos",
  cal_events: "calendar events",
  papers: "question papers (PDF included if ≤ ~4.8 MB)",
};

function relTime(ts: number | null): string {
  if (!ts) return "never";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function SyncDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const status = useSyncStatus();
  const [url, setUrl] = useState("");
  const [anonKey, setAnonKey] = useState("");
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [probing, setProbing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [counts, setCounts] = useState<string>("");

  const configured = loadSyncConfig() !== null;

  // live record counts for the "what syncs" list
  const questions = useLive("questions");
  const tests = useLive("tests");
  const responses = useLive("responses");
  const syllabus = useLive("syllabus");
  const formula = useLive("formula");
  const daily = useLive("daily_log");
  const tasks = useLive("tasks");
  const calEvents = useLive("cal_events");
  const papers = useLive("papers");

  useEffect(() => {
    if (!open) return;
    const cfg = loadSyncConfig();
    setUrl(cfg?.url ?? "");
    setAnonKey(cfg ? "" : ""); // never echo the key back
    const n: Record<string, number> = {
      questions: questions.length,
      tests: tests.length,
      responses: responses.length,
      syllabus: syllabus.length,
      formula: formula.length,
      daily_log: daily.length,
      tasks: tasks.length,
      cal_events: calEvents.length,
      papers: papers.length,
    };
    setCounts(SYNCED_STORES.map((s) => `${STORE_LABELS[s]}: ${n[s] ?? 0}`).join(" · "));
  }, [open, questions, tests, responses, syllabus, formula, daily, tasks, calEvents, papers]);

  async function connect() {
    const u = url.trim().replace(/\/+$/, "");
    const k = anonKey.trim();
    if (!/^https:\/\/.+/.test(u)) {
      toast.error("Project URL must start with https:// — copy it from Supabase → Settings → API");
      return;
    }
    if (!k) {
      toast.error("Paste the anon public key too");
      return;
    }
    setProbing(true);
    const probe = await probeProject(u, k);
    setProbing(false);
    if (!probe.ok) {
      toast.error(probe.error);
      return;
    }
    saveSyncConfig({ url: u, anonKey: k });
    initSync(); // re-wire the engine to the new config
    toast.success("Project connected — now sign in below");
  }

  async function sendMagicLink() {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      toast.error("Enter a valid email — the sign-in link goes there");
      return;
    }
    setSending(true);
    try {
      await signIn(email);
      const stillOut = (await import("@/lib/sync")).getSyncStatus().phase === "signed-out";
      if (stillOut) {
        toast.success(
          IS_NATIVE
            ? `Sign-in link sent to ${email.trim()} — open your email, then copy the link (long-press → Copy link address) or the 6-digit code into the field below`
            : `Magic link sent to ${email.trim()} — open it on this device to sign in`
        );
      } else {
        toast.success("Signed in — sync running");
      }
    } catch (e) {
      toast.error(mapSyncError(e));
    } finally {
      setSending(false);
    }
  }

  async function verifyToken() {
    if (!tokenInput.trim()) {
      toast.error("Paste the link (or code) from the email first");
      return;
    }
    setVerifying(true);
    try {
      await verifySignIn(tokenInput, email);
      toast.success("Signed in — sync running");
      setTokenInput("");
    } catch (e) {
      toast.error(mapSyncError(e));
    } finally {
      setVerifying(false);
    }
  }

  async function manualSync() {
    await syncNow("manual");
    const s = (await import("@/lib/sync")).getSyncStatus();
    if (s.phase === "idle") toast.success(`Synced — pulled ${s.lastResult?.pulled ?? 0}, pushed ${s.lastResult?.pushed ?? 0}`);
    else if (s.lastError) toast.error(s.lastError);
  }

  function copySql() {
    void navigator.clipboard
      .writeText(SETUP_SQL)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        toast.success("SQL copied — paste it in Supabase's SQL editor and press Run");
      })
      .catch(() => toast.error("Clipboard blocked — select and copy the SQL manually"));
  }

  const phaseIcon =
    status.phase === "syncing" ? (
      <Loader2 className="w-4 h-4 animate-spin text-primary" aria-hidden="true" />
    ) : status.phase === "error" ? (
      <CloudOff className="w-4 h-4 text-red-600 dark:text-red-400" aria-hidden="true" />
    ) : status.phase === "offline" ? (
      <CloudOff className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
    ) : status.email ? (
      <Cloud className="w-4 h-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
    ) : (
      <CloudOff className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {phaseIcon}
            Sync between devices
          </DialogTitle>
          <DialogDescription>
            Optional. Your data already lives safely in this browser — sync adds your{" "}
            <strong>own free Supabase project</strong> as a relay, so phones/laptops stay in step.
            Passwordless sign-in, Row-Level Security, open source, self-hostable.
          </DialogDescription>
        </DialogHeader>

        {status.mock ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            <strong>TEST MODE</strong> — mock backend active (rows held in this browser&apos;s
            localStorage; any other tab with <code className="font-mono">?syncMock=1</code> acts as a
            second device). Perfect for trying the flow without a Supabase project.
          </div>
        ) : null}

        {!configured ? (
          /* ── setup wizard ── */
          <div className="space-y-4">
            <ol className="space-y-3">
              <li className="flex gap-3">
                <StepNum n={1} />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="text-sm font-medium">Create a free Supabase project</div>
                  <p className="text-xs text-muted-foreground leading-snug">
                    supabase.com → sign up → <em>New project</em> (free tier: 500 MB, plenty).
                    The free tier pauses after a week unused — using the app daily keeps it warm.
                  </p>
                  <a
                    href="https://supabase.com/dashboard/new"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    Open supabase.com <ExternalLink className="w-3 h-3" aria-hidden="true" />
                  </a>
                </div>
              </li>
              <li className="flex gap-3">
                <StepNum n={2} />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="text-sm font-medium">Run this SQL once</div>
                  <p className="text-xs text-muted-foreground leading-snug">
                    Project → <em>SQL Editor</em> → paste → <em>Run</em>. Creates the{" "}
                    <code className="font-mono">sync_data</code> table, its Row-Level Security
                    policy and the last-write-wins push guard.
                  </p>
                  <Button size="sm" variant="outline" onClick={copySql} className="gap-1.5">
                    {copied ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
                    {copied ? "Copied" : "Copy setup SQL"}
                  </Button>
                  <details className="group">
                    <summary className="text-[11px] text-muted-foreground cursor-pointer hover:text-foreground select-none">
                      show SQL (advanced)
                    </summary>
                    <pre className="mt-1.5 max-h-40 overflow-auto rounded-md bg-muted/60 p-2.5 text-[10px] leading-relaxed font-mono text-muted-foreground">
                      {SETUP_SQL}
                    </pre>
                  </details>
                </div>
              </li>
              <li className="flex gap-3">
                <StepNum n={3} />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="text-sm font-medium">Paste the project keys</div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Project URL</Label>
                    <Input
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://xxxx.supabase.co"
                      className="font-mono text-xs"
                      aria-label="Supabase project URL"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">anon public key</Label>
                    <Input
                      type="password"
                      value={anonKey}
                      onChange={(e) => setAnonKey(e.target.value)}
                      placeholder="eyJhbGciOi…"
                      className="font-mono text-xs"
                      aria-label="Supabase anon public key"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <p className="text-[10px] text-muted-foreground/70 leading-snug">
                      Project Settings → API → <em>anon public</em>. This key is designed to be
                      public — your rows are protected by Row-Level Security, not by hiding it.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => void connect()}
                    disabled={probing}
                    className="bg-emerald-700 hover:bg-emerald-800 dark:bg-emerald-500 dark:hover:bg-emerald-600 dark:text-emerald-950"
                  >
                    {probing ? "Checking…" : "Test & connect"}
                  </Button>
                </div>
              </li>
            </ol>
          </div>
        ) : status.email ? (
          /* ── signed in: status + controls ── */
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-3 text-sm space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground text-xs uppercase tracking-wide font-medium">
                  {status.phase === "syncing" ? "Syncing…" : status.phase === "error" ? "Sync error" : status.phase === "offline" ? "Offline" : "Synced"}
                </span>
                <Badge variant="outline" className="font-normal text-muted-foreground">
                  {relTime(status.lastSyncAt)}
                </Badge>
              </div>
              {status.lastResult && status.lastSyncAt ? (
                <div className="text-xs text-muted-foreground">
                  last run: pulled <strong className="text-foreground">{status.lastResult.pulled}</strong>, pushed{" "}
                  <strong className="text-foreground">{status.lastResult.pushed}</strong> record
                  {status.lastResult.pulled + status.lastResult.pushed === 1 ? "" : "s"}
                </div>
              ) : null}
              {status.dirty > 0 && status.phase !== "syncing" ? (
                <div className="text-xs text-amber-700 dark:text-amber-400">
                  ≈ {status.dirty} local change{status.dirty === 1 ? "" : "s"} waiting to push
                </div>
              ) : null}
              {status.lastError ? (
                <div className="text-xs text-red-600 dark:text-red-400 leading-snug">{status.lastError}</div>
              ) : null}
              <div className="text-xs text-muted-foreground break-all">
                signed in as <strong className="text-foreground">{status.email}</strong>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
              <div>
                <div className="text-sm font-medium">Auto-sync</div>
                <div className="text-[11px] text-muted-foreground">on change, on tab focus, every 5 min</div>
              </div>
              <Switch checked={status.auto} onCheckedChange={(v) => setAutoSync(v)} aria-label="Toggle auto-sync" />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void manualSync()} disabled={status.phase === "syncing" || status.phase === "offline"} className="gap-1.5">
                <RefreshCw className={cn("w-3.5 h-3.5", status.phase === "syncing" && "animate-spin")} aria-hidden="true" />
                Sync now
              </Button>
              <Button size="sm" variant="outline" onClick={() => void signOutSync()} className="gap-1.5">
                <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                Sign out
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  disconnectSync();
                  toast.info("Disconnected on this device — cloud data untouched, local data untouched");
                }}
                className="gap-1.5 text-muted-foreground hover:text-foreground"
              >
                <Unplug className="w-3.5 h-3.5" aria-hidden="true" />
                Disconnect
              </Button>
            </div>

            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 space-y-1.5">
              <div className="text-xs font-medium text-foreground">On another phone or laptop?</div>
              <ol className="list-decimal ml-4 text-[11px] text-muted-foreground space-y-0.5">
                <li>Open the app → connect the same Supabase URL + anon key (steps above)</li>
                <li>Sign in with the same email</li>
                <li>Press Sync now — data flows both ways from then on</li>
              </ol>
            </div>
          </div>
        ) : (
          /* ── configured, signed out: magic link ── */
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
                Sign in — passwordless magic link
              </Label>
              <div className="flex gap-2">
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  aria-label="Email for sign-in"
                  autoComplete="email"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void sendMagicLink();
                  }}
                />
                <Button onClick={() => void sendMagicLink()} disabled={sending} className="shrink-0 bg-emerald-700 hover:bg-emerald-800 dark:bg-emerald-500 dark:hover:bg-emerald-600 dark:text-emerald-950">
                  {sending ? "Sending…" : "Send link"}
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground/70 leading-snug">
                No password exists. Supabase emails you a link; opening it on this device signs
                you in. Use the same email on every device that should share the data.
              </p>
            </div>
            <div className="space-y-1.5 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
              <Label className="text-xs">Got the email? Paste the link here</Label>
              <div className="flex gap-2">
                <Input
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="https://…verify?token_hash=… / https://…?code=… / 6-digit code"
                  aria-label="Magic link or one-time code"
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono text-xs"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void verifyToken();
                  }}
                />
                <Button
                  variant="outline"
                  onClick={() => void verifyToken()}
                  disabled={verifying || !tokenInput.trim()}
                  className="shrink-0"
                >
                  {verifying ? "Checking…" : "Verify"}
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground/70 leading-snug">
                {IS_NATIVE
                  ? "In the app the email link opens your browser — long-press it → Copy link address → paste it here (the link with ?code=… works too), or type the 6-digit code."
                  : "Works on any device: if the link opens the wrong browser or tab, copy it and paste it here to sign in this one in."}
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                disconnectSync();
                toast.info("Disconnected — set up a different project if you meant to");
              }}
              className="gap-1.5 text-muted-foreground hover:text-foreground"
            >
              <Unplug className="w-3.5 h-3.5" aria-hidden="true" />
              Disconnect project
            </Button>
          </div>
        )}

        {/* what syncs — always visible */}
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 space-y-1">
          <div className="text-[11px] font-semibold text-foreground/80 uppercase tracking-wide">
            What syncs
          </div>
          <p className="text-[11px] text-muted-foreground leading-snug">{counts || "…"}</p>
          <p className="text-[11px] text-muted-foreground leading-snug">
            Not synced: PDFs over ~4.8 MB (metadata still travels — re-upload the file on the other
            device), your AI provider key (never leaves the device), and in-progress test sessions.
            Deleting a record here deletes it everywhere (last-write-wins, including deletes).
          </p>
          {status.email ? (
            <p className="text-[11px] text-muted-foreground/80 leading-snug">
              Tip: run the first sync on the device with your most complete data.
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StepNum({ n }: { n: number }) {
  return (
    <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[11px] font-bold grid place-items-center shrink-0 mt-0.5">
      {n}
    </span>
  );
}
