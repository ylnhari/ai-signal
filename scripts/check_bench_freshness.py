#!/usr/bin/env python3
"""Staleness gate for AI Signal's bench pages.

This repo's own AGENTS.md ("## Living artifacts") documents a refresh cadence
("Re-check weekly; refresh on drift.") and names the bench pages that cadence
applies to. This script reads BOTH the cadence and the page list from
AGENTS.md itself -- neither is hard-coded here -- then checks each named
page's own <meta name="refreshed" content="YYYY-MM-DD"> marker against that
cadence.

Exit 0: every named bench page is within cadence.
Exit 1: at least one page is overdue, or a page's marker is missing/unreadable.
  The message names each offending page and, when overdue, by how many days.

Usage:
    python scripts/check_bench_freshness.py
"""
from __future__ import annotations

import re
import sys
from datetime import date
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
AGENTS_MD = REPO_ROOT / "AGENTS.md"

# Cadence words this script understands, in days. AGENTS.md supplies which
# word applies; this dict is just the vocabulary, not the chosen cadence.
CADENCE_DAYS = {
    "daily": 1,
    "weekly": 7,
    "fortnightly": 14,
    "biweekly": 14,
    "monthly": 30,
}

MARKER_RE = re.compile(r'<meta\s+name="refreshed"\s+content="(\d{4}-\d{2}-\d{2})"\s*/?>')


def read_cadence_days(agents_md_text: str) -> int:
    m = re.search(r"Re-check\s+(\w+)\s*;", agents_md_text, re.IGNORECASE)
    if not m:
        sys.exit(
            "check_bench_freshness: could not find a 'Re-check <cadence>;' line "
            "in AGENTS.md's Living artifacts section -- cannot determine cadence."
        )
    word = m.group(1).lower()
    if word not in CADENCE_DAYS:
        sys.exit(
            f"check_bench_freshness: AGENTS.md names cadence '{word}', which this "
            f"script doesn't recognize. Known words: {', '.join(sorted(CADENCE_DAYS))}."
        )
    return CADENCE_DAYS[word]


def read_bench_pages(agents_md_text: str) -> list[str]:
    """Collect every `bench*.html` filename named in the Living artifacts
    section's table -- the pages AGENTS.md itself says need weekly
    re-checking. index.html is deliberately excluded: AGENTS.md lists only
    its *sidebar* as a living artifact, and the page as a whole is already
    refreshed by the daily publish, a separate concern from this gate."""
    section_match = re.search(r"##\s*Living artifacts(.*)", agents_md_text, re.IGNORECASE | re.DOTALL)
    section = section_match.group(1) if section_match else agents_md_text
    names = re.findall(r"`([\w.-]+\.html)`", section)
    pages: list[str] = []
    for name in names:
        if name.startswith("bench") and name not in pages:
            pages.append(name)
    if not pages:
        sys.exit(
            "check_bench_freshness: found no `bench*.html` pages named in "
            "AGENTS.md's Living artifacts table."
        )
    return pages


def main() -> int:
    if not AGENTS_MD.exists():
        sys.exit("check_bench_freshness: AGENTS.md not found at repo root.")
    text = AGENTS_MD.read_text(encoding="utf-8")

    cadence_days = read_cadence_days(text)
    pages = read_bench_pages(text)
    today = date.today()

    problems: list[str] = []
    overdue: list[tuple[str, date, int, int]] = []

    for name in pages:
        path = REPO_ROOT / name
        if not path.exists():
            problems.append(f"{name}: file does not exist")
            continue
        html = path.read_text(encoding="utf-8")
        m = MARKER_RE.search(html)
        if not m:
            problems.append(
                f'{name}: no <meta name="refreshed" content="YYYY-MM-DD"> marker found'
            )
            continue
        refreshed = date.fromisoformat(m.group(1))
        age_days = (today - refreshed).days
        if age_days > cadence_days:
            overdue.append((name, refreshed, age_days, age_days - cadence_days))

    print(f"Cadence (from AGENTS.md): every {cadence_days} day(s).")
    print(f"Checked {len(pages)} bench page(s): {', '.join(pages)}")

    if problems:
        print("\nProblems (cannot determine freshness):")
        for p in problems:
            print(f"  - {p}")

    if overdue:
        print("\nOverdue:")
        for name, refreshed, age_days, over_by in overdue:
            print(
                f"  - {name}: last refreshed {refreshed.isoformat()} "
                f"({age_days} days ago) -- overdue by {over_by} day(s)"
            )

    if problems or overdue:
        return 1

    print("\nAll bench pages are within cadence.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
