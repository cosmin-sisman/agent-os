---
type: decision
refs: ["#11", "#93"]
areas: [github]
author: cosmin-sisman
---

# agent-os setup on GitHub, and the first dry run against this repository

`agent-os setup` plans steps (integration branch and default, ruleset, labels, rolling milestone, route files) that only read while planning and only write when applied. Tests run it against an in-memory GitHub repository with the real semantics (renamed labels stay on their issues), which proves idempotency and the main-only scenario without touching a real repository.

Decisions:
- An existing ruleset that already covers both branches is reused and completed, never duplicated. This repository already has one ("protect main and development", created by hand at bootstrap), and setup recognizes it.
- Label language switches are renames, never delete and create.
- Real bug found: in labels.yaml, the color `000000` was read by the YAML subset as the number 0. The colors are now quoted, and the code coerces them too. A lesson was captured for the standards rule.

On the orchestrator's instruction, setup was not applied to this repository. A dry run (reads only) was posted on #11 for the owner: create the `blocked` label, update the `security` label's description, and create a rolling milestone, which this repository's v0.x milestones don't follow.
