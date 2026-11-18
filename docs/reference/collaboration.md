# Collaboration

How several people, each with their own agent sessions on their own laptops, work in one repository without stepping on each other. Design §5.

## Seeing overlap: `agent-os overlap`

```bash
agent-os overlap                       # the files changed on this branch
agent-os overlap --path src/db/        # specific paths; a folder ends with /
agent-os overlap --offline             # pushed branches only, no platform calls
```

It lists every open change request, and every pushed branch without one, that touches the same files as yours, with the author and the issues involved:

```
2 other change(s) touch your files; talk to them before you both go further:
  #40 feat(db): connection pool by @dan (#12): src/db/pool.ts
  branch fix/57-timeouts by Ana (#57): src/db/client.ts
```

- **Change requests**: the platform's list of open change requests, then the files of each one. Your own is left out.
- **Pushed branches** with no change request are compared locally with `origin/<integration>`, so run `git fetch` first. Long-lived branches are skipped.
- **The cache** (`.agent-os/cache/overlap.json`, never committed) keeps the files of each change request by its head commit, which never changes. The list itself is cached for 10 minutes. A repeated run with 30 open change requests asks for nothing.
- **It never blocks.**
  - `agent-os start` checks the paths the issue mentions, before you touch anything.
  - `agent-os pr preflight` checks the files the branch changes.
  - Both name the overlapping work so you can talk to its author (in the issue or the change request) and say so in your description.

## The collaboration rule

agent-os installs `.claude/rules/collaboration.md` (in the `docs` language) for every agent session. It covers:
- **Claiming:** claim before the first edit with `agent-os start`; one change request closes one issue; check overlap.
- **Someone else's issue:** ask in the issue first, use `--force` only after they agree, and never update another person's branch.
- **Comments:** read the whole thread, answer in the comment's language, and quote decisions in the journal.
- **Personal and team state:** what is committed and what never is.
- **CI is the guarantee:** the required checks can't be skipped, and nobody works around them.

## Personal state never enters git

| Committed (team agreement or history) | Never committed (per laptop) |
|---|---|
| `agent-os.json`, `.claude/` rules and skills, `.agent-os/journal/`, `.agent-os/lessons/`, `.agent-os/registry/`, `.agent-os/lock.json`, `.agent-os/base/` | `.agent-os/local.json`, `.agent-os/cache/`, `.claude/settings.local.json`, `.claude/worktrees/`, secrets |

`agent-os doctor` has two checks for this:
- **`gitignore`:** these paths must be ignored; `--fix` adds them to `.gitignore`.
- **`personal`:** git must track none of them.

When `personal` finds a tracked file, it fails and proposes `git rm --cached -r -- <paths>` in a change request. The file stays on the laptop. `--fix` never runs it, because removing files from the index changes the team's tree.

## Handing off: `agent-os handoff`

```bash
agent-os handoff --next 14="answer the review on #150" --summary "stopping for today"
agent-os handoff --dry-run
```

At the end of a session or a day, each issue **assigned to you with work in flight** (a pushed branch named for it, or an open change request) gets one status comment, in the issues language. The comment holds:
- the branch and its last commit;
- the change request and its checks;
- open blockers and unticked test scenarios;
- the next step you give with `--next`.

One `handoff` journal entry lists them all. Issues assigned to someone else never get a comment, and neither do yours that have nothing in flight. The next person continues from the comments alone.

## Comment-driven work: `agent-os thread`

People decide things in comments. Skills read the conversation before acting:

```sh
agent-os thread 34           # an issue (on GitHub a pull request number works too)
agent-os thread !12          # a change request where its numbers are separate (GitLab)
```

It prints:
- the participants, the conversation's language and the number of comments (and open review threads);
- the **decisions** made in comments, quoted verbatim with who made them, when and the link;
- the latest comments.

A decision is a paragraph that says so: `Decision:`, `Decided:`, `Agreed:`, `Decizie:`, "we decided", "am decis", "am hotarat", "mergem pe". Bots' comments and code blocks are ignored.

- **Decisions into the journal:** `agent-os journal add … --thread '#34'` adds a "Decisions from the conversation" section (in ro, "Decizii din discutie"). Each decision is quoted verbatim, with author, date and link. This is how a decision taken in a comment reaches the journal entry of the change request that implements it.
- **Replies in the comment's language:** `agent-os pr reply` (review threads) and `agent-os issue comment` detect the language of the comment being answered (the last one by someone else). A reply in another language is refused (exit 1, nothing posted). A ro reply has its diacritics replaced with ASCII.
- **@mentions only for real people:** a handle that is not among the participants (author, assignees, commenters) loses its `@` and goes in backticks, so a typo or an invented name pings no one. Emails and code are left alone.

## Several sessions on one laptop: the orchestrator

This is optional and off by default. Turn it on for your laptop with `agent-os init --me --orchestrator`, which sets `orchestrator` in `.agent-os/local.json`. One session holds the orchestrator role, and the other sessions are workers, each on one issue in its own worktree.

| Command | What |
|---|---|
| `agent-os orchestrate claim [--force]` | this session becomes the orchestrator; `--force` takes the role from a session that is gone |
| `agent-os orchestrate release` | gives the role back |
| `agent-os orchestrate brief <n>` | a worker for issue `n`, with the brief it starts from: claim with `start --worktree`, the scope, the local checks, how to report |
| `agent-os orchestrate message <TYPE> <worker> [--text] [--pr]` | records `ACK`, `QUESTION`, `UPDATE`, `DONE`, `REVISE` or `CLOSE`, and moves the worker's state |
| `agent-os orchestrate reconcile` | follows the worktrees and change requests: merged → done, closed → closed, worktree gone → gone |
| `agent-os orchestrate status` | the role and the workers; zero workers is a valid state |

- **The orchestrator does not edit.** The `orchestrator-edit` guard refuses Edit, Write, MultiEdit and NotebookEdit from the session whose directory holds the role. Workers run in their own worktrees, so they are never refused. In adoption mode the guard warns instead, like every guard.
- **The ledger is personal**: `.agent-os/cache/orchestrator.json`, ignored by git and never committed. Coordination between people stays on the platform.
- **Messages carry no secrets** (token shapes and `password=`-style values are refused) and **grant no permissions**. A message asking to bypass a guard, a check or a permission, to use `--no-verify` or `--dangerously-…`, or to edit the permission settings is refused. A refused action goes back to the person.

