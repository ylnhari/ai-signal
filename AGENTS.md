# AI Signal project instructions

This repository contains only the public static site. The editorial pipeline, research inputs, credentials, and source datasets remain private and must not be added here.

- Preserve existing editions and source links unless the task explicitly changes them.
- Treat content updates as publication changes: verify dates, internal navigation, source attribution, and external links before committing.
- Do not invent or alter editorial claims without an approved source record.
- Never add private pipeline files, personal data, tokens, `.env` files, or unpublished drafts.
- Do not commit, push, deploy, or publish unless explicitly requested.

## Living artifacts

**Re-check weekly; refresh on drift.**

Daily editions under `days/` are dated snapshots — never rewrite them. These
pages instead claim to describe *the present*, so they need re-checking:

| Artifact | What goes stale | Upstream source |
|---|---|---|
| `bench.html`, `bench-results.html`, `bench-runs.html` | The results grid: which models have been benchmarked, their scores, the run dates. A model released since the last run makes the grid look complete when it isn't. | The bench ledger and captured result columns; add a column only by running the battery, never by transcribing someone else's numbers. |
| `index.html` sidebar, `bench-notes.html` | Links and names of external artifacts (titles drift when the target is renamed), plus edition counts and "Latest" / "Since" dates. | The linked pages themselves. |

Refresh rules:
- **Every count these pages state must be derivable from the underlying run
  data**, and they are machine-checked against it before publishing. The same
  facts are restated across several of these pages ("nine models", "seven of the
  nine", "124 hidden cases", "All 25 tasks"), so editing one number by hand
  almost certainly creates a contradiction with another page — one that still
  renders perfectly and is therefore invisible. Change the data and re-run the
  check; do not retype a count.
- Reuse before running: check the existing captured columns first and only run
  the models that are missing or stale, then APPEND a column — never rewrite an
  existing one, and never mix scores captured under different battery versions
  into the same comparison.
- If `index.html` is produced by an external generator rather than hand-edited,
  fix the generator too; otherwise the next publish silently reverts the edit.
- Verify every external link still resolves and still carries the name used here.
