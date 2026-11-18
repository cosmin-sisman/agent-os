---
type: decision
refs: ["#17", "#70", "#16"]
areas: [release, updates]
author: cosmin-sisman
---

# /release: release branch, merge commit, rerun-safe finish, risks asked

`agent-os release plan|open|finish` and the /release skill.

Decisions:
- The release goes through `release/<version>`, cut from integration. That branch carries the changelog entry and the release journal entry without anyone pushing to the protected integration branch, and the same branch is synced back afterwards. The integration branch is never deleted or squashed into production: the merge is a merge commit pinned to the checked head.
- Every finish step checks what exists first: tag (same commit = done, another commit = stop), release (update the notes), milestone (rolled only by the run that created the tag, so a rerun never closes the milestone it just opened), and the sync change request. A rerun after tagging still computes the notes from the previous tag, so they never become empty.
- Destructive migrations and new environment variables are asked first. finish refuses until each one is ticked under Before merge or passed as `--accept`. That is the issue's scenario.
- Hotfix: the fix reaches production through /pr and /ship with base production. `finish --hotfix` tags production and syncs it back.
- On this repository only a dry run was done (no release change request, no tag, no release): range = first release → origin/development; 33 new, 2 fixes, 6 chore, 40 journal entries; no risks; the next step would be `release open --version 0.1.0`, which is the owner's decision.
