# Tracker

Skills don't compose `gh` or `glab` commands. They call one tracker interface, available to people as `agent-os issue`. Both platforms implement it with the same methods and result shapes: GitHub through `gh api` (REST and GraphQL), GitLab through `glab api` (REST v4 and GraphQL), cloud or self-managed (`platform.host`).

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

## A complete issue: `issue new` and `/ticket`

```bash
agent-os issue similar "Login: the session expires too early"     # possible duplicates, open and closed
agent-os issue new --title "Login: the session expires after five minutes" --body-file body.md \
  --label type:bug --label priority:p1 --label area:auth --milestone "v0.2 Core workflow" \
  --assignee ana --parent 10 --blocked-by 12 --blocks 15
```

`issue new` refuses, sending nothing, an issue that lacks any of:
- a title in the form `<Area>: <problem>` (at most 70 characters, no final period);
- exactly one type and one priority label, and at least one `area:*`;
- a milestone;
- a `## Test scenarios` section (`## Scenarii de test` in ro).

In `ro` the title and body must be ASCII. Label ids such as `type:bug` are translated into the `labels` language.

It searches for duplicates first. When an issue looks like the same request, it creates nothing, lists the candidates, and offers `--extend <n>` (post the text as a comment there) or `--force-new`.

Parent, blockers, the issues it blocks and several assignees follow the platform's capabilities: native sub-issues and blocking links on GitHub, the documented fallbacks elsewhere.

The `/ticket` skill (`templates/core/.claude/skills/ticket/SKILL.md`) walks an agent through it: agreement, duplicates, facts, title and body in the issues language with test scenarios, labels, milestone, relationships, create, report, learn.

## Starting work: `start` and `/start`

```bash
agent-os start 14 --dry-run     # the branch, its base and the steps, nothing sent
agent-os start 14               # assign @me, create and link the branch, check it out, In Progress
agent-os start 31 --hotfix      # hotfix/31-<slug>, cut from the production branch
```

- The branch is `<type>/<n>-<slug>`: `feat`, `fix`, `docs` or `chore` from the issue's type label (in either language), and a short ASCII slug of the title without its `<Area>:` prefix.
- The base is `branches.integration` (`development` by default), or `branches.production` with `--hotfix`.
- With linked branches (GitHub: `gh issue develop --base`), the branch appears in the issue's Development panel. Without them it is created from `origin/<base>` and the change request links it through `Closes #N`.
- It stops, changing nothing, when the issue is assigned to someone else (ask in its comments; `--force` once they agree), has open sub-issues (start one of them), is an epic, is closed or is a pull request.
- The branch is checked out in place. `--worktree` puts it in `.claude/worktrees/<branch>` instead, for parallel sessions; it is off by default.
- With a board, the issue moves to In Progress.

## What to work on: `next` and `/next`

```bash
agent-os next            # the top three, one line each, with the action
agent-os next --json     # recommendations, excluded (with reasons), the current milestone, warnings
agent-os next --limit 5
```

The order (design §9), the same for the same platform state:

1. Your open change requests with requested changes or failing checks.
2. Reviews requested from you.
3. Issues assigned to you with a branch on the remote (`<type>/<n>-<slug>`): in progress.
4. Your other issues: earliest milestone (due date, then version in the title), then priority, then how many open issues they block.
5. Unassigned issues in the current milestone (the first open milestone in that order with open issues): by priority, then the number of their areas you closed issues in recently.

Ties go to the lower issue number. Epics, blocked issues (an open "blocked by" link, or the `blocked` label where the platform has no dependency links) and issues assigned to someone else are left out and listed in `excluded`. It only reads.

## GitLab specifics

The GitLab adapter (`src/tracker/gitlab.mjs`) keeps the shared shapes, so every skill and command works the same way. Where GitLab differs:

| Topic | On GitLab |
|---|---|
| Numbers | iids: `#N` issues, `!N` merge requests, `&N` epics |
| Parent | Premium: the issue is attached to the epic `&N` (`groups/:group/epics/:N/issues/:id`). Free: an issue cannot be a child of another issue (child *tasks* are a different type), so it gets the fallback: a `Parent: #N` line, and the parent a `- [ ] #child` item |
| Blocked by | issue links with `link_type: is_blocked_by` (Premium); a repeated link (409) counts as already linked. Without them: the `blocked` label and a `Blocked by #N` line |
| Board status | a scoped label `status::<value>` (`status::in-progress`); other `status::` labels are removed, because GitLab boards list issues by label |
| Assignees | by user id (looked up from the username); several only on Premium |
| Checks | the jobs of the merge request's head pipeline; a retried job counts once, by its latest run; manual jobs allowed to fail are ignored |
| Review | approvals (`approved`), and `requested_changes` from the detailed merge status |
| Behind / conflicts | `detailed_merge_status: need_rebase` / `has_conflicts` |
| Review threads | resolvable discussions; their id is `<merge request>:<discussion>` for `agent-os pr reply` |
| Merge | `PUT …/merge` with `sha` (pinned) and `squash` |
| Branch link | branches are not linked by the API: `/start` cuts the branch locally and `Closes #N` links it |

Lists are paged by 100 (up to 2000 items), and rate limits (HTTP 429) and temporary server errors are retried with backoff.

## The planning board: `board`

```bash
agent-os board plan [--issue 42]          # what sync would change (read only)
agent-os board sync [--issue 42]          # Status, Priority and Size, only where they differ
agent-os board create --title app --dry-run
```

The board is optional (GitHub Projects v2, configured as `platform.board`), and it needs the token's `project` scope.

- **Fields:** Status is built into every board. The default set adds **Priority** (P0–P3) and **Size** (XS–XL), mirrored from the `priority:*` and `size:*` labels. Iteration is left to teams that plan in iterations.
- **Values:**
  - Status: Done when closed, In Progress when someone is assigned, Todo otherwise.
  - Issues missing from the board are added.
  - Closed issues still on the board are set to Done.
  - A value the board has no option for is reported, never invented.
- **Without the scope:** the board is skipped with **one** warning (`gh auth refresh -s project`), however many issues a command touches, and every other command works.
- **`create`** creates a project linked to the repository, with the default fields. It refuses when `platform.board` is already set.
- On GitLab, the board lists issues by their `status::` label (`agent-os issue status`), so there is nothing to sync.
