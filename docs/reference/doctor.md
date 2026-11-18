# doctor

`agent-os doctor` checks the agent system, the repository and the platform hygiene. Every finding says what is wrong and what fixes it, and the report ends with a readiness score. The `/doctor` skill runs it for people.

```bash
agent-os doctor                 # every check, including the platform
agent-os doctor --offline       # local checks only, no network
agent-os doctor --ci            # what CI runs: local, deterministic
agent-os doctor --fix           # apply the mechanical fixes, then check again
agent-os doctor --check skills --check links
agent-os doctor --json
```

It exits with 1 when any check fails and 0 otherwise. Warnings don't fail.

## Checks

| Check | Fails or warns when |
|---|---|
| `skills` | a folder in `.claude/skills/` has no registry entry in `.agent-os/registry/<name>.json` and is not managed by agent-os; an entry (other than `plugin` or `builtin`) has no folder; a `SKILL.md` lacks `name` and `description`, or its name differs from its folder |
| `slots` | a slot is bound to a skill that is neither on disk nor registered (warn) |
| `commands` | a skill, rule or `AGENTS.md` calls `agent-os <command>` that does not exist (fail), or that is still planned (warn) |
| `hooks` | `.claude/settings.json` is invalid, or an agent-os hook does not run the pinned version |
| `links` | a relative link in `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `README.md`, `.claude/` or `docs/` points at a missing file |
| `area-map` | `AGENTS.md` is missing, or its area table does not mention a top-level directory (warn) |
| `budgets` | a file is over its size budget (fail) or above 80% of it (warn). Defaults are `AGENTS.md` and `CLAUDE.md` at 8 KB and `.claude/rules/*.md` at 6 KB; `contextBudgets` adds to or overrides them |
| `language` | a file of an area set to `ro` contains diacritics (PR and issue templates, `docs/`); fixable |
| `journal` | an entry does not follow the schema ([journal](journal.md)) |
| `conflicts` | an update left a `.rej` file |
| `version` | no version is pinned, or what runs differs from the pin (warn) |
| `gitignore` | `.gitignore` does not keep `.agent-os/local.json` and `.agent-os/cache/` out; fixable |
| `issues` | platform: an open issue lacks a type, a priority or a milestone, or has the `blocked` label with no open blocker (warn) |
| `labels` | platform: a convention label is missing (warn; `agent-os setup --only labels` creates them) |
| `titles` | platform: one of your open change requests has a title that breaks the convention (warn) |

A check that cannot run (for example, the platform login expired) becomes a warning that says why. It never crashes the report.

## Forward-only

`adoption.cutoff` (`YYYY-MM-DD`) makes doctor ignore journal entries and issues older than that date, so a project adopting agent-os is not failed for its history.

## Readiness score

Each check that ran counts 1 when it passes, ½ when it only warns and 0 when it fails. The score is the average, out of 100. Skipped platform checks don't count.

## Where it runs

- `agent-os update` runs `doctor --ci` in its preflight and stops on any failure.
- The CI loop check ([`agent-os/loop`](loop.md)) runs `doctor --ci` on every change request.
