# Init

## Repository state: `init --detect`

```bash
agent-os init --detect          # read only: signals and the suggested profile
agent-os init --detect --json
```

It reads, offline with git:
- the number of commits, and how many in the last 90 days;
- the date of the last commit, and the tags;
- code files and documents (`docs/`, `specs/`, design notes; README-like files don't count);
- CI configuration, and existing agent files (`CLAUDE.md`, `AGENTS.md`, `.claude/`, Cursor and Copilot instructions).

When the platform answers, it also counts the open change requests.

| Profile | Suggested when |
|---|---|
| `greenfield` | fewer than 5 commits, no code |
| `spec-first` | at least 3 documents and fewer than 5 code files |
| `maintenance` | tags and no commit for 180 days or more (high confidence), or tags and fewer than 10 commits in 90 days |
| `active` | 10 or more commits in 90 days, or open change requests (the fallback, at low confidence, otherwise) |

Every suggestion comes with a confidence (high, medium, low) and a one-line reason, for example `active (medium): 50 commit(s) in 90 days: in active development`. Init asks you to confirm it.
