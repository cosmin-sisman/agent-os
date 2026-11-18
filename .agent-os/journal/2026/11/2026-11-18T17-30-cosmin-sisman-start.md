---
type: decision
refs: ["#14", "#33", "#24"]
areas: [skills, workflow]
author: cosmin-sisman
---

# /start: claim an issue, branch from the right base, link it

`agent-os start <n>` assigns you, creates `<type>/<n>-<slug>` from `branches.integration` (or `hotfix/<n>-<slug>` from `branches.production` with `--hotfix`), links it in the issue's Development panel through `gh issue develop --base`, checks it out and sets the board status to In Progress.

Decisions:
- An issue assigned to someone else, an epic or an issue with open sub-issues is a stop with a suggestion (exit 1), not an error: the skill proposes a comment or a sub-issue. `--force` exists for after the assignee agrees.
- The worktree is opt-in (`--worktree`, into `.claude/worktrees/`); checking out in place is the default.
- Without linked branches (a platform without them), the branch is cut locally from `origin/<base>` and `Closes #N` links it, through the capabilities, not the platform name.
- The `overlap` check (#33) and `lessons recall` (#24) the issue lists are not built yet; /start will call them once they exist.
- git goes through an injectable `io.git`, so tests never touch a real repository and no one on the real repo was assigned as a test.
