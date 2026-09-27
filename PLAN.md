# JEE Study App — Master Plan v3 (ALL features)

Date: 2026-09-27 · Status: MVP built & verified → this is the full-app upgrade plan:
every module audited against the real code, sized into 6 one-session sprints, then freeze.
Supersedes the CBT-only roadmap in v2 (v2 §1 explanation of Page-Mode remains valid).

---

## 1. How answer checking works — no AI, explained simply + technically

### 1.1 Simple words (the red-pen analogy)
Checking answers is exactly what you do with a red pen and a printed key — the app just does it 75× faster:

1. When you tap **B** for Q7, the app saves "Q7 → B". That's it. No reading, no understanding.
2. The key is a **clean list** the app already has: `1→A, 2→C, 3→B, …` (built when you pasted the key text).
3. On submit, for every question the app asks two things: *"What did the student pick?"* and *"What does the list say?"*
   - Same letter → **+4**. Different letter → **−1**. Nothing picked → **0**.
4. Numbers work the same way: you typed `7.5`, the list says `7.5` (± tolerance allowed) → +4.

The app never reads the question paper and never reads your mind — **your answer was already a letter/number the moment you tapped/typed it, and the key was already text the moment you pasted it.** Matching two symbols side by side is not intelligence; a calculator can do it. AI is only needed when a machine must *read* something messy (like a photo) — the app deliberately never does that.

Note: JEE Main MCQs are **single-correct only** — one letter per question, by design. Multi-correct exists only in JEE Advanced, which this app excludes.

### 1.2 Technical path (as built)
```
paste key text ──regex──▶ Map<Q# → "A"|"42.7">     (parseAnswerKey, PdfImport.tsx)
your taps    ──persist every action──▶ session.answers { Q#: "B" | 42.7 }
submit ──▶ for each slot:
   unattempted (blank/null)            → marks 0
   MCQ:  selected.toUpperCase() === key          → +4 : −1
   NUM:  |selected − key| ≤ tolerance + 1e-9     → +4 : −1
   accumulate score + subject_scores → ResponseRecord per question → analytics
```
The PDF is only ever **rendered** to a canvas (display) — never parsed. The only text parsing anywhere is the key regex. That's why it can't hallucinate or misread a question: there is nothing to misread.

### 1.3 "But what if I upload an answer-key PDF?"
- **Digital key PDF** (NTA official keys, most publisher keys — selectable text): pdf.js can extract the text layer and the same regex builds the list. **No AI needed** → added to Sprint A as "Key-PDF upload".
- **Scanned/photo key** (image inside a PDF): unreadable without OCR = AI → **excluded forever**. Fallback: type/paste the key, or use the editable key grid (Sprint A) — 30 numbers takes ~2 minutes.

### 1.4 Dirty keys, two-correct-option keys & bonus questions
Real keys are dirty in exactly three ways; all three are handled without AI:

1. **Messy formatting** — the parser tolerates the common shapes ("1. A", "1A", "1) b", "1. 42"), shows a live preview of what it understood, and flags every missing number. Final safety net (Sprint A3): an **editable key grid** — N cells, fix any cell by hand. A dirty key can cost you 2 minutes; it can never block a test.
2. **Two correct options** — NTA's revised keys sometimes accept two options ("7 → B/C"). Key cells will accept multiple values; checking becomes `selected ∈ {B, C}` → +4. (Sprint A7)
3. **Bonus / dropped questions** — everyone gets +4 regardless of answer; the grid gets a per-question "bonus" flag. (Sprint A7)

NOT supported: multi-correct *questions* where the student selects several options — that is JEE Advanced only. In JEE Main every question has exactly one answer you can select (even if the official key later accepts two alternatives — case 2 above).

### 1.5 Test length is always yours (never locked to 75/180)
75 Qs / 180 min is only the **full-mock preset**. In PDF mode *you* type Total questions (your PDF decides — that field is the source of truth) and any Duration. In bank tests, duration is a free input with a 1-min/question suggestion. Sprint A8 adds one-tap preset chips (15/30/60/90/180) on top. Also fixed in Sprint A: sheets whose numbering doesn't start at 1 (e.g. Q21–Q45) currently mis-align — a "First question #" field makes the palette mirror the paper exactly.

### 1.6 Wrong-question review never requires making an answer sheet
Scoring needs only the key (letters — already exists). Learning from wrongs needs **zero mandatory typing**: the C/F/A/R/T/G tag is one tap and captures *why* it went wrong; Sprint D adds an optional one-line note ("the actual insight") and an optional **solution photo** — snap the printed solution from your coaching material and attach it to that question. Nothing to build for every question; attach only where it's worth it. The retry-wrong test (D1) is the real "solution practice".

---

## 2. Research inputs

### 2.1 Codebase audit (every module read)
| Module | Biggest gaps found |
|---|---|
| App shell | No deep links (refresh loses view/results), discard has no confirm |
| Dashboard/Today | Nothing actionable (can't click amber chapter → test it), no countdown/streak, timeline mixes different max-scores unnormalized |
| Question Bank | **No edit** (typo = delete+retype), delete = 1-click destructive + dangling `question_ids` corrupt old tests, no image field, no KaTeX |
| Test Create | "Full mock" template doesn't enforce 20+5, no shuffle, no paper preview |
| Player | **Zero keyboard support**, no Previous button, purple "marked" hides "answered", PDF page-follow is estimate-only (no flip/zoom/pin) |
| Results | Q numbers re-index by filter (not real numbers), no subject filter, PDF review shows placeholders only |
| PDF Import | NTA official keys "(1)(2)(3)(4)" mis-parse as numericals, no PDF-numerical tolerance, no key grid editor, refresh before Start loses the file |
| External Log | No edit, max_score hardcoded 300, no delete confirm |
| Syllabus | Table forces horizontal scroll on phones, no reschedule/undo of revision loop, "DUE" doesn't show how overdue |
| Formula Sheet | No manual add, no "learned" state, no link back to source test |
| Data view | Export silently drops PDF blob, import accepts any JSON unvalidated, no backup nudge |

Cross-cutting: scoring constants (+4/−1/0) duplicated in 4 places; two toast systems mounted; ~40 unused shadcn components + Prisma/db.ts leftovers; no PWA manifest.

### 2.2 Web research (Sep 2026)
- **Competitors** (Melvano, JeeHub): sell "accuracy + speed + mistake-pattern tracking" and exam countdowns — our tracker does this locally and free; countdown validated as a motivating feature.
- **Learning science**: retrieval practice (pulling answers from memory) beats re-reading — validates the 1-3-7 revision loop and motivates a new feature: **re-test your wrong questions**.
- **Timeline**: JEE Main 2027 = Session 1 **January 2027**, Session 2 April 2027 → from today, Session 1 is ≈ **15 weeks** out. The app's job is compounding correct-under-time, not feature infinity.

---

## 3. Roadmap — 6 sprints (one 45–60 min session each), then freeze

### Sprint A — PDF test correctness ("answer checking" cluster)
| # | Item | Size |
|---|---|---|
| A1 | NTA option-number keys: toggle "(1)(2)(3)(4) → A/B/C/D" in PDF setup + auto-suggest when ≥80% of numeric answers ∈ {1,2,3,4} | S |
| A2 | Tolerance field for PDF numerical keys (default 0) | S |
| A3 | Editable key grid after paste (fix any mis-parse without retyping text) | S |
| A4 | Key-PDF upload: pdf.js text-layer extraction → same regex (digital keys only; paste stays as fallback) | M |
| A5 | Persist PDF blob at file-pick (refresh before Start no longer loses the file) | S |
| A6 | "First question #" field — palette mirrors the paper's own numbering (sheet Q21–Q45 works; attempted-but-keyless questions no longer auto-scored −1) | S |
| A7 | Multi-answer key cells ("7 → B/C" for revised NTA keys) + per-question "bonus/dropped" flag (+4 to all) | S |
| A8 | Duration preset chips (15/30/60/90/180 + custom) in PDF setup — question count always follows your PDF | S |

### Sprint B — Player speed + full-paper mode
| # | Item | Size |
|---|---|---|
| B1 | Keyboard: 1–4 / A–D select, Enter save&next, ← previous, M mark, C clear | S |
| B2 | Previous button + NTA contrast fix (marked = purple outline over answered green) | S |
| B3 | **Full-paper PDF mode**: section rows [P/C/M × first Q, last Q, start page] → one palette with P/C/M tabs, 90/180-min presets, per-section subject scores | M–L |
| B4 | PDF panel: prev/next page arrows + page input + zoom steps + "pin page to Qn" override | M |
| B5 | Timer color stages (amber at 10 min, red at 2) | S |

### Sprint C — Safety & data integrity
| # | Item | Size |
|---|---|---|
| C1 | Delete confirmations (question / formula / external log) + guard: warn when deleting a bank question used by saved tests | S |
| C2 | Import validation (`_meta.app` check + per-store shape check) | S |
| C3 | Export hygiene: encode kv blobs as base64 (or exclude with warning); backup nudge if last export > 7 days | S |
| C4 | `navigator.storage.persist()` on first run | S |
| C5 | Discard-session confirm + deep links (persist current view + resultsTestId in kv → refresh keeps context) | M |
| C6 | Single scoring-config module (one source of truth for +4/−1/0; unlocks C7) | S |
| C7 | External log: edit-in-place + configurable max_score | S |

### Sprint D — The learning loop (retrieval practice)
| # | Item | Size |
|---|---|---|
| D1 | **Retry-wrong-as-new-test**: button on Results → builds a new test from that test's wrong/unattempted questions | M |
| D2 | Question Bank: edit-in-place + optional image per question (clipboard paste → dataURL; renders in bank + player) | M |
| D3 | Results: real question numbers (store original index), subject filter chips, "next untagged" jump | S |
| D4 | Key-later PDF mode: start without key → Correct/Wrong self-mark toggles in review; analytics recompute | M |
| D5 | Action-linked analytics: amber / repeated-failure rows → one-click "Test this chapter" (pre-filled TestCreate) | S |
| D6 | Formula sheet: manual add, "Mark learned", link back to source test | S |
| D7 | Optional one-line note per wrong question in Results ("the actual insight"), stored on the response | S |
| D8 | Optional solution-photo attach per wrong question (paste/upload → viewable in review); never mandatory | M |

### Sprint E — Dashboard, tracker & motivation
| # | Item | Size |
|---|---|---|
| E1 | **Exam countdown** (target date in kv, default JEE Main 2027 S1 ≈ Jan 22, editable) in header | S |
| E2 | **Study streak** (Today card 4/4 → streak +1; shown next to countdown) | S |
| E3 | Normalized timeline (% of max) + error tags as % | S |
| E4 | Syllabus: mobile card layout (<md), "due N days ago" in red, reschedule date picker, notes debounce-save | M |
| E5 | Today card: blur-save + stale-state race fix | S |

### Sprint F — Polish & ship
| # | Item | Size |
|---|---|---|
| F1 | PWA manifest + offline shell (true "local-first": app opens with no network) | S–M |
| F2 | Mobile pass: Player palette sizing, Syllabus table | S |
| F3 | Onboarding: first-run 3-step hint + link demo PDF + demo questions from Data tab | S |
| F4 | (Optional) purge dead deps/code (prisma, unused ui components, dual toaster) | S |

**Then FREEZE.** After Sprint F: bug fixes only. ~15 weeks to Session 1 — studying wins.

---

## 4. Master verdict table (every module)

| Module | Verdict | Changes |
|---|---|---|
| App shell | **Upgrade** | Deep links, discard confirm, countdown+streak in header |
| Dashboard / Today | **Upgrade** | Action-linked analytics, countdown, streak, normalized charts, race fixes |
| Question Bank | **Upgrade** | Edit-in-place, image paste, delete safety |
| Test Create | **Upgrade** | Full-mock enforcement warning, shuffle, paper preview (small) |
| Player | **Upgrade** | Keyboard, Previous, NTA colors, full-paper mode, PDF nav/zoom/pin |
| Results / Review | **Upgrade** | Real Q numbers, filters, retry-wrong, key-later self-mark, per-Q notes + solution photos |
| PDF Import | **Upgrade** | NTA key mapping, tolerance, key grid, key-PDF upload, blob persistence, first-Q#, multi-answer keys, presets |
| External Log | **Upgrade** | Edit-in-place, configurable max, confirm |
| Syllabus tracker | **Upgrade** | Mobile layout, reschedule, overdue display, test-this-chapter |
| Formula Sheet | **Upgrade** | Manual add, learned state, source links |
| Data view | **Upgrade** | Export/import hygiene, backup nudge, storage.persist |
| PWA/offline | **Add** | Manifest + service worker shell |
| Settings module | **Excluded** | Target date + backup state live in kv/header; a full settings page is not justified |
| Dark mode | **Excluded** | Cost > value for one user |
| Cross-device sync server | **Excluded** | JSON export/import stays the only sync (by design) |

## 5. Excluded forever (unchanged + explicit)
AI/OCR of scanned keys or papers · multi-correct questions where several options must be selected (Advanced-only — note: multi-answer KEYS from revised NTA keys ARE supported, A7) · mandatory solution-writing (review = tag + optional note/photo, never a full answer sheet) · optional Section B (removed from 2025 pattern) · backend/auth/accounts · cloud sync · social · PYQ content database · video · native mobile app · notifications · paid anything.
Phase-2 triggers unchanged: NTA regex paper-parser, mixed-test builder, AnkiConnect, formula print view.

## 6. Acceptance checklist v3 ("fully functional for an aspirant") — VERIFIED 2026-09-27
- [x] Paste OR upload a digital NTA key → scores correctly, every format — including dirty keys, two-option keys and bonus questions (Sprint A) ✅ browser-verified
- [x] Test length always matches your PDF: any count, any duration, any starting question number (Sprint A) ✅ Q21–28 offset drill verified
- [x] Wrong-question review with zero mandatory typing: tag + optional note/photo (Sprint D) ✅
- [x] A 75-Q PYQ PDF runs as one 180-min test with P/C/M sections (Sprint B) ✅ verified on a 3-section mini paper (31/36 exact)
- [x] Player fully keyboard-driven; page-follow never traps you (Sprint B) ✅ 1-4/A-D, Enter, ←, M, C + page flip/zoom/pin
- [x] No destructive action without confirm; data export/import round-trips losslessly (Sprint C) ✅ delete confirms, in-N-tests warning, bad-import refused, last-export-at nudge
- [x] Wrong questions re-testable in one click; every module's mistakes feed the loop (Sprint D) ✅ Retry wrong (N) verified end-to-end
- [x] Header shows days-left + streak; every analytics row is actionable (Sprint E) ✅ 117→99-day countdown editor, streak, amber-row Test buttons
- [x] App opens offline from home screen (Sprint F) ✅ PWA manifest + network-first SW with offline fallback
- [ ] Daily loop: Today card → drill (PDF/bank) → tag → revise due → dashboard, ≤10 min app time/day
