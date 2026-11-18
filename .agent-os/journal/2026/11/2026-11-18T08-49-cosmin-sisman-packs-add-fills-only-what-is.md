---
type: note
refs: ["#55"]
areas: [packs]
author: cosmin-sisman
---

# Packs: add fills only what is unset, remove takes back exactly that

Packs keep stack knowledge out of core: a pack brings rules, subagents, gate suites, requirements and slot bindings, and `agent-os add <pack>` installs them. Its configuration goes into agent-os.json only where the team set nothing, and the lock records exactly what it added. `pack remove` takes back only that and leaves the rest of agent-os.json byte-for-byte as before. A pack file edited by hand stops the removal and is never deleted silently; eject keeps it. The reference pack, stack-postgres, has migration and schema rules, a reviewer subagent, a migrations gate suite and its requirements, which `agent-os env` reports after add.
