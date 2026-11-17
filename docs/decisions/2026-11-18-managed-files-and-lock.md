# Managed files and the lock file

Status: accepted

## Context
A package that writes files into many repositories becomes a pile of drifting copies unless updates can reach them. Teams also edit what they install, and an update must not destroy those edits.

## Decision
- Every file agent-os installs is recorded in `.agent-os/lock.json` with its package version and content hash.
- `agent-os update` replaces a managed file whose local hash matches the lock; otherwise it performs a three-way merge (installed version, local version, new version). Conflicts are written to `<file>.rej` with a proposal, never applied silently.
- Mixed files (`AGENTS.md`, `.claude/settings.json`) contain managed regions: a marked block in Markdown, and hook entries whose command starts with `agent-os hook` in JSON. Everything else in them is owned by the project.
- `agent-os eject <path>` removes a file from management.

## Consequences
Updates are safe to run often. The lock file is committed and changes only when someone installs or updates, so it rarely conflicts; when it does, `agent-os update --relock` regenerates it from disk.
