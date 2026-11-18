---
name: ship
description: Merge a green, reviewed pull request into development, close the issues it closes with a comment, keep the ones it only references open, set Done, and remove its branch and worktree. Use when someone says ship, merge or land a pull request.
argument-hint: "[#N]"
---

# /ship: merge and tidy up

pull request: $ARGUMENTS (default: the one for the current branch)

Ship only a pull request someone asked you to ship, and only into `development` (or `main` for a hotfix). Releases are /release, never /ship.

## 1. Preview

```
agent-os ship [<n>] --dry-run
```

It lists the merge (squash, pinned to the head commit that was checked), the issues it will close, the ones that stay open, and the branch to delete.

## 2. When it is not ready

`agent-os ship` refuses, exit 1, and says why:
- failing, pending or missing checks: wait (`agent-os pr status --watch`) or fix them;
- changes requested or approvals missing: it goes back to review;
- behind or conflicting: it goes back to its author with a comment (`--no-notify` to skip the comment). Never merge the base into someone else's branch without asking;
- an unchecked item under **Before merge**: do it, or ask the author.
- an unticked test scenario in an issue it closes: tick the ones the tests cover, and move the rest to a follow-up issue.

Do not work around a refusal.

## 3. Ship

```
agent-os ship [<n>]
```

- `Closes #N`: closed explicitly (the platform only auto-closes into the default branch), commented in **en**, set to Done.
- `Refs #N`: stays open with a progress comment; reopened if something closed it.
- The branch is deleted on the remote; its worktree is removed and the local branch deleted (`--keep-branch` keeps them).

## 4. After

- Tick the closed issues' test scenarios that the merged tests cover.
- If a closed issue's work left something undone, open it with /ticket now, not "later".

## 5. Learn

When shipping was refused or needed a manual step, capture why: `agent-os lessons add "…" --area <area> --source "#<n>"`. A refusal that keeps coming back is a rule to propose, not a lesson to repeat.
