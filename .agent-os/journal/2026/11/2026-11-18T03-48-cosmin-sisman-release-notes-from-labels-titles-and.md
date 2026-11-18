---
type: decision
refs: ["#70", "#17", "#68"]
areas: [updates, release]
author: cosmin-sisman
---

# Release notes from labels, titles and the journal

`agent-os release notes` builds the notes for a range. `--changelog` writes the same groups to changelog.yaml, which `update --plan` reads (#68).

Decisions:
- The change requests in a range come from git history (squash subjects ending in `(#N)`, and merge commits), not from a platform search. The range is exact and works on both platforms.
- Grouping is decided first by the changelog label, then by the type label, then by the title's type (with `!` meaning breaking), so an unlabelled change request still lands somewhere sensible.
- A breaking or removal item must have its migration: a `Migration:` line or `migrations/<version>.mjs`. A deprecation must have its replacement (`Replacement:`). If either is missing, the command fails with the exact line to add. This is the acceptance criterion and the issue's test scenario.
- Local and read-only. A preview on this repository's whole history listed 40 change requests (32 new, 2 fixes, 6 chore) and 39 journal entries, with no problems. No release was created; the release flow is #17 and releasing is the owner's decision.
