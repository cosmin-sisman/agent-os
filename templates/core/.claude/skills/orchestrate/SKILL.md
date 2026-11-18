---
name: orchestrate
description: Optional - coordinate several of your own sessions on this laptop - one session holds the orchestrator role, briefs worker sessions that each work one issue in their own worktree, and tracks them in a personal local ledger with typed messages (BRIEF, ACK, QUESTION, UPDATE, DONE, REVISE, CLOSE). Use only when the person runs several sessions and asks for one to coordinate; it never coordinates other people, who coordinate on {{vocab.platform}}.
---

# /orchestrate: one session coordinates, the others work

The role is off by default. The person turns it on for their laptop with `agent-os init --me --orchestrator`.

## 1. Claim the role

```
agent-os orchestrate claim
```

This session is now the orchestrator. **It does not edit files**: a guard refuses Edit and Write here. It reads, plans, briefs, reviews and reports. `agent-os orchestrate release` gives the role back.

## 2. Brief a worker per issue

```
agent-os orchestrate brief <n>
```

Give the printed BRIEF to a worker session. The worker claims the issue with `agent-os start <n> --worktree` and works only in that worktree. One issue per worker; zero workers is fine.

## 3. Messages

Record what the workers say and what you answer, with their type:

```
agent-os orchestrate message ACK|QUESTION|UPDATE|DONE <worker> [--text "…"] [--pr <n>]
agent-os orchestrate message REVISE|CLOSE <worker> --text "…"
```

Messages never carry a secret: name the variable or the store instead. **Permissions are the person's.** When a worker reports a refused action, tell the person. Never ask the worker to get past it, and never run it yourself in its place. The command refuses such messages.

## 4. Keep the ledger true

```
agent-os orchestrate reconcile
agent-os orchestrate status
```

`reconcile` follows the worktrees and the {{vocab.changeRequests}}: merged is done, closed is closed, and a worker whose worktree is gone is marked gone. The ledger (`.agent-os/cache/orchestrator.json`) is personal and never committed.

## 5. Learn

If a brief was not enough for a worker to finish alone, capture what was missing with `agent-os lessons add`.
