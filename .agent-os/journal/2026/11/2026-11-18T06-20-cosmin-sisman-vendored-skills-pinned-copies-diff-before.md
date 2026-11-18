---
type: note
refs: ["#39"]
areas: [registry]
author: cosmin-sisman
---

# Vendored skills: pinned copies, diff before update, lock-scoped remove

Third-party skills are vendored, not installed: `skill add` copies the files at a pinned commit as plain data (nothing executable, symlinks and paths outside the folder refused, nothing run), registers them as external, and records the commit, ref, folder and a hash per file under `vendored` in the lock. `update` shows the diff between commits and writes only on confirmation or `--yes`, and refuses vendored files edited in place. `remove` deletes only the folder the lock records, plus the entry, the lock record and any slot bound to it. Fetchers are keyed by source host, so a GitLab fetcher can be added without branching on the platform name.
