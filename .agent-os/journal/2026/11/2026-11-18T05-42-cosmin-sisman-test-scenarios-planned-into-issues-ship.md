---
type: decision
refs: ["#44", "#16", "#15", "#46"]
areas: [testing]
author: cosmin-sisman
---

# /test: scenarios planned into issues; ship needs them ticked

`agent-os test plan|local|gaps|pr`, the /test skill, and the links from /ticket, /pr and /ship.

Decisions:
- Scenarios are `- [ ] Given …, when …, then …` lines in the issue's Test scenarios section, the same format as the issue forms. `plan` builds them from the form sections. A bug gets its regression scenario first, the one that fails before the fix (the issue's scenario). A feature gets one per acceptance criterion. The `…` placeholders are for the person to fill in before `--write`, because the CLI cannot guess conditions.
- /ship refuses while a scenario of an issue it closes is unticked. That makes "done means tested" checkable. In my own flow this means ticking the issue's checkboxes before shipping, not after.
- `gaps` uses filename conventions, plus `testing.exclude` for generated or vendored code. The configurable source-to-test mapping is #46.
- `test pr` keeps the results in a marked block, so reruns replace it instead of piling up tables.
- Every issue created through /ticket already has scenarios: `issue new` refuses one without the section (#13).
