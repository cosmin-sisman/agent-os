---
type: decision
refs: ["#48", "#49"]
areas: [init]
author: cosmin-sisman
---

# Repository state: signals from git, a profile with its reason

`agent-os init --detect` reads the repository and suggests one of the four profiles from design §11.

Decisions:
- Signals come from git and the file tree, so detection works offline. Open change requests are added only when the platform answers; otherwise they stay unknown (null), not zero.
- The rules are ordered, and every suggestion carries a confidence and a one-line reason (the acceptance criterion). Ties fall back to `active` at low confidence, with a request to confirm.
- Done before #49 (the init interview), because the interview starts by confirming this profile.
- Read-only run on this repository: `active (medium): 50 commit(s) in 90 days`. Nothing was written.
