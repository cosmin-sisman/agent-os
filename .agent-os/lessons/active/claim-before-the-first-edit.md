---
areas: [workflow]
paths: []
keywords: [branch, start]
source: "#50: a push to development was blocked by the permission check"
confidence: medium
recalled: 0
followed: 0
---

Claim the issue and switch to its branch (agent-os start, or gh issue develop + switch) before the first edit, not before the commit: work written on the integration branch ends in a push to it, which only a guard stops.
