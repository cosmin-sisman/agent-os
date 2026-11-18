---
type: note
refs: ["#106"]
areas: [artifacts, audit]
author: cosmin-sisman
---

# Audit outputs: an artifact at the audited commit, a comparison with the previous audit, proposed issues

`agent-os audit report` writes an `audit` artifact holding the summary, the scores per lens, the findings, the questions, the strengths, a roadmap and the commit it audited. It keeps the report in `data.json`, so the next audit of the same subject can list what was fixed, what is new, what got worse and what got better. `audit verify` checks the audited commit. `audit propose` drafts issues only for the findings the person accepted, as one epic above five, and calls no platform: /ticket files them. AGENTS.md now names both required checks, `ci` and `agent-os/loop`.
