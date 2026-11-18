---
type: decision
refs: ["#18", "#14"]
areas: [skills, github, workflow]
author: cosmin-sisman
---

# /next: a deterministic ranking from the platform's state

`agent-os next` puts candidates in the five tiers of design §9 and orders each tier by explicit keys with the issue number as the last tie-break, so the same state gives the same answer. The skill explains the top three and offers /start; it may disagree with the order, but only after showing it.

Decisions:
- "In progress" means a branch named `<type>/<n>-<slug>` exists on the remote, which is what /start creates; it works without a board.
- "Areas you touched recently" is the area labels of issues you closed recently (assigned to you), not `git log --author`: the design's file history has no mapping from paths to areas yet. Recorded as a deviation from §9.
- Blockers are checked lazily for unassigned candidates (only until the limit is reached), so a large milestone costs a few calls, not one per issue. A read-only run on this repository took about 9 seconds and ranked #18 (in progress), then #15, #68 and #92, with #16, #17 and #93 left out as blocked.
