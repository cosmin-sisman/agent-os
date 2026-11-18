---
type: lesson
refs: ["#221", "#29"]
areas: [lessons]
author: cosmin-sisman
---

# Retro: this repository's inbox triaged into rules and cards

The decisions followed the proposal on #29, which the owner approved. The two lessons added to the inbox after it were made cards, as `retro plan` proposed.

- **Rules**, now in `docs/rules.md` and linked from AGENTS.md, which stays under its budget:
  - Platform calls: project-conflicts, merge-not-replace-settings
  - Shell and exit codes: never-pipe-a-check-into
  - Configuration schema: ownership-inherits
  - Paths: file-url-paths
  - Tests: test-helpers
  - YAML: yaml-hex-colors
- **Cards**: hashes-need-lf, repo-values-never-in-shell, claim-before-the-first-edit.
- **Rejected**: none.

Running it also turned up a bug: `retro apply --dry-run` wrote the decisions. A dry run now checks every decision and writes nothing.
