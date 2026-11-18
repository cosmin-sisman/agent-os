---
type: decision
refs: ["#12", "#92", "#91"]
areas: [github, platform]
author: cosmin-sisman
---

# The tracker adapter and its GitHub implementation

Skills will call `createTracker(config)` and get an adapter with one interface: create, update, setParent, addBlocker, assign, linkBranch, setStatus, plus the reads get, children, blockers and progress. `agent-os issue` exposes the same operations to people.

Decisions:
- Every write takes `{ dryRun }` and then returns the exact requests. Tests use a fake gh that records every call, and nothing in the test suite talks to GitHub. On the orchestrator's instruction, the real repository was only read while building this (children of #10, blockers of #13, milestone progress).
- `create` takes the complete issue (labels, milestone, assignees, parent, blockers, board status), because /ticket has to set everything GitHub allows in one step.
- The board is optional and scope-tolerant: no board means a quiet skip, and a missing `project` scope means a warning with the fix while the rest succeeds. Capability probing (#91) will generalize this pattern across platforms.
- With `--json`, stdout carries only the result. Warnings go to stderr, so scripts never parse them by accident.
