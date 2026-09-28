#!/usr/bin/env python3
"""NOVA sweep: brand-emerald action buttons → token-driven primary (violet).
Semantic greens (correct answers, NTA palette, success states, badges) are
intentionally LEFT ALONE — green keeps meaning 'correct', violet means
'action/brand'. Curated exact-string replacements only; no regex surprises."""

import pathlib

ROOT = pathlib.Path("/home/z/my-project/src/components/jee")

# (old, new) — applied in order; most specific first
REPLACEMENTS = [
    # full brand-button recipes → primary (button.tsx adds the glow)
    (
        "bg-emerald-700 hover:bg-emerald-800 dark:bg-emerald-500 dark:hover:bg-emerald-600 dark:text-emerald-950",
        "bg-primary hover:bg-primary/90",
    ),
    # light-only recipe leftovers
    (
        "bg-emerald-700 hover:bg-emerald-800",
        "bg-primary hover:bg-primary/90",
    ),
    # selected/active states (subject tab, selected option tiles) → primary
    (
        "bg-emerald-700 dark:bg-emerald-500 text-white dark:text-emerald-950 font-medium",
        "bg-primary text-primary-foreground font-medium",
    ),
    (
        "bg-emerald-700 dark:bg-emerald-500 text-white dark:text-emerald-950 border-emerald-700 dark:border-emerald-500 font-medium",
        "bg-primary text-primary-foreground border-primary font-medium",
    ),
    (
        "bg-emerald-700 dark:bg-emerald-500 text-white dark:text-emerald-950 border-emerald-700 dark:border-emerald-500",
        "bg-primary text-primary-foreground border-primary",
    ),
    (
        "bg-emerald-700 dark:bg-emerald-500 text-white dark:text-emerald-950",
        "bg-primary text-primary-foreground",
    ),
    # brand links → primary text
    (
        "underline text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:text-emerald-300",
        "underline text-primary hover:text-primary/80",
    ),
    (
        "text-emerald-700 dark:text-emerald-400 font-medium underline underline-offset-2 hover:text-emerald-800 dark:text-emerald-300",
        "text-primary font-medium underline underline-offset-2 hover:text-primary/80",
    ),
]

# files where emerald = NTA palette / answer semantics must survive untouched
SKIP_FILES = set()  # handled via context guards below instead

def main():
    changed = {}
    for f in sorted(ROOT.glob("*.tsx")):
        text = f.read_text()
        orig = text
        for old, new in REPLACEMENTS:
            if old in text:
                text = text.replace(old, new)
        if text != orig:
            f.write_text(text)
            changed[f.name] = sum(
                1 for old, _ in REPLACEMENTS if old in orig
            )
    for name, n in changed.items():
        print(f"{name}: patterns replaced")
    print("done")

if __name__ == "__main__":
    main()
