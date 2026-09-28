"use client";

// ─── TodoCard — the Dashboard to-do list (replaces the old Today card) ──────
// Quick-capture for "what will I physically do": add with optional due date,
// tick off, delete. Everything lands in the `tasks` store and shows up on the
// Calendar too.
import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { EmptyNote, SectionCard } from "./shared";
import { del, put, useLive } from "@/lib/idb";
import { todayStr, uid, type Task } from "@/lib/types";

/** overdue → due-today → dated → undated, then oldest first */
function openRank(t: Task, today: string): number {
  if (!t.due_date) return 3;
  if (t.due_date < today) return 0;
  if (t.due_date === today) return 1;
  return 2;
}

function DueBadge({ task, today }: { task: Task; today: string }) {
  if (!task.due_date) return null;
  const overdue = task.due_date < today;
  const isToday = task.due_date === today;
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px] shrink-0",
        overdue
          ? "border-red-300 text-red-700 dark:border-red-500/40 dark:text-red-300"
          : isToday
            ? "border-amber-300 text-amber-800 dark:border-amber-500/40 dark:text-amber-300"
            : "border-border text-muted-foreground"
      )}
    >
      {overdue ? `overdue · ${task.due_date.slice(5)}` : isToday ? "today" : task.due_date.slice(5)}
    </Badge>
  );
}

export function TodoCard() {
  const tasks = useLive("tasks");
  const today = todayStr();
  const [text, setText] = useState("");
  const [due, setDue] = useState("");

  const open = useMemo(
    () =>
      tasks
        .filter((t) => !t.done)
        .sort(
          (a, b) =>
            openRank(a, today) - openRank(b, today) ||
            (a.due_date ?? "").localeCompare(b.due_date ?? "") ||
            a.created_at - b.created_at
        ),
    [tasks, today]
  );
  const done = useMemo(
    () => tasks.filter((t) => t.done).sort((a, b) => (b.done_at ?? 0) - (a.done_at ?? 0)),
    [tasks]
  );

  async function add() {
    const trimmed = text.trim();
    if (!trimmed) return;
    const task: Task = {
      id: uid(),
      text: trimmed,
      done: false,
      created_at: Date.now(),
      due_date: due || undefined,
    };
    await put("tasks", task);
    setText("");
    setDue("");
  }

  async function toggle(t: Task) {
    await put("tasks", { ...t, done: !t.done, done_at: !t.done ? Date.now() : undefined });
  }

  async function clearDone() {
    for (const t of done) await del("tasks", t.id);
    toast.success(`${done.length} completed task${done.length === 1 ? "" : "s"} cleared`);
  }

  const overdueCount = open.filter((t) => t.due_date && t.due_date < today).length;

  return (
    <SectionCard
      title="To-do"
      subtitle="plan the night, win the day"
      action={
        <Badge
          variant="outline"
          className={
            overdueCount > 0
              ? "border-red-300 text-red-700 dark:border-red-500/40 dark:text-red-300"
              : open.length === 0
                ? "border-border text-muted-foreground/70"
                : "border-sage-300 bg-sage-50 text-sage-700 dark:border-sage-500/40 dark:bg-sage-500/10 dark:text-sage-300"
          }
        >
          {overdueCount > 0 ? `${overdueCount} overdue` : `${open.length} open`}
        </Badge>
      }
    >
      {/* quick add */}
      <div className="flex flex-col gap-1.5">
        <div className="flex gap-1.5">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void add()}
            placeholder="e.g. Redo Q2–Q5 of yesterday's Kinematics test"
            aria-label="New task"
          />
          <Button size="sm" className="px-2.5 shrink-0" onClick={() => void add()} aria-label="Add task">
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            aria-label="Due date (optional)"
            className="h-7 rounded-md border border-input bg-transparent px-2 text-[11px] text-muted-foreground"
          />
          <span className="text-[11px] text-muted-foreground/70">
            optional due date — dated tasks appear on the Calendar
          </span>
        </div>
      </div>

      {/* open tasks */}
      <ul className="space-y-1.5 mt-3 max-h-64 overflow-y-auto pr-1">
        {open.length === 0 ? (
          <li className="py-2">
            <EmptyNote>All clear. Add what you will physically do next.</EmptyNote>
          </li>
        ) : (
          open.map((t) => (
            <li
              key={t.id}
              className="group flex items-center gap-2.5 rounded-lg border border-border px-2.5 py-2 hover:bg-accent/40 transition-colors"
            >
              <input
                type="checkbox"
                checked={false}
                onChange={() => void toggle(t)}
                aria-label={t.text}
                className="h-4 w-4 shrink-0 accent-[#c15f3c] dark:accent-[#d97757] cursor-pointer"
              />
              <span className="text-sm text-foreground flex-1 min-w-0">{t.text}</span>
              <DueBadge task={t} today={today} />
              <button
                onClick={() => void del("tasks", t.id)}
                className="opacity-40 group-hover:opacity-100 text-muted-foreground hover:text-red-500 transition-opacity shrink-0"
                aria-label={`Delete task: ${t.text}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))
        )}
      </ul>

      {/* completed */}
      {done.length > 0 ? (
        <div className="mt-3 pt-3 border-t border-border">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground/70 font-medium">
              {done.length} done
            </span>
            <button
              onClick={() => void clearDone()}
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear completed
            </button>
          </div>
          <ul className="space-y-1 max-h-28 overflow-y-auto pr-1">
            {done.slice(0, 8).map((t) => (
              <li key={t.id} className="flex items-center gap-2.5 px-2.5 py-1">
                <input
                  type="checkbox"
                  checked
                  onChange={() => void toggle(t)}
                  aria-label={`Reopen task: ${t.text}`}
                  className="h-3.5 w-3.5 shrink-0 accent-[#c15f3c] dark:accent-[#d97757] cursor-pointer"
                />
                <span className="text-xs text-muted-foreground/60 line-through flex-1 min-w-0 truncate">
                  {t.text}
                </span>
                <button
                  onClick={() => void del("tasks", t.id)}
                  className="opacity-40 hover:opacity-100 text-muted-foreground hover:text-red-500 transition-opacity shrink-0"
                  aria-label={`Delete task: ${t.text}`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </SectionCard>
  );
}
