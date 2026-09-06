#!/usr/bin/env python3
"""Internal link/asset check for the ai-signal static site.

Walks every .html file in the repo and verifies every internal href/src
resolves to a file that actually exists -- checked case-sensitively, since
GitHub Pages serves from Linux even though this may be run on a
case-insensitive filesystem. External links (http/https, mailto, tel,
javascript, data URIs) and same-page fragments are skipped; this script does
not check external URLs.

Exit 0: every internal href/src resolves.
Exit 1: at least one does not -- the message names the page and the target.

Usage:
    python scripts/check_links.py
"""
from __future__ import annotations

import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

REPO_ROOT = Path(__file__).resolve().parent.parent
SKIP_DIR_NAMES = {".git"}
LINK_ATTRS = {"href", "src"}
EXTERNAL_SCHEMES = {"http", "https", "mailto", "tel", "javascript", "data"}


class RefCollector(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.refs: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        for name, value in attrs:
            if name in LINK_ATTRS and value:
                self.refs.append(value)


def is_external_or_fragment(value: str) -> bool:
    if value.startswith("#"):
        return True
    if value.startswith("//"):
        return True
    scheme = urlsplit(value).scheme
    return scheme.lower() in EXTERNAL_SCHEMES


def resolve_case_sensitive(start_dir: Path, target: str) -> bool:
    """True if `target` (relative to start_dir, or repo-root-relative if it
    starts with '/') resolves to an existing file, matching case exactly."""
    if target.startswith("/"):
        current = REPO_ROOT
        target = target[1:]
    else:
        current = start_dir

    parts = [p for p in target.split("/") if p not in ("",)]
    if not parts:
        parts = ["."]

    for part in parts:
        if part == ".":
            continue
        if part == "..":
            current = current.parent
            continue
        try:
            entries = {entry.name: entry for entry in current.iterdir()}
        except (FileNotFoundError, NotADirectoryError):
            return False
        if part not in entries:
            return False
        current = entries[part]

    if current.is_dir():
        current = current / "index.html"
    return current.is_file()


def main() -> int:
    html_files = sorted(
        p
        for p in REPO_ROOT.rglob("*.html")
        if not any(part in SKIP_DIR_NAMES for part in p.parts)
    )

    broken: list[tuple[str, str]] = []
    for page in html_files:
        html = page.read_text(encoding="utf-8", errors="replace")
        parser = RefCollector()
        parser.feed(html)
        for raw in parser.refs:
            if is_external_or_fragment(raw):
                continue
            target = raw.split("#", 1)[0].split("?", 1)[0]
            if not target:
                continue
            if not resolve_case_sensitive(page.parent, target):
                broken.append((page.relative_to(REPO_ROOT).as_posix(), raw))

    print(f"Checked {len(html_files)} HTML file(s) under {REPO_ROOT}.")

    if broken:
        print("\nBroken internal links/assets:")
        for page, target in broken:
            print(f"  - {page}: {target}")
        return 1

    print("All internal hrefs and asset paths resolve.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
