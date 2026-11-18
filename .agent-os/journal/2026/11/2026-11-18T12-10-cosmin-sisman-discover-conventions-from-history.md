---
type: note
refs: ["#52"]
areas: [init, knowledge]
author: cosmin-sisman
---

# /discover: conventions and decisions inferred from history, each with its evidence

`agent-os discover plan` infers the commit types, the branch prefixes, the merge method, an area map draft and decisions from change-request descriptions. Every proposal carries counts and examples, and nothing is proposed without evidence. Proposals only reflect the history: commit types are added to the defaults, never narrowed. `discover apply --accept` writes only what the person accepted. The new `branches.prefixes` makes `agent-os start` keep a team's own prefixes (`feature/`, `bugfix/`). The PR listings of both adapters now carry the head branch.
