# DESIGN.md — "Quiet Cockpit" design language

Research-driven design upgrade (Sep 2026). Sources → concrete decisions, so future
work stays inside one system instead of drifting back to template-land.

## Sources researched

| Source | What it gave |
| --- | --- |
| ui-skills.com `taste-skill-v1` (Leonxlnx) | "Lila Ban" (no purple-AI gradients, ≤1 accent ≤80% sat), cockpit density rules, mono-for-numbers, hairlines-not-boxes, tactile `:active`, motion curve `cubic-bezier(0.16,1,0.3,1)` |
| vercel.com/geist | Role-indexed 10-step color scales, Label-12-CAPS tertiary text, **tabular numerals for numbers**, two-backgrounds-only rule |
| linear.app design refresh posts | "Don't compete for attention you haven't earned" (chrome recedes), "Structure should be felt not seen" (hairlines, fewer separators), warm neutrals ("cool reads muddy") |
| Strava engineering (heatmap) | Continuous paths over dots; normalize relative to local context — accuracy trends read relative to the chapter's own history |
| Apple HIG | Hierarchy via weight+color (not size); no light/black weights; alignment = scannability |
| NTA CBT interface (Careers360 + shipped CBT clones) | Palette semantics: green=answered, red=not answered, purple=marked, grey=unvisited; timer color stages; "attempted X of Y" submit honesty |
| Testbook test-analysis screens | Metric names & hierarchy: hero score → stat cards → subject → chapter drill-down; "Strengths & Weaknesses" framing |
| NN/g (drag-drop, empty states, progress) | Dropzone ALWAYS paired with browse; per-file progress; empty state = status + teach + ONE primary CTA; zero-data vs no-results distinction |
| shadcn.com (chart + data-table + Empty conventions) | Charts as thin wrappers over recharts; data table composed per-screen; hover-revealed row actions |
| Kombai gallery | One style family app-wide; screen-type-first browsing (stepper, toolbar, dashboard) |
| Emerald UI (emerald-ui.com, open source) | shadcn-registry component inspiration (dropzone, tooltips) |
| Mobbin / SaaSFrame / Page Flows | Pattern vocabulary (not directly browsable without login) — used via secondary write-ups |

## Decisions (the rulebook)

1. **One accent.** Emerald-700 (`oklch(0.508 0.118 165.6)`) is the only saturated
   brand color. Red/amber/violet are *functional* (wrong/pending/marked), never
   decorative. No purple gradients, no neon.
2. **Warm neutrals.** Stone-based tokens with a warm hue (~80 in OKLCH). Cool grays
   and pure black are banned (taste-skill + Linear).
3. **Numbers are data.** Every metric, timer digit, palette number, storage size:
   `font-mono tabular-nums`. Geist Sans for UI, Geist Mono for numerals.
4. **Hairlines, not boxes.** Cards separated by 1px `border-border` + a whisper
   shadow `0 1px 2px rgba(28,25,23,0.04)`. Dense lists use `divide-y`. Shadows for
   real elevation only (tooltips, dialogs).
5. **Chrome recedes.** Nav inactive = muted text, 1.5px icon strokes, hairline
   separators between groups; the content area earns the contrast (Linear).
6. **Type ramp.** 11px CAPS tracking-wide labels → 13px secondary → 14-15px body →
   `text-lg tracking-tight` page titles. Hierarchy from weight + color, never size.
7. **Charts speak one language.** Shared `CH / TIP / GRID / TICK / TICK_MONO` from
   `shared.tsx`; continuous lines (`dot={false}` + hover dot); dashed reference
   lines at 70/40; mono axis numerals.
8. **States are designed.** NN/g empty states (icon + one-liner + ONE primary CTA);
   zero-data vs no-results are distinct; skeletons over spinners for async loads.
9. **Tactile.** `press` utility = 150ms `cubic-bezier(0.16,1,0.3,1)` + `:active`
   scale 0.98 on primary actions. Transform/opacity only.
10. **CBT honesty.** NTA palette semantics; timer amber ≤10min / red ≤2min (already
    shipped); submit dialog states attempted counts; single confetti burst in the
    brand palette on completion (reward, not decoration).
11. **Review semantics.** Left status stripes on review rows (green/red/amber/grey);
    "You" value tinted by outcome; correct value always emerald.
12. **Library rows.** Compact rows, hover-revealed icon actions (always visible on
    touch), search toolbar with honest counters, no fake storage bars.

## Where the tokens live

- `src/app/globals.css` — palette, radius, scrollbars, selection, `press`
- `src/components/jee/shared.tsx` — StatCard / SectionCard / EmptyState / chart consts
- `src/components/jee/App.tsx` — shell (header, grouped icon nav, footer)
- `src/components/jee/motion.tsx` — the motion layer (v2)
- `src/app/theme-provider.tsx` — next-themes wiring (v2)

## v2 additions (the "modern elegant" pass)

13. **Dark mode is first-class.** next-themes, class strategy, Light/Dark/System
    menu in the header with a pure-CSS sun/moon crossfade (zero hydration risk).
    Dark = warm stone (never pure black), same hues as light with lightness
    lifted. `color-scheme` set per theme; scrollbars/selection/theme-switch
    fade all themed. Every component consumes tokens — no hardcoded hex.
14. **Charts are theme-aware by construction.** `CH` colors are CSS vars
    (`--sem-*`) defined per theme in globals.css; grid/tick/tooltips likewise.
    A chart written once renders correctly in both themes.
15. **Motion rules.** framer-motion, `MotionConfig reducedMotion="user"` at the
    root. Page transitions = AnimatePresence fade+rise (0.22s, EASE). Player
    questions slide in on change (0.18s). Stagger cascades for stat grids
    (45ms). Count-up springs on key numerals. Hover lift −2px on stat cards.
    Nav uses a layoutId sliding pill. Transform/opacity only.
16. **Every chart says what it denotes.** `ChartNote` under each chart: one
    plain-English line explaining axes/gates/meaning ("dashed line is the 70%
    green gate", "grey = score if guesses were skipped").
17. **Modern chart shapes.** Score timelines are gradient area charts (line +
    22%→2% fill); bars rounded 3-4px; glass tooltips (`ChartTip`) with mono
    numerals; sparklines in StatCards (`Spark`); continuous lines, hover dots.
18. **CBT honesty kept in dark.** NTA palette chips get dark equivalents
    (answered=emerald-500/950, marked=purple tint, unvisited=transparent with
    border); the timer bar drains with remaining time and recolors at stages.

## v3 — the "NOVA" pass (futuristic premium, user-directed)

User verdict on v2: clean but generic — "looks like every common web app". NOVA is the
answer: keep the semantic discipline (green = correct, amber = pending, NTA palette
semantics) and trade *quiet warmth* for *cinematic depth*. Sources of record: Linear's
dark app, Vercel Geist, Raycast, Arc — the "premium dark instrument" family.

19. **Deep space, not warm stone.** Backgrounds are near-black with a violet cast
    (`oklch(0.132 0.018 288)`). Cards are translucent glass (`--card` at ~72% alpha +
    `backdrop-blur`) floating on an **aurora light field**: three drifting blurred
    blobs (violet/cyan/magenta, 9–20% alpha) + a blueprint dot grid with radial fade
    (`AuroraBackground` in App.tsx). Dark is the default theme; light is "frost"
    (lavender-white, same energy at daylight strength).
20. **Brand = violet → cyan energy.** Primary is electric violet
    (dark `oklch(0.64 0.24 292)`); the signature gradient runs violet → cyan
    (logo tile, nav pill glow, page-title tick, score numerals `.text-gradient`,
    timer filament). Green stays **strictly semantic** (correct/success/T1) — the
    brand never borrows it.
21. **Light emission, not just color.** Interactive chrome glows: primary buttons
    carry `shadow-[0_0_0_1px_var(--glow-primary),0_4px_20px_-6px]` (button.tsx), the
    active nav pill glows, ScoreRing renders a blurred halo + `drop-shadow` on the
    stroke, chart curves get `filter: drop-shadow(...)` via `.chart-glow` with a
    per-chart `--glow-c`. One hero card per view gets the animated conic border
    `.border-nova` (Dashboard "Today", Results score hero).
22. **Spotlight surfaces.** Cards track the cursor: `Spotlight` (motion.tsx) writes
    `--mx/--my` on mousemove and a radial gradient sheen follows the pointer
    (`.spotlight::after`, Vercel signature). Applied to every StatCard; zero
    re-renders (pure CSS vars).
23. **Cinematic motion, still transform/opacity/filter-only.** Page transitions
    blur + rise (old view blurs away, new materialises, 260ms); `PageIn` and
    Stagger items enter with a 4–8px blur that resolves to sharp; nav pill keeps
    its spring glide. Shimmer: the timer filament scans (`Shimmer`/`.shimmer`).
    All ambient animation (aurora drift, shimmer, conic shift) is killed under
    `prefers-reduced-motion`.
24. **Display voice.** Space Grotesk (`--font-display`, next/font) owns headlines,
    the logo, section titles; Geist Sans stays body; Geist Mono stays numbers.
    PageTitle carries a violet→cyan tick bar. Numerals grow (StatCard 26px) —
    the data is the hero.
25. **Proportional timer drama.** Timer stages scale with paper length
    (red ≤ min(120s, 15%), amber ≤ max(red+60s, min(600s, 40%))) so a 5-min drill
    doesn't start screaming amber. Normal stage shows the violet→cyan filament.
26. **Confetti = brand sparks.** Submit celebration uses violet/cyan/magenta/white.
    Density rules from v2 (caps micro-labels, mono numerals, honest chart notes)
    all survive — NOVA changes the *material* (glass, light, depth), not the
    *grammar*.
