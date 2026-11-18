---
type: lesson
refs: ["#240", "#237", "#239"]
areas: [loop]
author: cosmin-sisman
---

# The release sync is a merge from production, never a squash

`ship` squash-merged the v0.1.0 sync (#237, `release/0.1.0` → `development`), following `branches.mergeMethod`. `development` never got `main`'s release merge commit, so the v0.1.1 release pull request (#239) conflicted on `changelog.yaml`, and GitHub ran no checks on it. Even a merge commit of the release branch would not have helped: only `main` holds the release merge.

Three fixes:
- `release finish` now opens the sync from production itself, marked with `<!-- agent-os:sync -->`;
- `ship` merges any sync (that marker, or a head of production, `release/*` or `hotfix/*` into integration) with a merge commit, whatever `mergeMethod` says;
- `release open` stops when production is not an ancestor of integration, and says when the release pull request conflicts.
