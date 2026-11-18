---
type: decision
refs: ["#30", "#24"]
areas: [loop, hooks]
author: cosmin-sisman
---

# SessionStart context: local first, platform if quick, one budget

Two SessionStart handlers and a budget enforced by the runner.

Decisions:
- Lines carry a priority (branch and issue, then assignments and reviews, then lessons, the inbox, the skills). The runner keeps the most important lines that fit `contextBudgets.SessionStart` (1.5 KB by default) and drops the rest, so the injection never exceeds the budget.
- Local and remote are separate handlers. The local one never needs the network. The remote one has a 3-second timeout, and context handlers fail quietly, so a session offline starts with the local lines and no warning. That is the issue's scenario and the "never blocks" criterion.
- Nothing from .agent-os/local.json or the environment goes into the context (orchestrator's condition); a test seeds a token-like value there and checks it is absent.
- The tracker gained `assignedIssues(login)` on both adapters.
