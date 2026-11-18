# Lessons learned

Advice that should change what someone does next time, kept apart from the [journal](journal.md) because it has a lifecycle. Design §10, decision [lessons learned](../decisions/2026-11-18-lessons-learned-store.md). Code: `src/lessons/`.

```
.agent-os/lessons/
  inbox/<YYYY-MM-DDTHH-MM>-<author>-<slug>.md   # captured, not yet triaged (one file per capture: no conflicts)
  active/<slug>.md                              # accepted; recall returns these
  retired/<slug>.md                             # absorbed into a rule, or no longer true; kept for history
```

## A card

```markdown
---
areas: [db]
paths: ["src/db/**", "migrations/**"]
keywords: [migration, rollback]
source: "#12, failed deploy on staging"
confidence: high
recalled: 0
followed: 0
promotedTo: ".claude/rules/db.md"
---

Write a down migration for every up migration. A failed deploy needs a way back. Example: 0004_add_index has 0004_add_index.down.
```

| Key | Rule |
|---|---|
| `areas` | one or more, lowercase kebab-case; matched against the issue's `area:*` labels |
| `paths` | globs of the files where the lesson applies |
| `keywords` | words that recall it from an issue's or change request's text |
| `source` | required: the issue, PR, review comment or incident it came from |
| `confidence` | `low`, `likely`, `medium` (default) or `high`; weighs the ranking |
| `recalled`, `followed` | counters, written only by `/retro` (#29), never on recall |
| `promotedTo` | the rule or file the lesson became |

A card needs `paths` or `keywords`. The body gives the lesson in its first sentence, then the reason and an example. `agent-os lessons check` and `doctor` validate every card.

## Commands

```bash
agent-os lessons add "<lesson>. <why>. <example>." --area db --path "src/db/**" --keyword migration --source "#12"
agent-os lessons recall --issue 42          # its areas, the paths and words it mentions
agent-os lessons recall --changed           # the files changed on this branch
agent-os lessons recall --path src/db/x.ts --area db --limit 3
agent-os lessons search rollback [--all]
agent-os lessons review                     # the inbox, with what to fix before accepting
agent-os lessons accept <id> --as <slug>    # inbox → active
agent-os lessons promote <id> --to ".claude/rules/db.md"
agent-os lessons retire <id> --reason "the linter enforces it now"
agent-os lessons check
```

## Recall

Only active cards are recalled. Each one scores:
- 4 per matching path glob (at most 2);
- 3 per matching area (at most 2);
- 2 per matching keyword (at most 3).

The total is multiplied by the confidence weight (low 0.6, likely and medium 0.8, high 1). Cards with no match are left out. The best ones come first, ties broken by id. Recall returns at most `--limit` (3) cards within a budget of about 400 tokens. The first card always fits.

It runs on its own:
- `agent-os start <n>` lists the lessons for the issue: its area labels, the paths written in its title and body, and its words.
- `agent-os pr preflight` lists the lessons for the files the branch changes and for the description.

The skill says which lessons it follows. Recall never writes, so it never conflicts.

## The Learn contract

Every core skill ends its procedure with a **Learn** step: when something went wrong, was refused or took long, capture it with `agent-os lessons add`. A test checks that every core skill has one. A lesson that keeps coming back is a rule to propose (`promote`), not a lesson to repeat.
