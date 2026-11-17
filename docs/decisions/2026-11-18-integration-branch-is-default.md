# The integration branch is the default branch

Status: accepted

## Context
GitHub closes an issue from `Closes #N` only when the PR is merged into the repository's **default** branch. With feature PRs going into `development` and only releases going into `main`, issues stay open unless `development` is the default.

## Decision
- `init` creates the integration branch (default name `development`) and makes it the default branch; `main` is the production branch.
- Feature and fix PRs target the integration branch (squash merge by default). Releases are PRs from integration to production (merge commit, the integration branch is never deleted). Hotfixes branch from production and are synced back.
- Rulesets protect both branches: no direct pushes, no force pushes, no deletion; required checks once CI exists.
- Both names and the merge methods are configurable; a project that ships from one branch sets them equal.

## Consequences
`Closes #N` and linked branches (`gh issue develop --base development`) work out of the box. Hotfix PRs into `main` do not auto-close issues, so `/release hotfix` closes them explicitly.
