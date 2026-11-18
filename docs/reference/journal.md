# Journal

The project's history of decisions, lessons, incidents, releases and handoffs: one Markdown file per entry, committed with the work it describes. Design §10, decision [journal, not a memory file](../decisions/2026-11-18-journal-not-memory-file.md).

## Where and how it is named

```
.agent-os/journal/2026/11/2026-11-18T14-02-ana-use-one-file-per-entry.md
                  YYYY/MM/<YYYY-MM-DDTHH-MM>-<author>-<slug>.md
```

- The time is UTC, to the minute, so every laptop names the same moment the same way.
- The author is the platform login. Two people never write the same file; the same person writing two entries with the same title in the same minute gets `-2`, `-3`.
- So two branches adding entries never conflict, whichever merges first.

## Format

```markdown
---
type: decision
refs: ["#22", "!40", "2026-11-18-journal-not-memory-file"]
areas: [knowledge, ci]
author: ana
---

# One file per entry

Why, what was decided, what was left out.
```

| Key | Rule |
|---|---|
| `type` | one of `decision`, `lesson`, `incident`, `release`, `handoff`, `note` |
| `refs` | a list (can be empty) of `#N` (issue or GitHub PR), `!N` (GitLab merge request), `&N` (GitLab epic) or a decision id `YYYY-MM-DD-slug` |
| `areas` | a list of one or more lowercase kebab-case areas |
| `author` | a login; the file name carries it after the time |

The body needs a `# Title` line. It is written in the `journal` language (`agent-os config set languages.journal ro`); in `ro` it must be ASCII.

## Commands

```bash
agent-os journal add --type decision --title "One file per entry" --area knowledge --ref "#22" --body-file why.md
agent-os journal add … --dry-run           # the file name and content, nothing written
agent-os journal list                      # oldest first; filters: --type --area --ref --author --since --until
agent-os journal list --ref "#22" --json
agent-os journal show <id or part of it>
agent-os journal check                     # every entry against the schema; exit 1 with file and problem
```

`add` takes the author from your platform login (`--author` to set it). Lists are rendered from the files every time: nothing generated is committed. `doctor` (#27) runs `journal check`; until then this repository runs it in `npm test`.

## The chronicle: `agent-os chronicle`

```bash
agent-os chronicle --since 2026-11-01              # everything since that date
agent-os chronicle --since 2026-11-01 --issue 28    # one issue's story, with the change requests that close or reference it
agent-os chronicle --since 2026-11-01 --area ci
```

One timeline combines the platform and the journal:
- issues and change requests opened, closed and merged;
- comments and reviews;
- milestones and releases;
- the journal entries.

Every line links its source. `--issue` follows the conversation: an issue's comments, plus each change request whose description says `Closes #N` or `Refs #N`, plus the journal entries that reference any of them. So a decision made in a comment shows up next to the change request that implemented it.

The render goes to `.agent-os/cache/chronicle.md` and `.json` and is never committed. On GitLab the project events API supplies the same events.
