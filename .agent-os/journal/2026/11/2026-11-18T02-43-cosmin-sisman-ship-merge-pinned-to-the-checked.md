---
type: decision
refs: ["#16", "#15"]
areas: [skills, github]
author: cosmin-sisman
---

# /ship: merge pinned to the checked commit, Closes vs Refs

`agent-os ship` merges a green, reviewed change request and makes the tracker match the work.

Decisions:
- The merge passes the head sha that the readiness check saw, so a push between the check and the merge makes the platform refuse instead of merging unchecked code.
- Closing issues is explicit even though the integration branch is the default branch here: a project whose integration branch is not the default would otherwise leave them open. An issue the platform already closed gets the comment and is not closed a second time.
- A Refs issue that is closed after the merge, but was open before it, is reopened with a comment. That is the "closed by mistake" case from the issue.
- Behind or conflicting goes back to the author as a comment. /ship never updates someone else's branch on its own.
- Optional "Before merge" checklists were added to the PR and MR templates (en and ro); an unchecked item blocks the merge.
- Clean-up order follows the trap in the issue: remove the worktree first, switch away from the branch, then delete it locally. The remote branch is deleted only for the PR's own, non-fork head branch.
- New config key `branches.mergeMethod` (squash by default).
- Found by shipping this PR with `agent-os ship`: when a check is re-run on the same commit (here after a PR body edit), the commit keeps the old failed run, and GitHub's rollup state still says FAILURE. Checks are now counted one per name with the latest run winning, as for required checks (`checksOf`), in `pr status`, `ship` and `next`.
