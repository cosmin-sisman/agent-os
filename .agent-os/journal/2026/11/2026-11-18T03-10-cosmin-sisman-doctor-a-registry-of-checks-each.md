---
type: decision
refs: ["#27", "#28", "#24", "#39"]
areas: [loop, cli]
author: cosmin-sisman
---

# doctor: a registry of checks, each finding with its fix

`agent-os doctor` with 15 checks across the agent system, context budgets, language, history, updates, the repository and the platform. It supports `--offline`, `--ci`, `--fix`, `--check`, `--json` and gives a readiness score.

Decisions:
- Checks live in a registry (`CHECKS`) as small functions that return findings. Each finding has a level, a message and a fix, plus an optional `apply` for mechanical repairs. New areas (lessons in #24, the skill registry in #39) add a check instead of growing a monolith.
- "Registered" means a `.agent-os/registry/<name>.json` entry (design §6), or a skill managed by agent-os in the lock. Core skills therefore need no extra files on a fresh install, and the issue's scenario holds: a folder that is neither fails and is named.
- `--fix` is limited to local, mechanical changes (`.gitignore` entries, diacritics in ro areas). Platform repairs such as missing labels are only proposed, with the command that does them, because creating labels on the platform is a setup step for the person to decide.
- A check that throws becomes a warning with the reason, so one expired login never hides the rest of the report.
- Forward-only: the new `adoption.cutoff` makes doctor skip older journal entries and issues.
- `update` now runs `doctor --ci` in its preflight.
- Running it on this repository (offline) gives 0 FAIL and 3 warnings. One of them is real: AGENTS.md is at 91% of its 8 KB budget, so it should be split before it grows further.
