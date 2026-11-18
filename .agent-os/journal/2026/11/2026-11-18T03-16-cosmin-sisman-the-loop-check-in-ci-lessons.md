---
type: decision
refs: ["#28", "#27", "#11"]
areas: [loop, ci]
author: cosmin-sisman
---

# The loop check in CI: Lessons, journal entry, doctor

`agent-os check loop` and the `agent-os/loop` workflow for GitHub and GitLab.

Decisions:
- Rule: Lessons must say something; the template comment and a bare "None" fail. A lesson or decision needs a journal entry on the branch. "None: <why>" marks a trivial change that needs no entry. doctor --ci must have no failure. This combines the issue's acceptance criteria with design §10 ("no journal entry and no explicit Lessons").
- Dependency bots are exempt because the release entry records their changes.
- `--from-ci` reads the PR description, author and base from the GitHub event file or the GitLab merge request variables. That avoids `${{ }}` interpolation (an injection risk) and also the template engine's `{{ }}` syntax in workflow templates.
- `agent-os setup` always adds `agent-os/loop` to the ruleset's required checks. On this repository only the dry run was done: 'would update ruleset "protect main and development" (#27505024): add required checks agent-os/loop,ci'. Applying it is the repository owner's decision.
- In this repository the job is named `agent-os/loop` and stays outside the `ci` aggregator, so it is not required until the ruleset says so.
