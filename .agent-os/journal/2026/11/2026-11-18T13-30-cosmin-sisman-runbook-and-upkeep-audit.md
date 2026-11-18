---
type: note
refs: ["#54"]
areas: [init, security]
author: cosmin-sisman
---

# Maintenance profile: /runbook and the read-only upkeep audit

`agent-os runbook` writes the deploy, rollback and restore runbooks and the takeover dossier from what the repository knows: branches, merge method, release flow, CI, stack layers, CODEOWNERS, tags and decisions. It marks the rest "to fill" and never overwrites the team's runbooks without --force. `agent-os audit upkeep` proposes prioritized issues: one per vulnerable package (p0 when known exploited or critical, p1 when high), one per secret (p0, value never shown) and license reviews. It reads only the advisory cache and the reports, calls no platform and writes nothing.
