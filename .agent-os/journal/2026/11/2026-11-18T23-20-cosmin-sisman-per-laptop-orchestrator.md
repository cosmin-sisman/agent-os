---
type: decision
refs: ["#35"]
areas: [collab]
author: cosmin-sisman
---

# The per-laptop orchestrator: optional, a local ledger, an edit guard, typed messages

`agent-os orchestrate` is off by default (`orchestrator` in the personal settings). One session claims the role, briefs a worker per issue (each in its own worktree), records typed messages (BRIEF, ACK, QUESTION, UPDATE, DONE, REVISE, CLOSE) and reconciles with the worktrees and change requests. The ledger is `.agent-os/cache/orchestrator.json`: personal, never committed. The guard refuses edits from the session whose directory holds the role. That is deterministic from the hook's cwd, with no session id needed, and workers in worktrees are never refused. Messages refuse secrets and any request to get past a guard, check or permission: permissions stay with the person.
