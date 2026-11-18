---
type: note
refs: ["#226"]
areas: [platform]
author: cosmin-sisman
---

# The GitHub adapter is split by responsibility, under 500 lines per file

`src/tracker/github.mjs` (562 lines) is now four files:
- `github.mjs` (315): the class, issues and relationships;
- `github-changes.mjs` (173): change requests, tags, releases, milestones and review threads;
- `github-board.mjs` (72): the Projects v2 board;
- `github-shared.mjs` (27): the "already done" answers, the issue shape, the checks rollup.

The two parts are classes whose methods are copied onto `GitHubTracker.prototype`, so the adapter keeps one `this` and one interface. Callers and tests are unchanged.
