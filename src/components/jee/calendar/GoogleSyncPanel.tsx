"use client";

// ─── GoogleSyncPanel — one-way sync app → Google Calendar ────────────────────
// Local-first OAuth: Google Identity Services token client with the user's
// own OAuth Client ID (same architecture Super Productivity uses; Google
// requires each web origin to be an authorized JavaScript origin, so the
// client id cannot be hardcoded). Setup is a 5-step wizard with the origin
// pre-filled and copyable.
import { useState } from "react";
import {
  CalendarCheck2,
  Check,
  CloudUpload,
  Copy,
  ExternalLink,
  Info,
  Loader2,
  RefreshCcw,
  Settings2,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  disconnectGoogle,
  ensureToken,
  getClientId,
  resetSyncState,
  setClientId,
  type SyncOptions,
  type SyncResult,
} from "@/lib/gcal";

interface Props {
  connected: boolean;
  syncing: boolean;
  lastSync: SyncResult | null;
  options: SyncOptions;
  onOptionsChange: (o: SyncOptions) => void;
  onSyncNow: () => void;
  onConnectedChange: (c: boolean) => void;
}

function fmtAgo(at: number): string {
  const s = Math.round((Date.now() - at) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(at).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function GoogleSyncPanel({ connected, syncing, lastSync, options, onOptionsChange, onSyncNow, onConnectedChange }: Props) {
  const [setupOpen, setSetupOpen] = useState(false);
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1.5" aria-label="Google Calendar sync">
            {syncing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CloudUpload className="h-3.5 w-3.5" />
            )}
            <span className="hidden sm:inline">Google</span>
            <span
              aria-hidden="true"
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                connected ? (lastSync && lastSync.errors.length === 0 ? "bg-sage-500" : lastSync ? "bg-amber-500" : "bg-sky-500") : "bg-muted-foreground/30"
              )}
            />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-4 space-y-3">
          <div className="flex items-start gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-primary/10 grid place-items-center shrink-0">
              <CalendarCheck2 className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold leading-tight">Google Calendar sync</div>
              <div className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                One-way, app → Google. Everything on this calendar is mirrored to your Google calendar.
              </div>
            </div>
          </div>

          {!connected ? (
            <div className="space-y-2.5">
              <p className="text-xs text-muted-foreground leading-relaxed">
                No account linked yet. Takes about two minutes with your own Google Cloud client ID —
                the wizard walks you through it.
              </p>
              <Button size="sm" className="w-full" onClick={() => setSetupOpen(true)}>
                <Settings2 className="h-3.5 w-3.5 mr-1.5" /> Set up Google Sync
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border border-border px-2.5 py-2 space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  <Check className="h-3.5 w-3.5 text-sage-600 dark:text-sage-400" /> Connected
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {lastSync
                    ? `Last synced ${fmtAgo(lastSync.at)} · ${lastSync.created} created · ${lastSync.updated} updated · ${lastSync.deleted} removed`
                    : "Never synced yet — press Sync now."}
                </div>
                {lastSync && lastSync.errors.length > 0 ? (
                  <div className="text-[11px] text-red-600 dark:text-red-400 leading-snug">
                    {lastSync.errors.length} error{lastSync.errors.length === 1 ? "" : "s"}: {lastSync.errors[0]}
                    {lastSync.errors.length > 1 ? ` (+${lastSync.errors.length - 1} more)` : ""}
                  </div>
                ) : null}
              </div>

              <Button size="sm" className="w-full" onClick={onSyncNow} disabled={syncing}>
                {syncing ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5 mr-1.5" />}
                {syncing ? "Syncing…" : "Sync now"}
              </Button>

              <div className="space-y-2 pt-1">
                <label className="flex items-center justify-between gap-3 text-xs cursor-pointer">
                  <span className="text-muted-foreground">Include tests, revisions &amp; to-dos</span>
                  <Switch
                    checked={options.includeStudyPlan}
                    onCheckedChange={(v) => onOptionsChange({ ...options, includeStudyPlan: v })}
                    aria-label="Include study plan items in sync"
                  />
                </label>
                <label className="flex items-center justify-between gap-3 text-xs cursor-pointer">
                  <span className="text-muted-foreground">Auto-sync after changes</span>
                  <Switch
                    checked={options.autoSync}
                    onCheckedChange={(v) => onOptionsChange({ ...options, autoSync: v })}
                    aria-label="Auto-sync after changes"
                  />
                </label>
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-border">
                <button className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline" onClick={() => setSetupOpen(true)}>
                  Manage connection
                </button>
                <button
                  className="text-[11px] text-muted-foreground hover:text-red-600"
                  onClick={() => {
                    disconnectGoogle();
                    toast.success("Disconnected — the sync map is kept, so re-connecting won't duplicate events");
                  }}
                >
                  Sign out
                </button>
              </div>
            </div>
          )}

          <p className="text-[10px] text-muted-foreground/70 leading-snug flex gap-1.5">
            <Info className="h-3 w-3 shrink-0 mt-px" />
            Your data goes straight from this browser to Google — nothing passes through any server
            of ours. Completing a to-do or a revision removes its Google event on the next sync.
          </p>
        </PopoverContent>
      </Popover>

      {/* setup wizard */}
      <Dialog open={setupOpen} onOpenChange={setSetupOpen}>
        {setupOpen ? (
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Connect Google Calendar</DialogTitle>
            <DialogDescription>
              One-time setup — the app talks to Google directly from your browser (OAuth, no server).
            </DialogDescription>
          </DialogHeader>
          <ol className="space-y-3 text-xs leading-relaxed text-muted-foreground">
            <li className="flex gap-2.5">
              <Step n={1} />
              <span>
                Open{" "}
                <a className="text-primary font-medium hover:underline inline-flex items-center gap-0.5" href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">
                  console.cloud.google.com <ExternalLink className="h-3 w-3" />
                </a>{" "}
                and create (or pick) a project.
              </span>
            </li>
            <li className="flex gap-2.5">
              <Step n={2} />
              <span>
                In <b className="text-foreground">APIs &amp; Services → Library</b>, search and enable{" "}
                <b className="text-foreground">Google Calendar API</b>.
              </span>
            </li>
            <li className="flex gap-2.5">
              <Step n={3} />
              <span>
                <b className="text-foreground">OAuth consent screen</b>: choose <b className="text-foreground">External</b>, fill only the
                required fields, then under <b className="text-foreground">Test users</b> add your own Google account.
              </span>
            </li>
            <li className="flex gap-2.5">
              <Step n={4} />
              <span>
                <b className="text-foreground">Credentials → Create credentials → OAuth client ID</b>, type{" "}
                <b className="text-foreground">Web application</b>. Under{" "}
                <b className="text-foreground">Authorized JavaScript origins</b> add this exact origin:
                <span className="mt-1.5 flex items-center gap-1.5">
                  <code className="flex-1 min-w-0 truncate rounded bg-muted px-2 py-1 text-[11px] text-foreground">{origin}</code>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => {
                      void navigator.clipboard.writeText(origin);
                      toast.success("Origin copied");
                    }}
                    aria-label="Copy origin"
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </span>
              </span>
            </li>
            <li className="flex gap-2.5">
              <Step n={5} />
              <span>
                Copy the <b className="text-foreground">Client ID</b> (ends in <code>.apps.googleusercontent.com</code>) and paste it below.
              </span>
            </li>
          </ol>
          <div className="space-y-1.5">
            <Label htmlFor="gcal-cid">OAuth Client ID</Label>
            <SetupBody
              initialId={getClientId() ?? ""}
              origin={origin}
              onConnected={(c) => {
                onConnectedChange(c);
                if (c) setSetupOpen(false);
              }}
            />
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            <button
              className="text-[11px] text-muted-foreground hover:text-red-600"
              onClick={() => {
                resetSyncState();
                toast.success("Sync map reset — next sync will re-create every event");
              }}
            >
              Reset sync map
            </button>
            <span />
          </DialogFooter>
        </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}

function Step({ n }: { n: number }) {
  return (
    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
      {n}
    </span>
  );
}

// mounted only while the wizard dialog is open → draft state resets each time
function SetupBody({
  initialId,
  origin,
  onConnected,
}: {
  initialId: string;
  origin: string;
  onConnected: (c: boolean) => void;
}) {
  const [draftId, setDraftId] = useState(initialId);

  async function connect() {
    const id = draftId.trim();
    if (!id.includes(".apps.googleusercontent.com")) {
      toast.error("That doesn't look like an OAuth Client ID — it should end with .apps.googleusercontent.com");
      return;
    }
    setClientId(id);
    try {
      await ensureToken(true);
      onConnected(true);
      toast.success("Google Calendar connected — run your first sync");
    } catch (e) {
      onConnected(false);
      toast.error(e instanceof Error ? e.message : "Google sign-in failed", {
        description: "Check that this page's origin is listed as an Authorized JavaScript origin.",
      });
    }
  }

  return (
    <>
      <Input
        id="gcal-cid"
        value={draftId}
        onChange={(e) => setDraftId(e.target.value)}
        placeholder="1234567890-abc123.apps.googleusercontent.com"
        autoComplete="off"
        spellCheck={false}
        onKeyDown={(e) => e.key === "Enter" && void connect()}
      />
      <Button className="w-full mt-2" onClick={() => void connect()} disabled={!draftId.trim()}>
        <Check className="h-4 w-4 mr-1.5" /> Save &amp; connect
      </Button>
    </>
  );
}
