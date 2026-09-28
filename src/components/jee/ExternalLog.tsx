"use client";

// ─── External test log — Abhyas / SATHEE / Allen data enters the system ─────
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { NavController } from "./App";
import { EmptyNote, PageTitle, SectionCard, StatCard } from "./shared";
import { useLive, put, del } from "@/lib/idb";
import { todayStr, uid, type TestRecord } from "@/lib/types";

const SOURCES = ["Abhyas", "SATHEE", "Allen", "NTA official", "Other"] as const;

export function ExternalLogView({ nav }: { nav: NavController }) {
  const tests = useLive("tests");
  const [date, setDate] = useState(todayStr());
  const [source, setSource] = useState<(typeof SOURCES)[number]>("Abhyas");
  const [sourceOther, setSourceOther] = useState("");
  const [duration, setDuration] = useState("180");
  const [maxScore, setMaxScore] = useState("300");
  const [score, setScore] = useState("");
  const [pScore, setPScore] = useState("");
  const [cScore, setCScore] = useState("");
  const [mScore, setMScore] = useState("");
  const [attempts, setAttempts] = useState("");
  const [wrong, setWrong] = useState("");
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const maxNum = Math.max(1, Number(maxScore) || 300);
  const perMax = Math.ceil(maxNum / 3);

  const external = useMemo(
    () =>
      tests
        .filter((t) => t.type === "external")
        .sort((a, b) => b.created_at - a.created_at),
    [tests]
  );

  const best = useMemo(() => {
    return external.reduce<TestRecord | null>((m, t) => {
      const s = t.score ?? 0; // null = pending self-mark (never for external, but be safe)
      if (m === null || s > (m.score ?? 0)) return t;
      return m;
    }, null);
  }, [external]);
  const latest = external[0];

  function resetForm() {
    setDate(todayStr());
    setSource("Abhyas");
    setSourceOther("");
    setDuration("180");
    setMaxScore("300");
    setScore("");
    setPScore("");
    setCScore("");
    setMScore("");
    setAttempts("");
    setWrong("");
    setName("");
  }

  function startEdit(t: TestRecord) {
    setEditingId(t.id);
    setDate(t.date);
    const known = SOURCES.find((s) => s === t.source);
    if (known) {
      setSource(known);
      setSourceOther("");
    } else {
      setSource("Other");
      setSourceOther(t.source);
    }
    setDuration(String(t.duration_min));
    setMaxScore(String(t.max_score));
    setScore(t.score === null ? "" : String(t.score));
    setPScore(t.subject_scores.Physics !== undefined ? String(t.subject_scores.Physics) : "");
    setCScore(t.subject_scores.Chemistry !== undefined ? String(t.subject_scores.Chemistry) : "");
    setMScore(t.subject_scores.Mathematics !== undefined ? String(t.subject_scores.Mathematics) : "");
    setAttempts(t.external_meta ? String(t.external_meta.attempts) : "");
    setWrong(t.external_meta ? String(t.external_meta.wrong) : "");
    setName(t.name);
  }

  function cancelEdit() {
    setEditingId(null);
    resetForm();
  }

  async function save() {
    const sc = Number(score);
    if (score.trim() === "" || Number.isNaN(sc)) {
      toast.error("Total score must be a number");
      return;
    }
    if (sc > maxNum) {
      toast.error(`Total score can't exceed the max (${maxNum})`);
      return;
    }
    const ps = Number(pScore) || 0;
    const cs = Number(cScore) || 0;
    const ms = Number(mScore) || 0;
    if (ps > perMax || cs > perMax || ms > perMax) {
      toast.error(`Subject scores can't exceed ${perMax} (a third of the ${maxNum} max)`);
      return;
    }
    const att = attempts.trim() === "" ? undefined : Number(attempts);
    const wr = wrong.trim() === "" ? undefined : Number(wrong);
    if ((att !== undefined && Number.isNaN(att)) || (wr !== undefined && Number.isNaN(wr))) {
      toast.error("Attempts / wrong must be numbers");
      return;
    }
    const src = source === "Other" ? sourceOther.trim() || "Other" : source;
    const common = {
      date: date || todayStr(),
      name: name.trim() || `${src} full mock`,
      source: src,
      type: "external" as const,
      duration_min: Number(duration) || 180,
      score: sc,
      max_score: maxNum,
      subject_scores: { Physics: ps, Chemistry: cs, Mathematics: ms },
      external_meta:
        att !== undefined && wr !== undefined ? { attempts: att, wrong: wr } : undefined,
    };
    if (editingId) {
      const existing = tests.find((t) => t.id === editingId);
      if (!existing) {
        toast.error("Entry no longer exists");
        cancelEdit();
        return;
      }
      await put("tests", { ...existing, ...common });
      toast.success("Entry updated — graphs recalculated");
    } else {
      const record: TestRecord = { id: uid(), created_at: Date.now(), ...common };
      await put("tests", record);
      toast.success("External test logged — graphs updated");
    }
    cancelEdit();
  }

  return (
    <div className="space-y-6">
      <PageTitle
        title="Log External Test"
        subtitle="Abhyas and SATHEE stay your real full-syllabus simulators — this app is the analytics layer over all testing. Without this form, your most important mock data never enters the graphs."
        right={
          <Button variant="outline" size="sm" onClick={() => nav.go("dashboard")}>
            ← Dashboard
          </Button>
        }
      />

      <div className="grid lg:grid-cols-5 gap-6">
        <SectionCard
          title={editingId ? "Edit entry" : "New entry"}
          subtitle={editingId ? "updating an existing mock — Update to save" : "~10 fields, one minute"}
          className="lg:col-span-2"
          action={
            editingId ? (
              <button
                type="button"
                onClick={cancelEdit}
                className="text-xs text-muted-foreground underline hover:text-foreground"
              >
                Cancel edit
              </button>
            ) : undefined
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Source</Label>
              <Select value={source} onValueChange={(v) => setSource(v as (typeof SOURCES)[number])}>
                <SelectTrigger aria-label="Source"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SOURCES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {source === "Other" ? (
              <div className="space-y-1.5 col-span-2">
                <Label className="text-xs">Source name</Label>
                <Input value={sourceOther} onChange={(e) => setSourceOther(e.target.value)} placeholder="coaching / platform name" />
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label className="text-xs">Duration (min)</Label>
              <Input value={duration} onChange={(e) => setDuration(e.target.value)} inputMode="numeric" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Total max</Label>
              <Input value={maxScore} onChange={(e) => setMaxScore(e.target.value)} inputMode="numeric" />
              <p className="text-[11px] text-muted-foreground/70">subject max shown as ⌈max/3⌉</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Total score / {maxNum}</Label>
              <Input value={score} onChange={(e) => setScore(e.target.value)} inputMode="numeric" placeholder="e.g. 187" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Physics score / {perMax}</Label>
              <Input value={pScore} onChange={(e) => setPScore(e.target.value)} inputMode="numeric" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Chemistry score / {perMax}</Label>
              <Input value={cScore} onChange={(e) => setCScore(e.target.value)} inputMode="numeric" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Maths score / {perMax}</Label>
              <Input value={mScore} onChange={(e) => setMScore(e.target.value)} inputMode="numeric" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Attempts</Label>
              <Input value={attempts} onChange={(e) => setAttempts(e.target.value)} inputMode="numeric" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Wrong count</Label>
              <Input value={wrong} onChange={(e) => setWrong(e.target.value)} inputMode="numeric" />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label className="text-xs">Label (optional)</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Abhyas mock #4" />
            </div>
          </div>
          <Button onClick={save} className="w-full mt-4 bg-primary hover:bg-primary/90">
            {editingId ? "Update test" : "Log test"}
          </Button>
          <p className="text-[11px] text-muted-foreground/70 mt-3">
            Correct-under-time from external mocks is estimated as attempts − wrong. Marks lost to
            negatives = wrong count (each −1).
          </p>
        </SectionCard>

        <div className="lg:col-span-3 space-y-6">
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Mocks logged" value={external.length} />
            <StatCard
              label="Best score"
              value={best && best.score !== null ? `${best.score}/${best.max_score}` : "—"}
              tone="good"
            />
          </div>
          <SectionCard title="Logged external tests">
            {external.length === 0 ? (
              <EmptyNote>
                No external tests yet. Your next Abhyas mock should land here the same evening.
              </EmptyNote>
            ) : (
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground/70 uppercase">
                    <tr>
                      <th className="py-2 pr-3">Date</th>
                      <th className="py-2 pr-3">Source</th>
                      <th className="py-2 pr-3 text-right">Score</th>
                      <th className="py-2 pr-3 text-right">P</th>
                      <th className="py-2 pr-3 text-right">C</th>
                      <th className="py-2 pr-3 text-right">M</th>
                      <th className="py-2 pr-3 text-right">Att / Wrong</th>
                      <th className="py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {external.map((t) => (
                      <tr
                        key={t.id}
                        className={cn(
                          "border-t border-border/60",
                          editingId === t.id && "bg-emerald-50 dark:bg-emerald-500/10/60"
                        )}
                      >
                        <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">{t.date}</td>
                        <td className="py-2 pr-3">
                          <Badge variant="outline" className="border-border text-muted-foreground">
                            {t.source}
                          </Badge>
                        </td>
                        <td className="py-2 pr-3 text-right font-semibold tabular-nums">
                          {t.score === null ? "pending" : t.score}
                          <span className="text-muted-foreground/70 font-normal">/{t.max_score}</span>
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{t.subject_scores.Physics ?? "—"}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{t.subject_scores.Chemistry ?? "—"}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{t.subject_scores.Mathematics ?? "—"}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                          {t.external_meta ? `${t.external_meta.attempts} / ${t.external_meta.wrong}` : "—"}
                        </td>
                        <td className="py-2 text-right whitespace-nowrap">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              if (editingId === t.id) {
                                cancelEdit();
                              } else {
                                startEdit(t);
                              }
                            }}
                          >
                            {editingId === t.id ? "Editing…" : "Edit"}
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-red-500 dark:text-red-400 hover:text-red-600 hover:bg-red-50 dark:bg-red-500/10 dark:hover:bg-red-500/10"
                              >
                                Delete
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  “{t.name}” ({t.date},{" "}
                                  {t.score === null ? "pending" : `${t.score}/${t.max_score}`}) will be
                                  removed and every graph recalculated. This cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Keep it</AlertDialogCancel>
                                <AlertDialogAction
                                  className="bg-red-600 hover:bg-red-700"
                                  onClick={() => {
                                    del("tests", t.id);
                                    toast.success("Entry removed");
                                    if (editingId === t.id) cancelEdit();
                                  }}
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
          {latest ? (
            <p className="text-xs text-muted-foreground/70">
              Last logged: <strong className="text-muted-foreground">{latest.name}</strong> on {latest.date} —{" "}
              {latest.score === null ? "pending" : `${latest.score}/${latest.max_score}`}.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
