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
