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
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
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
  const [score, setScore] = useState("");
  const [pScore, setPScore] = useState("");
  const [cScore, setCScore] = useState("");
  const [mScore, setMScore] = useState("");
  const [attempts, setAttempts] = useState("");
  const [wrong, setWrong] = useState("");
  const [name, setName] = useState("");

  const external = useMemo(
    () =>
      tests
        .filter((t) => t.type === "external")
        .sort((a, b) => b.created_at - a.created_at),
    [tests]
  );

  const best = useMemo(
    () => external.reduce((m, t) => Math.max(m, t.score), 0),
    [external]
  );
  const latest = external[0];

  async function save() {
    const sc = Number(score);
    if (Number.isNaN(sc)) {
      toast.error("Total score must be a number");
      return;
    }
    const att = attempts.trim() === "" ? undefined : Number(attempts);
    const wr = wrong.trim() === "" ? undefined : Number(wrong);
    if ((att !== undefined && Number.isNaN(att)) || (wr !== undefined && Number.isNaN(wr))) {
      toast.error("Attempts / wrong must be numbers");
      return;
    }
    const src = source === "Other" ? sourceOther.trim() || "Other" : source;
    const record: TestRecord = {
      id: uid(),
      date: date || todayStr(),
      created_at: Date.now(),
      name: name.trim() || `${src} full mock`,
      source: src,
      type: "external",
      duration_min: Number(duration) || 180,
      score: sc,
      max_score: 300,
      subject_scores: {
        Physics: Number(pScore) || 0,
        Chemistry: Number(cScore) || 0,
        Mathematics: Number(mScore) || 0,
      },
      external_meta:
        att !== undefined && wr !== undefined ? { attempts: att, wrong: wr } : undefined,
    };
    await put("tests", record);
    toast.success("External test logged — graphs updated");
    setScore("");
    setPScore("");
    setCScore("");
    setMScore("");
    setAttempts("");
    setWrong("");
    setName("");
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
        <SectionCard title="New entry" subtitle="~10 fields, one minute" className="lg:col-span-2">
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
              <Label className="text-xs">Total score / 300</Label>
              <Input value={score} onChange={(e) => setScore(e.target.value)} inputMode="numeric" placeholder="e.g. 187" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Physics score / 100</Label>
              <Input value={pScore} onChange={(e) => setPScore(e.target.value)} inputMode="numeric" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Chemistry score / 100</Label>
              <Input value={cScore} onChange={(e) => setCScore(e.target.value)} inputMode="numeric" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Maths score / 100</Label>
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
          <Button onClick={save} className="w-full mt-4 bg-emerald-700 hover:bg-emerald-800">
            Log test
          </Button>
          <p className="text-[11px] text-stone-400 mt-3">
            Correct-under-time from external mocks is estimated as attempts − wrong. Marks lost to
            negatives = wrong count (each −1).
          </p>
        </SectionCard>

        <div className="lg:col-span-3 space-y-6">
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Mocks logged" value={external.length} />
            <StatCard label="Best score" value={`${best}/300`} tone="good" />
          </div>
          <SectionCard title="Logged external tests">
            {external.length === 0 ? (
              <EmptyNote>
                No external tests yet. Your next Abhyas mock should land here the same evening.
              </EmptyNote>
            ) : (
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-stone-400 uppercase">
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
                      <tr key={t.id} className="border-t border-stone-100">
                        <td className="py-2 pr-3 text-stone-500 whitespace-nowrap">{t.date}</td>
                        <td className="py-2 pr-3">
                          <Badge variant="outline" className="border-stone-300 text-stone-600">
                            {t.source}
                          </Badge>
                        </td>
                        <td className="py-2 pr-3 text-right font-semibold tabular-nums">
                          {t.score}
                          <span className="text-stone-400 font-normal">/300</span>
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-stone-600">{t.subject_scores.Physics ?? "—"}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-stone-600">{t.subject_scores.Chemistry ?? "—"}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-stone-600">{t.subject_scores.Mathematics ?? "—"}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-stone-500">
                          {t.external_meta ? `${t.external_meta.attempts} / ${t.external_meta.wrong}` : "—"}
                        </td>
                        <td className="py-2 text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-500 hover:text-red-600 hover:bg-red-50"
                            onClick={() => {
                              del("tests", t.id);
                              toast.success("Entry removed");
                            }}
                          >
                            Delete
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
          {latest ? (
            <p className="text-xs text-stone-400">
              Last logged: <strong className="text-stone-600">{latest.name}</strong> on {latest.date} — {latest.score}/300.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
