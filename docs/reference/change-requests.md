# Change requests: gate and `/pr`

A change request opens only when it is ready. The `/pr` skill (`/mr` on GitLab) runs the steps, and the CLI enforces them.

## The gate

```json
{
  "gate": { "unit": "npm test", "docs": "npm run docs:check", "db": "npm run db:test" },
  "gatePaths": { "src/**": ["unit"], "docs/**": ["docs"], "**/*.md": ["docs"], "db/**": ["db", "unit"] }
}
```

```bash
agent-os gate                 # the suites the branch's changes need, against origin/<branches.integration>
agent-os gate --dry-run       # which suites would run, and why
agent-os gate --all           # every suite
agent-os gate --suite unit    # only this one
agent-os gate --base main     # against another branch
```

- Changed files are the branch's commits plus staged, unstaged and untracked changes.
- A file matching several globs adds all their suites, and suites run in the order `gate` defines them. Without `gatePaths`, every suite runs. Files no glob covers are listed as a warning.
- Every selected suite runs, even after one fails, so the results table is complete. A failure exits with 1 and shows the last lines of its output.
- The result is saved to `.agent-os/cache/gate.json` (never committed) with the commit it ran on and whether the tree was clean.

### In CI: `gate --from-ci`

agent-os installs `.github/workflows/agent-os-gate.yml` (GitHub) or `.gitlab/agent-os-gate.yml` (GitLab; include it from `.gitlab-ci.yml`). Both run `agent-os gate --from-ci` with the pinned version:

- **On a change request:** the base branch is read from the event (the GitHub event file, or GitLab's merge request variables), and the same selection as locally runs. The same diff gives the same suites on a laptop and in CI.
- **On a push** to the integration or production branch: every suite runs.
- **Job summary:** on GitHub the results table is added to the job summary.
- **Dependencies:** the job installs them with `npm ci` when there is a `package-lock.json`. Remove that step if your suites need none.

Making `agent-os/gate` a required check is a ruleset setting (`agent-os setup`).

## `pr`

```bash
agent-os pr preflight --title "<title>" --body-file body.md    # what is missing, exit 1 if anything
agent-os pr create --title "<title>" --body-file body.md [--draft] [--dry-run]
agent-os pr status [<n>] [--watch]                             # checks and review; exit 1 on a failure or requested changes
agent-os pr threads [<n>] [--all]                              # open review threads with their comments
agent-os pr reply <thread-id> --body-file reply.md [--resolve] [--dry-run]
```

`create` opens nothing until all of these hold:

| Check | Rule |
|---|---|
| Branch | an issue branch, not the integration or production branch |
| Title | `agent-os check title` passes (type, scope, lower case, no final period, `[#N]` matching the body, length) |
| Body | non-empty **Lessons** (`None: <why>` at least), **How it was tested**, and `Closes #N` or `Refs #N`; in `ro` the headings are `Lectii` and `Cum a fost testat`, and the text is ASCII |
| Journal | the branch adds an entry under `.agent-os/journal/` |
| Gate | it passed on exactly the current commit, with a clean tree |

Then it pushes the branch, opens the change request into `branches.integration`, copies the issue's `type:*` and `area:*` labels, and comments on each referenced issue, in the `issues` language. Without a number, `status` and `threads` use the open change request of the current branch.

## `ship`

```bash
agent-os ship [<n>] --dry-run      # what would be merged, closed, commented and deleted
agent-os ship [<n>]                # without a number: the open change request of the current branch
agent-os ship <n> --no-notify      # do not comment to the author when it is behind or conflicting
agent-os ship <n> --keep-branch    # keep the branch and its worktree
```

It merges only when all of these hold. Otherwise it exits with 1 and lists what is missing:

- it is open, not a draft, and targets `branches.integration` or `branches.production`;
- every check on its last commit passed, including each of `branches.requiredChecks`;
- no changes are requested, and it has `branches.requiredApprovals` approvals;
- it is neither behind its base nor conflicting. If it is, `ship` comments to the author and stops;
- every `- [ ]` item under **Before merge** (`Inainte de merge` in ro) is checked.

The merge uses `branches.mergeMethod` (`squash` by default) and is pinned to the checked head commit, so a push after the check can't slip in. After the merge:

| In the body | What `ship` does |
|---|---|
| `Closes #N` (Fixes, Resolves) | closes it if it is still open, comments in the `issues` language, sets it to Done on the board |
| `Refs #N` (Part of) | comments that the change is merged and the issue stays open; reopens it if it was closed by the merge |

Then it deletes the branch on the remote (never a fork's, never a long-lived branch), removes its worktree, switches away if you are on it, and deletes the local branch.
