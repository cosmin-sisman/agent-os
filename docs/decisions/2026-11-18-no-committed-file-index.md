# No committed file index

Status: accepted · Research: [file index](../research/file-index.md)

## Context
A committed, generated index of every file (summary, size, test) grew to hundreds of kilobytes in the reference workflow, conflicted between parallel PRs, and needed regeneration after every merge. Studies show repository overviews do not reduce agent steps and raise cost; agents find files with search.

## Decision
- No committed file index.
- Every file keeps a 1–3 line header; `doctor` asks for it on new files only.
- `agent-os map [path] [--budget N]` renders an area map on demand (headers, sizes, covering tests, recent changes), cached per commit in `.agent-os/cache/`.
- `AGENTS.md` holds a hand-written area map, one line per top-level area; `doctor` checks coverage.
- Skill evals measure whether `map` reduces steps; it stays only if it does.

## Consequences
No merge conflicts or regeneration steps; context cost is paid only when a map is asked for. Very large repositories may later get a ranked symbol map.
