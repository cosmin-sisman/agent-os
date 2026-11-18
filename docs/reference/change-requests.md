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

Generating the CI workflow from the same definition comes with #43.

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
