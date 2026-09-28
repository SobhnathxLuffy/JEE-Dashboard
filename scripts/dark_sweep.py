#!/usr/bin/env python3
"""Bulk theme-token mapping for the JEE app screens (dark-mode sweep).

Mechanical 1:1 class replacements on lines that are still light-only.
Skips lines that already contain `dark:`, contain content images
(object-contain/cover), or contain palette swatches (border-2).
"""
import re
from pathlib import Path

BASE = Path("/home/z/my-project/src/components/jee")
FILES = [
    "Papers.tsx",
    "PdfImport.tsx",
    "TestCreate.tsx",
    "QuestionBank.tsx",
    "Syllabus.tsx",
    "FormulaSheet.tsx",
    "ExternalLog.tsx",
    "DataView.tsx",
]

# ordered longest-first to avoid partial clobbers
MAPPING = [
    ("bg-stone-900 text-white", "bg-foreground text-background"),
    ("hover:bg-stone-50/60", "hover:bg-accent/40"),
    ("hover:bg-stone-200", "hover:bg-accent"),
    ("hover:bg-stone-100", "hover:bg-accent"),
    ("hover:bg-stone-50", "hover:bg-accent/50"),
    ("bg-stone-50/60", "bg-muted/40"),
    ("bg-stone-50/50", "bg-muted/40"),
    ("bg-stone-100", "bg-muted"),
    ("bg-stone-50", "bg-muted"),
    ("bg-white", "bg-card"),
    ("hover:bg-purple-50", "hover:bg-purple-50 dark:hover:bg-purple-500/10"),
    ("hover:bg-red-50", "hover:bg-red-50 dark:hover:bg-red-500/10"),
    ("hover:bg-emerald-50", "hover:bg-emerald-50 dark:hover:bg-emerald-500/10"),
    ("hover:bg-amber-100", "hover:bg-amber-100 dark:hover:bg-amber-500/10"),
    ("hover:bg-amber-50", "hover:bg-amber-50 dark:hover:bg-amber-500/10"),
    ("hover:border-emerald-500", "hover:border-emerald-500 dark:hover:border-emerald-400"),
    ("hover:border-emerald-400", "hover:border-emerald-400 dark:hover:border-emerald-500"),
    ("hover:text-emerald-700", "hover:text-emerald-700 dark:hover:text-emerald-400"),
    ("hover:text-stone-700", "hover:text-foreground"),
    ("bg-amber-50", "bg-amber-50 dark:bg-amber-500/10"),
    ("bg-emerald-50", "bg-emerald-50 dark:bg-emerald-500/10"),
    ("bg-red-50", "bg-red-50 dark:bg-red-500/10"),
    ("bg-amber-100", "bg-amber-100 dark:bg-amber-500/10"),
    ("bg-red-100", "bg-red-100 dark:bg-red-500/10"),
    ("bg-orange-100", "bg-orange-100 dark:bg-orange-500/10"),
    ("bg-sky-100", "bg-sky-100 dark:bg-sky-500/10"),
    ("bg-violet-100", "bg-violet-100 dark:bg-violet-500/10"),
    ("bg-emerald-700 hover:bg-emerald-800", "bg-emerald-700 hover:bg-emerald-800 dark:bg-emerald-500 dark:hover:bg-emerald-600 dark:text-emerald-950"),
    ("border-amber-400", "border-amber-400 dark:border-amber-500/50"),
    ("border-amber-300", "border-amber-300 dark:border-amber-500/40"),
    ("border-amber-200", "border-amber-200 dark:border-amber-500/25"),
    ("border-amber-100", "border-amber-100 dark:border-amber-500/20"),
    ("border-emerald-300", "border-emerald-300 dark:border-emerald-500/40"),
    ("border-emerald-200", "border-emerald-200 dark:border-emerald-500/30"),
    ("border-emerald-100", "border-emerald-100 dark:border-emerald-500/20"),
    ("border-red-300", "border-red-300 dark:border-red-500/40"),
    ("border-red-200", "border-red-200 dark:border-red-500/30"),
    ("border-red-100", "border-red-100 dark:border-red-500/20"),
    ("border-sky-200", "border-sky-200 dark:border-sky-500/30"),
    ("border-violet-200", "border-violet-200 dark:border-violet-500/30"),
    ("border-orange-200", "border-orange-200 dark:border-orange-500/30"),
    ("border-purple-300", "border-purple-300 dark:border-purple-500/40"),
    ("text-amber-800", "text-amber-800 dark:text-amber-300"),
    ("text-amber-700", "text-amber-700 dark:text-amber-300"),
    ("text-emerald-800", "text-emerald-800 dark:text-emerald-300"),
    ("text-emerald-700", "text-emerald-700 dark:text-emerald-400"),
    ("text-red-700", "text-red-700 dark:text-red-300"),
    ("text-red-500", "text-red-500 dark:text-red-400"),
    ("text-sky-700", "text-sky-700 dark:text-sky-300"),
    ("text-violet-700", "text-violet-700 dark:text-violet-300"),
    ("text-orange-700", "text-orange-700 dark:text-orange-300"),
    ("text-stone-900", "text-foreground"),
    ("text-stone-800", "text-foreground"),
    ("text-stone-700", "text-foreground/80"),
    ("text-stone-600", "text-muted-foreground"),
    ("text-stone-500", "text-muted-foreground"),
    ("text-stone-400", "text-muted-foreground/70"),
    ("text-stone-300", "text-muted-foreground/50"),
    ("border-stone-300", "border-border"),
    ("border-stone-200", "border-border"),
    ("border-stone-100", "border-border/60"),
    ("ring-stone-300", "ring-border"),
    ("divide-stone-100", "divide-border/60"),
]

SKIP_PAT = re.compile(r"dark:|object-contain|object-cover|border-2")

total = 0
for name in FILES:
    p = BASE / name
    text = p.read_text()
    lines = text.split("\n")
    changed = 0
    for i, line in enumerate(lines):
        if SKIP_PAT.search(line):
            continue
        orig = line
        for old, new in MAPPING:
            if old in line:
                line = line.replace(old, new)
        if line != orig:
            lines[i] = line
            changed += 1
    p.write_text("\n".join(lines))
    total += changed
    print(f"{name}: {changed} lines updated")
print(f"TOTAL: {total} lines")
