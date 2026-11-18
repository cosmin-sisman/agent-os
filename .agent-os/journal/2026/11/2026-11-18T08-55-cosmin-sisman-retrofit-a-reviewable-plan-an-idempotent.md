---
type: note
refs: ["#50"]
areas: [init]
author: cosmin-sisman
---

# Retrofit: a reviewable plan, an idempotent apply, closed PRs never rewritten

Retrofit brings an existing repository's history into the system in two steps: a reviewable plan, then an apply that checks the current state before every write. Re-running it changes nothing, writes are rate-limited, and what it touched is marked. Closed change requests are never rewritten, and their information goes into a baseline journal entry. The apply checks again that a change request is still open before editing it. A title the conventions cannot fix is left for its author rather than invented. Tested only against a fake tracker and a fake git; it was never run on this repository.
