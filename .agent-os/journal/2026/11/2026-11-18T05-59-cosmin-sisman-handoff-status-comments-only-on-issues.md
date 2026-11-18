---
type: decision
refs: ["#36", "#22"]
areas: [collab]
author: cosmin-sisman
---

# /handoff: status comments only on issues you hold with work in flight

`agent-os handoff` and the /handoff skill.

Decisions:
- An issue gets a comment only if it is assigned to you and has work in flight: a pushed branch named for it, or an open change request. That is the orchestrator's limit, and it avoids noise on issues that haven't started. A test checks that issues held by others get nothing.
- The comment carries what the next person needs and cannot see on a laptop: the branch, the last commit, the change request and its checks, open blockers, unticked scenarios, and the next step.
- One handoff journal entry lists them, replacing the hand-written state file the reference workflow used.
