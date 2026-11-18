# Retrofit: bringing history into the system

For an existing repository whose team wants its issues, change requests and releases to follow the conventions. Design §12; decision: [init and adoption](../decisions/2026-11-18-init-profiles-and-retrofit.md).

```sh
agent-os retrofit plan [--dry-run]        # writes .agent-os/retrofit/plan.json and prints it
agent-os retrofit apply [--delay <ms>] [--dry-run]
```

## The plan

`plan` reads the platform and git, changes nothing, and writes a reviewable plan. Commit the plan with the review if the team wants a record. It has these steps:

| Step | What it does |
|---|---|
| `labels` | creates the convention labels the project lacks (through `agent-os setup --only labels`, which never replaces a label) |
| `label-map` | issues with a label the project already uses (`bug`, `enhancement`, `documentation`, `chore`, `dependencies`, …) also get the convention label (`type:bug`, `type:feature`, …). The old label stays |
| `milestone` | a release tag (`v1.2.0` or `1.2.0`) with no milestone gets a closed milestone of that name |
| `issue-link` | a merged change request that refers to an issue (`Closes #N`, `Refs #N`, a `[#N]` suffix) gets a comment on that issue recording the link |
| `pr-title` | an **open** change request whose title breaks the conventions gets the fixed title. When the conventions cannot fix it (an unknown type), the step is left for the author and apply skips it |
| `pr-body` | an **open** change request whose description lacks How it was tested or Lessons gets those sections, to fill in |
| `journal` | one baseline entry: counts of change requests (merged, closed, open), issues, contributors and dates, plus the merged change requests by number and title |

**Closed change requests are never rewritten.** No step edits one, and apply checks again that a change request is still open before touching it. What closed change requests hold goes into the baseline journal entry instead.

## Apply

`apply` executes the reviewed plan:
- **Idempotent.** Each step first checks the platform's current state and does nothing when it is already done: the label is there, the comment with the marker exists, the title is the new one, the sections are there, the journal entry exists. **Applying twice changes nothing the second time.**
- **Rate-limited.** Writes are spaced by `--delay` milliseconds (250 by default).
- **Marked.** Comments, change request descriptions and milestone descriptions it writes carry `<!-- agent-os:retrofit -->`.
- **Dry run.** `--dry-run` lists what it would do and writes nothing.
