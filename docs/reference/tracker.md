# Tracker

Skills don't compose `gh` or `glab` commands. They call one tracker interface, available to people as `agent-os issue`. GitHub is implemented (REST and GraphQL through `gh api`); GitLab follows in #92.

```bash
agent-os issue create --title "Login: session expires too early" --body-file body.md \
  --label type:bug --label priority:p1 --label area:auth --milestone "v0.2 Core workflow" \
  --assignee ana --parent 10 --blocked-by 12 --status Todo
agent-os issue update 42 --state closed --label blocked --remove-label needs-decision
agent-os issue relate 42 --parent 10          # sub-issue of an epic
agent-os issue block 42 --blocked-by 12       # GitHub's "blocked by" relationship
agent-os issue assign 42 ana dan
agent-os issue branch 42 --name fix/42-session-expiry --base development   # linked in the issue's Development panel
agent-os issue status 42 "In Progress"        # on the planning board
agent-os issue get 42 · children 10 · blockers 42 · progress --milestone "v0.2 Core workflow"
```

- Every write accepts `--dry-run`: it prints the exact requests it would send, and sends nothing.
- `--json` prints only the result on stdout. Warnings go to stderr.
- `create` does everything in one call: issue, labels, milestone, assignees, parent, blockers and board status.
- Relating twice is not an error. Rate limits and the board's temporary conflicts are retried with backoff.
- **The board** (GitHub Projects v2) is configured with `platform.board: { "owner": "acme", "number": 7 }`. Without a board, status is skipped quietly. Without the token's `project` scope, it is skipped with a warning and the fix (`gh auth refresh -s project`), and everything else still happens.
- GitHub Enterprise Server works through `platform.host`.
