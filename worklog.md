# Worklog

---
Task ID: 1
Agent: main (Super Z)
Task: Build the JEE Study App MVP (spec v2) as an interactive web app — full 7-day scope in one pass: IndexedDB data layer, question bank, syllabus seed with tiers, CBT test player, PDF page-mode import, error tags, external test log, analytics dashboard, syllabus tracker, Today card.

Work Log:
- Initialized fullstack env (Next.js 16 + TS + Tailwind 4 + shadcn/ui), installed pdfjs-dist@4.10.38, copied pdf.worker.min.mjs to public/
- src/lib/types.ts — full data model (Question, TestRecord, ResponseRecord, SyllabusRow, FormulaEntry, DailyLog, ActiveSession), error tags C/F/A/R/T/G, revision intervals [0,1,3,7]
- src/lib/idb.ts — promise-wrapped IndexedDB (7 stores), change-notification pub/sub, useLive/useDataVersion hooks, session persistence (resume across refresh)
- src/lib/syllabus-seed.ts — 65 JEE Main 2026 chapters with Tier 1/2/3 badges; deleted chapters (Mathematical Reasoning, Communication Systems, Solid State + other 2024 removals) excluded entirely
- src/lib/analytics.ts — north-star (correct-under-time), chapter health Green(≥70)/Amber(40-70)/Red(<40), Amber-first queue sorted by recency, repeated-failure chapters (≥2 tests), score timeline, subject accuracy, error tag distribution, marks-lost-to-negatives, time-by-subject, revision-due
- src/lib/demo-questions.ts — 12 real demo questions for instant onboarding
- Components (src/components/jee/): App shell (nav + north-star header + resume banner), Dashboard (Today card 4-block checkboxes + editable chapters line, all 5 spec metrics as recharts charts, Amber queue, revision-due strip, recent tests), QuestionBank (MCQ + numerical entry with tolerance, filters by subject/chapter/tier/search), TestCreate (chapter chips auto-select with MCQ/NUM interleaving, manual pick mode, configurable duration with 1min/Q and 180min suggestions), Player (NTA palette: green/purple/white/yellow, P/C/M sections, countdown with auto-submit, Save&Next / Mark&Next / Clear, per-question timing, PDF page rendering with page-following), Results (score/accuracy/attempt-rate/negatives/summary + per-question review + tag buttons, F-tag auto-appends formula sheet), PdfImport (upload → page range → answer-key parser (letters + numeric, coverage warnings) → start), ExternalLog (10-field Abhyas/SATHEE form + table), Syllabus (tier badges, status flow Not Started→…→Maintenance, auto-color chips, 1-3-7 revision loop: Learning/PYQs-Done arms "due tonight", Mark revised advances +1d→+3d→+7d, notes), FormulaSheet (grouped by chapter), DataView (JSON export/import, demo seed, wipe)
- page.tsx uses useSyncExternalStore SSR guard; layout metadata updated; eslint ignores for public/ minified worker
- Browser verification (agent-browser): demo seed → CBT create (10 Qs across 9 chapters) → answered/clear/mark flows → submit → scoring verified (+4/−1/0, numericals included) → tagged C/F/G/T → formula sheet auto-collect ✓ → external log (north-star 6→63) ✓ → PDF test with generated demo-paper.pdf: parse 4 keys, page renders in player, resume banner after refresh, auto-score 7/16 exact ✓ → F-tag from PDF in formula sheet ✓ → export ✓ → mobile 390px ✓ → console clean, lint clean
- Fixed during verification: PDF-mode answer panel missing (added letter/numeric controls driven by key type), sessionRef scope bug, session not persisted at start, formula-sheet spacing, status→revision-loop arming

Stage Summary:
- Deliverable: runnable Next.js app on port 3000 (single / route), 100% local-first (IndexedDB, no backend/auth), spec v2 fully implemented incl. all 8 filter-table corrections
- Demo assets: /download/demo-paper.pdf (try PDF Test flow), demo questions via Data tab
- Key decisions: recharts instead of Chart.js (stack built-in), pdf.js worker served locally, responses denormalize subject/chapter for join-free analytics, external "correct under time" = attempts − wrong

---
Task ID: 2
Agent: main (Super Z)
Task: Explain how CBT/PDF test creation works without AI; research web; produce full-usability plan (PLAN.md) closing MVP -> daily-driver gap.

Work Log:
- Read worklog Task 1 + audited built code: PdfImport.tsx (upload -> page range + total Qs + duration -> answer-key regex parser with coverage warnings -> session), Player.tsx (pageForQuestion linear estimate, fixed scale 1.6, no manual page nav, +4/-1/0 scoring, PDF numericals exact-match 1e-9, beforeunload guard)
- Ran 6 web searches (saved to scripts/research/*.json): exam pattern 2026/27 stable (75Q, 20+5, +4/-1 numerical too), deleted chapters confirmed (Mathematical Reasoning/Inductions, Communication Systems, Solid State), NTA Abhyas + SATHEE validated as free mock sources, topper method (error notebook, high-weightage first) matches app design
- Wrote PLAN.md: Page-Mode explanation + 4-approach comparison, research table, v1 audit, 8-item gap analysis (G1 NTA (1)-(4) key mapping, G2 manual page flip/zoom/pin, G3 PDF tolerance, G4 storage persist/export nudge, G5 full-paper 3-section mode, G6 key-later self-mark, G7 image paste, G8 onboarding), 3-sprint roadmap (A correctness+ergonomics, B full-paper, C key-later) then freeze, operating loop, acceptance checklist

Stage Summary:
- Key insight: PDF is never cut/parsed — user maps pages + total Qs, app generates palette, only the answer key is regex-parsed (trivially reliable)
- Real gaps found in built code: no manual PDF page navigation, no option-number key mapping, no PDF numerical tolerance, no full-paper mode, no key-later mode
- PLAN.md at project root; Sprints A/B/C each sized for one 45-60 min session; awaiting user go for Sprint A

---
Task ID: 3
Agent: main (Super Z) + Explore subagent (audit)
Task: Explain answer-checking without AI (simple + technical); full-feature plan for ALL modules backed by whole-codebase audit + web research.

Work Log:
- Dispatched Explore agent: read all 11 jee components + lib (types/idb/analytics/syllabus-seed/demo/db) + app files; returned per-module feature/gap/hardcode/quick-win audit + data-layer + cross-cutting findings
- Ran 5 web searches: competitor features (Melvano/JeeHub: weak-area tracking, countdown), learning science (retrieval practice validates retry-wrong + 1-3-7 loop), JEE Main 2027 timeline (Session 1 Jan 2027, ~15 weeks out), tracker metrics (low-quality, discarded), topper methods (thin, prior research reused)
- Key audit findings: QuestionBank has NO edit + unsafe delete (dangling question_ids corrupt tests); Player has ZERO keyboard support + no Previous button; NTA (1)-(4) keys mis-parse; no image field on questions; no KaTeX; scoring constants duplicated 4x; export loses pdf-blob; import unvalidated; no PWA; dead Prisma/db.ts + ~40 unused components
- Rewrote PLAN.md as Master Plan v3: answer-checking explanation (red-pen analogy + technical path + key-PDF upload feasibility), research inputs, 6 sprints (A PDF correctness, B player+full-paper, C safety/data, D learning loop, E dashboard/tracker, F polish) each sized for one 45-60 min session, master verdict table per module, exclusions, acceptance checklist v3

Stage Summary:
- PLAN.md = authoritative full-app roadmap; 6 sprints then freeze (~15 weeks to JEE Main 2027 S1)
- New features added beyond v2 plan: retry-wrong-as-new-test, exam countdown, streak, key-PDF upload (digital only), image paste, question edit, deep links, PWA
- Awaiting user go for Sprint A
