---
name: release
description: Release what is on {{branches.integration}} to {{branches.production}} - a release {{vocab.changeRequest}} merged with a merge commit, a tag, the {{vocab.platform}} release with grouped notes, the rolling milestone rolled, release checks, and the sync back. Use only when the person asks to release or to ship a hotfix to production.
argument-hint: "<x.y.z> [--hotfix]"
---

# /release: from {{branches.integration}} to production

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

For each risk, ask the person explicitly. For a migration: is there a backup, and how do we roll back? For a variable: is it set in production? Do not continue until they answer. Record each accepted risk by ticking it under **Before merge** in the release {{vocab.changeRequest}}, or with `--accept <id>`.

## 3. Open the release {{vocab.changeRequest}}

```
agent-os release open --version <x.y.z>
```

This creates `release/<x.y.z>` from `{{branches.integration}}`, with the changelog entry and a release journal entry, and opens it into `{{branches.production}}`. It also sets `package.json` to the version, when there is one. Running it again updates the same {{vocab.changeRequest}}. It stops when `{{branches.production}}` is not an ancestor of `{{branches.integration}}` (a sync was squashed or never merged), and says when the {{vocab.changeRequest}} conflicts: the platform runs no checks on a conflicting one. Wait for its checks and its review.

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
- opens the sync of `{{branches.production}}` back into `{{branches.integration}}`. /ship merges it with a merge commit, never squashed. Otherwise `{{branches.integration}}` misses the release merge, and the next release {{vocab.changeRequest}} conflicts and gets no checks.

It never deletes `{{branches.integration}}`.

**Hotfix:** once the fix is on `{{branches.production}}` (a `hotfix/` branch through /{{vocab.crSkill}} and /ship), run `agent-os release finish --version <x.y.z> --hotfix`. It tags production and syncs it back.

## 5. After

Report the release link, the checks and the sync {{vocab.changeRequest}}. If a release check failed, the release is out: say so plainly and open an incident with /ticket.

## 6. Learn

When a release surprised anyone (a risk found late, a check that should have run earlier), capture it: `agent-os lessons add "…" --area release --source "<tag>"`.
