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

## Setting up: `init`

```bash
agent-os init                                   # asks, shows the plan, writes after a yes
agent-os init --dry-run                         # the whole plan; nothing written
agent-os init --yes --lang en --chat ro --team  # no questions (flags and defaults)
agent-os init --yes --platform gitlab --project team/app --host https://gitlab.example.com --area-lang issues=ro --solo
agent-os init --setup                           # also apply the platform setup (asks first unless --yes)
agent-os init --me                              # only your personal settings, for a teammate joining
```

The questions, in this order. Each one has a flag, so `--yes` with flags never asks:

1. **Chat language**, personal (`--chat`). It goes to `.agent-os/local.json`, never to the team file.
2. **Profile**, confirmed from `init --detect` (`--profile`).
3. **Platform and project**, detected from the `origin` remote (`--platform`, `--project`, `--host`).
4. **Language of the team areas** (`--lang`), and any single area in the other language (`--area-lang issues=ro`).
5. **Integration branch** (`--integration`, default `development`) and production branch (`--production`, default `main`).
6. **Solo or team** (`--solo`, `--team`). A team requires one approval on change requests.

**What it writes:**
- `agent-os.json`, with:
  - the pinned version, platform, branches and languages;
  - gate suites suggested from the `package.json` scripts (`test`, `lint`, `typecheck`, `build`);
  - adoption mode for 14 days (guards warn instead of refusing).
- `.agent-os/local.json` (personal).
- `.gitignore` lines for the personal paths.
- The managed files: skills, rules, templates, the loop and gate workflows, hooks.
- Managed blocks in `AGENTS.md` and `CLAUDE.md` (`@AGENTS.md`). Text the team already has in those files stays byte for byte.

A file that already exists and differs is left alone, and agent-os's version goes next to it as `.rej`. Init then runs `doctor`, which reports 0 FAIL on a fresh setup.

**The platform** (default branch, protection, labels, milestone) is shown as a plan and applied only with `--setup`, because it changes settings other people rely on. Otherwise run `agent-os setup --dry-run`, then `agent-os setup`.
