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

`doctor` fails when a folder in `.claude/skills/` has no entry, when an entry (other than plugin or builtin) has no folder, and when an entry is invalid. Adding, updating and removing vendored skills is #39.
