---
type: decision
refs: ["#29", "#24", "#17"]
areas: [knowledge, loop]
author: cosmin-sisman
---

# /retro: every inbox lesson decided; counters have one writer

`agent-os retro plan|apply|issue`, the /retro skill, and the scheduled workflow templates.

Decisions:
- Proposals are rule, card or reject, each with its reason. Review findings that repeat on three or more recent change requests (compared with a normalized key of the first comment) are proposed as rules. That is the issue's scenario.
- `apply` refuses while any inbox lesson is undecided, and a rejection needs a reason (the acceptance criterion). A promoted lesson is retired with the rule it became.
- The recalled and followed counters are computed from the journal and written only by `apply`, which keeps recall read-only (#24).
- The Retro issue is one issue, updated in place and closed when the inbox is empty. A new issue every week would bury the triage.
- `release plan` reminds you to run /retro when lessons wait.
- This repository has no Retro issue and no active retro workflow: the workflow is a template installed in projects. The read-only plan here proposes decisions for 8 inbox lessons; it is posted on #29.
- Templates can now write CI expressions with `{{{expr.open}}}…{{{expr.close}}}`, since `${{ }}` collides with template tags.
