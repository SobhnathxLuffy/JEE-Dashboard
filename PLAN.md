# JEE Study App — Full-Usability Plan (v2.0)

Date: 2026-09-27 · Context: MVP (spec v2) is **built and browser-verified** (see worklog Task 1).
This plan answers (a) how CBT-from-PDF works without AI, (b) what separates the current build
from a daily-driver app a JEE aspirant actually uses every day, and (c) the sprint plan to close it.

---

## 1. How CBT test creation actually works — the no-AI answer

### 1.1 The misconception
"Upload PDF → app cuts each question out as a screenshot, numbers it, extracts options —
but how does it know where Q1 starts and ends?"

That approach (auto-segmentation) genuinely needs AI or fragile regex, and it fails on
scans, 2-column layouts, and coaching-module typography. **The app does not do this —
and it never needs to.**

### 1.2 Page-Mode: the PDF is never cut (as built, verified in code)
The PDF stays whole. The app is a **CBT layer laid on top of it**:

1. **Upload** — pdf.js reads the file 100% locally (never uploaded, page count detected).
2. **Map** — YOU tell the app four numbers: `start page`, `end page`,
   `total questions`, `duration`. No content parsing, no boundary detection.
3. **Palette is generated** — Q1…Qn appear as an NTA-style grid (green answered /
   purple marked / white untouched / yellow current) with Save & Next,
   Mark for Review & Next, Clear.
4. **Read from the PDF panel** — the player renders the page that (probably) holds the
   current question next to the palette and follows you as you move.
5. **Score** — after submit, +4 / −1 / 0 exactly like NTA (numerical included).

Setup cost: ~60 seconds. Works on scanned Arihant pages, coaching sheets, NTA PYQ PDFs —
anything, because the PDF is only ever *displayed*, never *understood*.

### 1.3 The only parsing that happens: the answer key
You paste the key ("1. A  2. C  3. B  4. 42"). A regex picks out
`number → letter` and `number → value` pairs. This is trivially reliable — answer keys
are rigid, regular tables, unlike question bodies. Live preview + coverage check
("missing: Q7, Q12") + unmatched questions score as unattempted after a confirm.

### 1.4 Four ways to get questions out of a PDF — and why Page-Mode won

| Approach | Accuracy | Per-test setup | Verdict |
|---|---|---|---|
| AI vision extraction | 90–95%, fails silently | ~0 | ❌ no AI budget, spec forbids |
| Regex on question text | only clean digital PDFs; breaks on scans/2-col | ~0 but fragile | ⏸ Phase 2 at most |
| Manual screenshot crops | perfect | 20–40 min per paper | ❌ kills the 45-min/day reality |
| **Page-Mode (built)** | **perfect — nothing extracted** | **~60 sec** | ✅ **shipped** |

### 1.5 Where the current build is deliberately simple (known limits)
- PDF panel follows you by a **linear estimate** (`questions ÷ pages`) — if a paper has
  uneven questions per page, the follow can land a page off; **no manual flip/zoom yet**.
- One **subject per PDF test** — a full 75-Q PYQ paper can't run as one test with P/C/M sections.
- Official NTA keys use option numbers **(1)(2)(3)(4)** — parser currently treats bare
  digits as *numerical answers*, so pasting an official key can mis-score MCQs.
- PDF numerical answers are **exact-match** (no tolerance field).
- Key must exist **before** the test starts (no key-later / self-mark mode).

These are exactly the gaps Sprint A–C close (§5).

---

## 2. What the research says (web, Sep 2026)

| Finding | Source | Consequence for the app |
|---|---|---|
| JEE Main pattern (stable since 2025 revision, unchanged for 2026/27 cycle): 75 Qs, 20 MCQ + 5 numerical per subject, 300 marks, 180 min, **+4/−1 applies to numerical too** | Careers360 / Shiksha / Vedantu syllabus pages | App scoring already matches; nothing to change |
| Syllabus 2026 = revised 2025 syllabus; whole-chapter deletions confirmed: **Mathematical Reasoning, Mathematical Inductions, Communication Systems** (Chem: Solid State etc.) | phodu.club / leverageedu / getmyuni | Seed excludes exactly these — correct, keep |
| **NTA Abhyas** = official free app, full-length CBT mocks matching real pattern/layout/difficulty (30L+ attempts in first 55 days) | Hindustan Times / Shiksha | Don't rebuild mocks — **log** Abhyas results via External Log (built) |
| **SATHEE** (IIT Kanpur + MoE) = free mock tests, PYQs, lectures | edexlive / theprint / sathee.iitk.ac.in | Same: source of full mocks → External Log |
| Topper method: 6–8 h/day split P/C/M, **front-load high-weightage chapters, log every mistake in an error notebook** | competer.in / esaral | Error tags (C/F/A/R/T/G) + Amber-first queue are exactly this, digitized |

Net: the app's bets (Page-Mode, external log, error tags, Tier-1-first) all match how the
exam is actually conducted and how self-studiers operate. No architectural corrections needed.

---

## 3. What's already built (v1 audit — verified in browser)

| Module | Status |
|---|---|
| IndexedDB layer, 7 stores, refresh-safe sessions, change pub/sub | ✅ |
| Syllabus seed: 65 chapters, Tier 1/2/3 badges, deleted chapters excluded | ✅ |
| Question Bank: MCQ + numerical entry (tolerance), filters subject/chapter/tier | ✅ |
| CBT Player: NTA palette, countdown + auto-submit, Save&Next / Mark&Next / Clear, per-question timing | ✅ |
| Scoring +4/−1/0 both types; numerical tolerance (bank) | ✅ |
| Results: score/accuracy/attempt-rate/negatives + per-Q review + tag buttons | ✅ |
| Error tags C/F/A/R/T/G; **F-tag auto-appends formula sheet** | ✅ |
| Page-Mode PDF import → player with page-following | ✅ |
| External test log (Abhyas/SATHEE, 10 fields) feeding analytics | ✅ |
| Dashboard: north-star (correct-under-time) + 5 spec metrics + Amber queue + revision-due strip | ✅ |
| Syllabus tracker: status chain, auto-color, 1→1→3→7-day revision loop | ✅ |
| Today card (4 blocks), JSON export/import, demo seed | ✅ |

Verified end-to-end in browser: seed → bank test → scoring → tags → formula sheet →
external log (north-star 6→63) → PDF test with generated paper → resume-after-refresh →
export. Console + lint clean.

---

## 4. Gap analysis — MVP → daily driver

| # | Gap | Why it matters | Effort | Sprint |
|---|---|---|---|---|
| G1 | **Official NTA keys use (1)(2)(3)(4)** — parser mis-reads them as numerical answers | Correctness bug class: pasting a real NTA key silently mis-scores MCQs | S | A |
| G2 | **No manual PDF page flip / zoom / page-pin** | Linear estimate lands wrong page on uneven papers → friction on every question | M | A |
| G3 | **No tolerance for PDF numerical keys** | "7.5" vs "7.50 ± 0.05" style answers marked wrong unfairly | S | A |
| G4 | **No storage-persist request / export nudge** | Browser can evict IndexedDB; data loss is the one unrecoverable failure | S | A |
| G5 | **No full-paper mode** (one PDF, 3 sections P/C/M, 180 min) | The actual JEE simulation need; Abhyas covers mocks but not YOUR PYQ PDFs | M–L | B |
| G6 | **No key-later / self-mark mode** | Many book PDFs have no pasteable key → currently unusable | M | C |
| G7 | Image paste into bank questions | Math-heavy bank entries hard to type | S | C (optional) |
| G8 | First-run hint strip | Onboarding polish | S | C (optional) |

(S = ≤15 min, M = 15–40 min, L = 40–60 min within a session)

---

## 5. Roadmap — three sprints, then freeze

**Sprint A — correctness + PDF ergonomics (one 45–60 min session)**
1. Key-format toggle in PDF setup: "options numbered (1)–(4) → A–D" + auto-suggest when ≥80% of numeric answers ∈ {1,2,3,4} *(G1)*
2. PDF panel: prev/next page arrows + page input + zoom steps (1.0/1.4/1.8/2.2) + "pin this page to Q_n" override saved per question *(G2)*
3. Default tolerance field for PDF numerical keys *(G3)*
4. `navigator.storage.persist()` on first run + export nudge if last export > 7 days *(G4)*

**Sprint B — full-paper mode (one session)**
5. PDF setup gains section rows: `[subject, chapter?, first Q, last Q, start page]` × 3 → one palette with P/C/M tabs, duration presets (90/180), per-section subject scores feeding the same analytics *(G5)*

**Sprint C — key-later + polish (one session)**
6. Start PDF test without key → review screen shows Correct/Wrong toggles per Q; analytics recompute on mark *(G6)*
7. Optional: clipboard image paste in bank entry *(G7)*; first-run hints *(G8)*

**Then FREEZE features.** Everything after this is bug-fixes only; studying wins.

---

## 6. The operating loop (what "fully usable" means in practice)

**Daily (fits 6–8 h study, app touches ≈ 10 min):**
- Open app → Today card ticks (Math 2h / Phy 1h45 / Chem 1h45 / Recall 30m)
- End of a chapter block → 15–25 Q drill: coaching-module PDF via Page-Mode (25 min setup incl.) or bank test
- Submit → tag every mistake (C/F/A/R/T/G) → F-tags land in formula sheet automatically
- Revision-due strip: tonight's "same-night" revisions; tracker arms +1d → +3d → +7d automatically

**Weekly:**
- One full mock: Abhyas/SATHEE on their app → 2-min External Log entry, or your own PYQ PDF via full-paper mode (after Sprint B)
- Dashboard review: score trend, subject accuracy, negatives, time-by-subject, repeated failures → Amber queue defines next week's fix list

**North-star stays on the header:** cumulative questions correctly solved under time.

---

## 7. Acceptance checklist — "fully usable for a JEE aspirant"

- [ ] A PDF paper → timed CBT in < 60 s of setup (today: ✅)
- [ ] Official NTA key pastes score correctly (Sprint A)
- [ ] Page-follow never traps you on the wrong page (Sprint A)
- [ ] One 75-Q PYQ PDF runs as a single 180-min test with P/C/M sections (Sprint B)
- [ ] A keyless book exercise still produces tagged analytics (Sprint C)
- [ ] Data survives browser restarts and is exportable in one click (✅ + Sprint A nudge)
- [ ] Daily loop (§6) runs without touching anything outside the app

## 8. Still not building (unchanged from spec v2)
SRS/Anki integration, PYQ browser, two-way calendar, backend/auth/accounts, paid AI,
social, video hosting, mobile app, cloud deploy, Advanced-style optional questions.
Phase-2 triggers (only if real usage demands): NTA regex paper-parser, mixed-test builder,
AnkiConnect button, formula-sheet print view.
