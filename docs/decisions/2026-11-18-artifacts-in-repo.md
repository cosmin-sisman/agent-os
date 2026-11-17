# Artifacts live in the repository

Status: accepted

## Context
Analyses, discovery reports and maps are clearer as visual pages, but pages kept in a personal workspace cannot be opened by teammates, have no history and cannot be checked against the data they show.

## Decision
- Artifacts are folders under `artifacts/<date>-<slug>/` with `artifact.yaml` (id, title, type, kind, status, summary, refs, sources with hashes, authors) and a self-contained `index.html`.
- A CI workflow builds a GitHub Pages site with every artifact and a generated index. The index is never committed.
- `agent-os artifact verify` marks artifacts stale when their sources change; `doctor` checks metadata, links, size and that pages load nothing external.
- `/artifact` creates, builds, verifies, links (comment on issues and PRs) and optionally mirrors artifacts to an external host, which never becomes the source of truth.

## Consequences
Everyone with access to the project sees the same page, history comes from git, and stale analyses are flagged instead of silently misleading.
