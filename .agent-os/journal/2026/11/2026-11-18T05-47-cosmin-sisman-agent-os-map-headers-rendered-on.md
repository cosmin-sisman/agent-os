---
type: decision
refs: ["#26", "#27"]
areas: [knowledge]
author: cosmin-sisman
---

# agent-os map: headers rendered on demand, never committed

`agent-os map [path] [--budget]` and the doctor `headers` check, following the research in docs/research/file-index.md.

Decisions:
- The map is the per-file header plus size, covering test and recent changes, for one folder, trimmed to a token budget. Recently changed files come first because that is where the work is. What does not fit is counted, not silently dropped.
- The cache is per file (size and mtime), not per commit, so uncommitted edits show up and the repository needn't be a git checkout. A cached map of one folder in a 10k-file tree takes well under a second (tested), which meets the acceptance criterion.
- Headers are recognised for //, #, --, /* */, <!-- --> and Python docstrings. doctor warns only on code files added on the branch that lack one (the issue's scenario), so history is never asked to change.
- Ranked symbol maps stay out of scope until evals show they help.
