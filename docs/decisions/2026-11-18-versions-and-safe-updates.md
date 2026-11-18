# Pinned versions, lifecycle markers and updates through a PR

Status: accepted

## Context
A team of several people needs everyone on the same agent-os version, and upgrades must not break a working project. Some features will be replaced over time, and users need warning before anything disappears.

## Decision
- The project pins an exact version in `agent-os.json`. Hooks and skills run that version, and `doctor` warns on mismatches.
- Semver with an explicit contract of what counts as breaking. Breaking changes ship only with a migration and in a major release (a minor one before 1.0).
- A generated `manifest.json` marks every shipped item `new`, `stable`, `deprecated` (with `deprecatedIn`, `removeIn`, `replacement`), `legacy` (opt-in) or `removed` (with its migration). Nothing skips the deprecation stage.
- `agent-os update --plan` explains the upgrade grouped as Breaking, New, Deprecated, Legacy, Removed, Fixes and Chore. `agent-os update` runs preflight checks, works on a `chore/agent-os-<version>` branch, runs ordered idempotent migrations, applies files through the lock rules, verifies with doctor, env and the gate, and opens a PR.
- Release CI refuses a manifest with a removal that has no migration, or a deprecation that has no replacement and removal version.

## Consequences
Upgrades are reviewable, reversible and the same for everyone. Deprecations are visible in each project long before they bite.
