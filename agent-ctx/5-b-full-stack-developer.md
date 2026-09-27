# Task 5-b — Sprint B player (full-stack-developer)

## What landed
- `src/components/jee/Player.tsx` (owned file, full sprint) + one field in `src/lib/types.ts` (`pdf_meta.page_pins?: Record<string, number>`). Nothing else touched (App/PdfImport/Results/Dashboard untouched).
- **B1** window keydown handler (latest-ref pattern, attached once): `1-4`/`a-d` select MCQ option (no auto-advance), `Enter` save&next, `←` previous, `m` mark&next, `c` clear; ignores INPUT/TEXTAREA/SELECT/contentEditable targets, modifier combos, and open Radix dialogs; `preventDefault` on handled keys; header hint `⌨ 1-4 · Enter · ← · M · C` (hidden < md).
- **B2** Previous ghost button (disabled on Q1) left of Clear Response; NTA palette: answered = emerald fill, marked = purple outline, answered+marked = emerald fill + purple outline, current = yellow ring; legend updated (incl. "Answered & marked").
- **B3** slots from `pdf_meta.sections` — paper numbers `first_q..last_q`, per-section subject/chapter; P/C/M tabs with counts jump to first unanswered; submit accumulates `subject_scores` per slot subject, denormalizes section subject/chapter, `q_no` = paper number, snippet `PDF Q{paperNo} (page {page})`. Single-section sessions keep position-keyed answers/marked/q_times (slot key = position string) so resume of older sessions is byte-compatible.
- **A6** key lookup by paper number; page mapping per-section even-split `start_page + floor((no − first_q)/perPage)` with meta-level fallback.
- **A7** scoring via `marksFor()` in both modes: bonus → +4 regardless; `answers[]` membership (letters case-insensitive) else legacy single compare; numerical `|u − a| ≤ (tolerance ?? 0) + 1e-9`; attempted-keyless → 0; unattempted → 0.
- **B4** PDF panel: prev/next page, page input (clamped, commits on Enter/blur), zoom −/+ cycling [1.0, 1.4, 1.8, 2.2] (default state 1.6), "Pin Qn · p{page}" writes `pdf_meta.page_pins[paperNo]` via normal persist + toast; pin badge when pinned; render task cancel prevents canvas races.
- **B5** timer stages: ≤2 min red, ≤10 min amber, else normal; auto-submit at 0 unchanged.
- **D4** `key_later === true` → submit without scoring: `correct = null` always, `attempted` = answer exists, `TestRecord.score = null`, `subject_scores = {}`, duration/dates/type recorded, toast "Self-mark each question to compute your score.".

## Verification
- `bun run lint` 0 errors / 0 warnings; `bunx tsc --noEmit` 0 errors; `GET /` 200, dev.log clean.
- In-browser E2E (seeded IndexedDB sessions, cleaned up after): Q21-based 16-Q test → palette 21..36, keyboard shortcuts exercised, palette classes exact, pin persisted, submit → **score 7/64** = −1 (wrong letter) + 4 (43 within ±0.5 of 42.5) + 4 (bonus, unattempted) + 0×13; `q_no` 21..36; correct_answer "B/C" for multi-answer, "bonus" for bonus. Key-later (empty key): answered → `{sel:"42", att:true, correct:null}`, all `correct: null`, score null, subject_scores {}, toast shown.

## Decisions / notes for next sprint
- Internal slot keys stay position-based "1..N"; display numbers are paper numbers (commitTime/q_times compatibility).
- Bonus unattempted → +4 via `marksFor(attempted=true, …, bonus=true)`; ResponseRecord keeps honest `attempted:false` so accuracy analytics aren't inflated.
- Key-later questions render NUMERICAL controls (empty key carries no type info) — Results self-mark UI (next sprint) is where correctness lands.
- Additive extra: CBT panel renders `Question.image` when present (authoring is Sprint D2).
