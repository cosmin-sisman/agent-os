# Skill registry and capability slots

Status: accepted

## Context
Projects mix agent-os's own workflow skills with third-party skills (a UI design skill, a review skill) and skills they write themselves. Without a record of where each came from, nobody knows what can be updated, removed or safely edited. Hard-coding a third-party skill's name inside a core workflow makes it impossible to swap.

## Decision
- One registry file per skill: `.agent-os/registry/<name>.json` with `origin` (`core` · `external` · `local` · `plugin` · `builtin`), `source` (pinned), `version`, `license`, `provides` (slots) and `managed`.
- `agent-os skill add|remove|update|list|new` manages them; external skills are vendored at a pinned commit and never edited in place.
- Core skills call **slots** (`review`, `security-review`, `ui-design`, `testing`, `ci`, `docs`), bound to skills in `agent-os.json`.
- Indexes (core / external / local) are rendered on demand and at SessionStart, never committed.
- `doctor` fails when the registry and `.claude/skills/` disagree.

## Consequences
Adding or removing an external skill is one command and one or two small files, so parallel additions never conflict. Core can evolve without knowing which design or review skill a project prefers.
