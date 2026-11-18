# Skills and the registry

Every skill has an entry in `.agent-os/registry/<name>.json`, one file per skill, so two people adding two skills never touch the same file. Design §6, decision [skill registry and slots](../decisions/2026-11-18-skill-registry-and-slots.md).

```json
{ "name": "impeccable", "origin": "external", "source": "github:pbakaus/impeccable@4f2a9c1", "version": "4.5.0",
  "license": "Apache-2.0", "provides": ["ui-design"], "managed": false, "description": "UI design review." }
```

| Key | Rule |
|---|---|
| `name` | lowercase kebab-case; the file is `<name>.json` |
| `origin` | `core` (installed by agent-os), `external` (vendored), `local` (the project's own), or `plugin` / `builtin` (live outside the repository) |
| `source` | for `external`, required and pinned: `<host>:<owner>/<repo>@<commit or tag>` |
| `version`, `license`, `description` | strings |
| `provides` | the capability slots it can fill (`review`, `ui-design`, `testing`, …) |
| `managed` | `true` for core skills, which agent-os updates |

Core skills get their entries from `agent-os update` and `init`. For the rest:

```bash
agent-os skill register deploy --origin local
agent-os skill register impeccable --origin external --source github:pbakaus/impeccable@4f2a9c1 --license Apache-2.0 --provides ui-design
agent-os skill register code-review --origin builtin --provides review     # no folder: it lives in Claude Code
agent-os skill check
```

`doctor` fails when a folder in `.claude/skills/` has no entry, when an entry (other than plugin or builtin) has no folder, and when an entry is invalid.

## Vendored skills: `agent-os skill add|update|remove|new`

A third-party skill is copied into the project at a pinned commit, never run:

```sh
agent-os skill add github:owner/repo/path/to/skill@v1.2.0 [--provides review] [--license MIT]
agent-os skill add ./some/folder          # a local folder, copied the same way
```

- `add` resolves the ref to a commit, copies the files under the path into `.claude/skills/<name>/` as plain data (no install scripts, no postinstall, nothing executable, symlinks skipped), registers it with `origin: external` and the source pinned to the commit, and records the commit, the ref it came from, the folder and a sha256 per file under `vendored` in `.agent-os/lock.json`. The license comes from a LICENSE file unless `--license` names it.
- `update <name> [--ref <ref>] [--yes]` fetches the ref again (the one it was added from by default) and shows the diff between the two commits, file by file. The files are replaced only after you confirm, or with `--yes`; without either nothing is written and the command exits 1. A skill vendored from a local folder updates with `--from <folder>`.
- Vendored files are never edited in place: `update` refuses when a file no longer matches its hash in the lock. Put changes in a local skill instead.
- `remove <name>` deletes only the folder the lock records for that skill, its registry entry and lock record, and sets every slot bound to it in `agent-os.json` back to `null`. `--dry-run` lists the steps. Core skills are not removed this way (`agent-os eject`).
- `new <name> [--description <d>]` scaffolds `.claude/skills/<name>/SKILL.md` with a Learn step, and its local registry entry.

## The index: `agent-os skills`

```bash
agent-os skills          # three tables: Core, External (with plugin and builtin), Local
agent-os skills --json
```

It is rendered every time from the registry and `.claude/skills/`, with each skill's first sentence from its front matter, and it is never committed. Adding a skill needs no edit to `AGENTS.md` or any other index. A new folder shows up under Local at once, marked *unregistered* until `agent-os skill register` records it. The SessionStart context carries one line from it: `Skills: core /next /start …; external …; local …`.

## Capability slots

Core skills never name another skill: they call a **slot**, and `agent-os.json` binds it.

| Slot | Default | Used by |
|---|---|---|
| `review` | `code-review` (Claude Code built-in) | /pr before opening |
| `security-review` | `security-review` (built-in) | /pr, /audit |
| `standards` | none (/standards itself) | /pr, /standards |
| `testing` | none | /test |
| `ui-design` | none | /pr, when the diff touches the user interface |
| `ci` | none | /ci |
| `docs` | none | documentation skills |

```bash
agent-os config set slots.ui-design impeccable      # swapping a design skill is this one line
agent-os config set slots.docs null                 # explicitly none
```

- **init** writes every slot, bound or `null`, so the choice is visible.
- **Built-ins:** the ones bound by default are registered as `builtin` by the install, so doctor and `agent-os skills` know them.
- **doctor** warns about a slot that is neither bound nor explicitly empty, and about a bound skill that is neither on disk nor registered.
- **Unbound means skipped, not stopped:** with `ui-design` unbound, `/pr` on a change that touches the UI warns and continues, and the description says the UI was reviewed by hand.
