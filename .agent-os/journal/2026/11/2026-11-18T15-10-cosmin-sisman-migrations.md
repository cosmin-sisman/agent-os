---
type: decision
refs: ["#67", "#68", "#66"]
areas: [updates]
author: cosmin-sisman
---

# Migrations: ordered, idempotent, recorded

A migration is `migrations/<version>.mjs` exporting `description` and `migrate(project)`. It works only through a small project API (read and write JSON and text, `note`) that records real changes and honours dry runs.

Decisions:
- Idempotency is checked twice over: each migration must change nothing on its second run (a test runs every real migration twice on its fixture project), and the runner records applied versions in the lock so it does not run them again.
- A failure stops the chain and keeps what came before. A rerun continues from the failed migration, so there is never a half-migrated state that can't be resumed.
- Versions sort numerically, with pre-releases before their release.
- There is no real migration yet, because nothing has needed one. The harness test is in place and requires a fixture for the first one. `agent-os update --migrate` runs them today, and the full update flow (#68) will call the same runner.
