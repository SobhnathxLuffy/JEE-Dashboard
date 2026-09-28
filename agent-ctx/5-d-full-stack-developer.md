# Task 5-d — Sprint E shell/dashboard/tracker — work record (full-stack-developer)

Task ID: 5-d
Scope: App shell, Dashboard, Syllabus tracker, motivation layer.
PLAN items: C3 (banner UI), C4, C5, D5, E1–E5, F3, F2 (Syllabus mobile layout only).

## Read before editing
- worklog.md Task 5-a/5-b/5-c entries (data contract, player, review side).
- App.tsx / Dashboard.tsx / Syllabus.tsx / shared.tsx (owned), TestCreate.tsx (prefill prop), idb.ts (kv API), types.ts, analytics.ts.

## Decisions
- New kv keys: "view", "results-testid", "target-exam-date" (default "2027-01-22"), "onboarded" ("1" = dismissed).
- Restore-on-load: kv "view" validated against the ViewName list; "player" falls back to "dashboard"; "results" requires kv "results-testid" else falls back. Restore happens regardless of a resumable session (banner renders above any view).
- Every view change goes through applyView() in App (go / openResults / startSession / resume) so kv "view" is always current; restore itself does not write back.
- NavController gains toTestCreate(prefill?) — go() clears any pending prefill so plain nav-pill navigation never carries a stale chapter.
- public/demo-paper.pdf did not exist — generated a small demo paper PDF so the F3 onboarding copy ("a demo paper ships with the app (/demo-paper.pdf)") is true.
- Streak: consecutive daily_log days with all 4 blocks true, ending today if complete else yesterday; chip shown in Today card header only when >= 1.
- Error-tag chart: bars stay raw counts; custom tooltip adds "% of tagged wrong" (cleaner than axis switch).
- Timeline: raw / % pill toggle, component state only; % = score/max*100 rounded.
- Syllabus: shared RevisionControls + DueBadge + NotesEditor used by both the md+ table and the <md card list; notes debounce 600 ms, flush on unmount, first-save toast only.

## Status log
- [in progress] implementation
