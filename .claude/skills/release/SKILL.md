---
name: release
description: Release what is on development to main - a release pull request merged with a merge commit, a tag, the GitHub release with grouped notes, the rolling milestone rolled, release checks, and the sync back. Use only when the person asks to release or to ship a hotfix to production.
argument-hint: "<x.y.z> [--hotfix]"
---

# /release: from development to production

Version: $ARGUMENTS

A release changes what users run. Ask before each step that writes, and never decide a risk for the person.

## 1. Plan

```
agent-os release plan --version <x.y.z>
```

Show the person:
- the notes, grouped (Breaking, New, Deprecated, Legacy, Removed, Fixes, Chore);
- every **risk**: destructive migrations (`destructive:<file>`) and new variables (`env:<NAME>`).

Fix every problem it lists: a breaking change without its migration, a deprecation without its replacement, a version that is not after the last one.

## 2. Ask first

For each risk, ask the person explicitly. For a migration: is there a backup, and how do we roll back? For a variable: is it set in production? Do not continue until they answer. Record each accepted risk by ticking it under **Before merge** in the release pull request, or with `--accept <id>`.

## 3. Open the release pull request

```
agent-os release open --version <x.y.z>
```

This creates `release/<x.y.z>` from `development`, with the changelog entry and a release journal entry, and opens it into `main`. It also sets `package.json` to the version, when there is one. Running it again updates the same pull request. It stops when `main` is not an ancestor of `development` (a sync was squashed or never merged), and says when the pull request conflicts: the platform runs no checks on a conflicting one. Wait for its checks and its review.

## 4. Finish

```
agent-os release finish --version <x.y.z> --dry-run
agent-os release finish --version <x.y.z>
```

It refuses while a check fails, a review is missing or a risk is not accepted. Then it does these, each skipped when already done, so it is safe to run again:
- merges with a **merge commit**, never squashed and pinned to the checked head;
- tags `v<x.y.z>`;
- publishes the notes;
- rolls the rolling milestone;
- runs the release checks (environment, `release:*` gate suites);
- opens the sync of `main` back into `development`. /ship merges it with a merge commit, never squashed. Otherwise `development` misses the release merge, and the next release pull request conflicts and gets no checks.

It never deletes `development`.

**Hotfix:** once the fix is on `main` (a `hotfix/` branch through /pr and /ship), run `agent-os release finish --version <x.y.z> --hotfix`. It tags production and syncs it back.

## 5. After

Report the release link, the checks and the sync pull request. If a release check failed, the release is out: say so plainly and open an incident with /ticket.

## 6. Learn

When a release surprised anyone (a risk found late, a check that should have run earlier), capture it: `agent-os lessons add "…" --area release --source "<tag>"`.
