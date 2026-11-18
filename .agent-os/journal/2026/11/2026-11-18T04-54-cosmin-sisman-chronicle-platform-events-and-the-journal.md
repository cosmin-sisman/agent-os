---
type: decision
refs: ["#25", "#22"]
areas: [knowledge]
author: cosmin-sisman
---

# Chronicle: platform events and the journal in one timeline

`agent-os chronicle --since [--issue] [--area]`, rendered into the cache.

Decisions:
- A new tracker `activity(since)` feeds the timeline. On GitHub it combines issues/PRs updated since the date (opened, closed, merged), repository comments since, reviews of the PRs in range (up to 30), milestones and releases. On GitLab the project events API supplies it in one list.
- `--issue N` includes the change requests whose description closes or references #N, and the journal entries that reference any of them. That shows a decision taken in a comment next to the PR that implemented it, which is the issue's scenario.
- Each line links its source. Journal links are written relative to the cache folder so they work from the render.
- Read-only preview on this repository for #28: it showed PR #158, the follow-up #159, the incident and the decisions, in order.
