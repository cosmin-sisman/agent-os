---
type: decision
refs: ["#20"]
areas: [github, platform]
author: cosmin-sisman
---

# Board: optional, synced by difference, one warning without scope

`agent-os board plan|sync|create`.

Decisions:
- The default field set is Status (built in), Priority (P0–P3) and Size (XS–XL), mirrored from the labels. Iteration is not created: teams that plan in iterations add it, and the labels stay the source.
- Sync compares the board's current values with the issues and writes only differences. It adds missing issues and moves closed ones still on the board to Done. A value the board has no option for is reported, because the board's fields belong to its owner.
- Without the project scope the board is skipped with one warning, and every other command works. That covers the issue's scenario.
- Only a dry run on this repository. `board plan` against Project #7 found 11 closed issues still shown as In Progress (#2–#9, #63, #99, #69). The issue-level sync had set them to Done, so something moved them back, probably a project workflow. Applying the sync was stopped by the permission classifier and is left to the owner. `board create --dry-run` shows the steps; no project was created and no field, view or workflow changed.
