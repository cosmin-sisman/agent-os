# Language per area: `en` or ASCII `ro`

Status: accepted

## Context
Teams write tickets in one language and code in another, and they want labels or milestones in yet another combination. Diacritics break branch names, searches and some terminals, and they get typed inconsistently.

## Decision
- Exactly two languages: `en` and `ro`. `ro` is Romanian **without diacritics** (ASCII only).
- The language is chosen per area: `issues`, `prs`, `commits`, `branches`, `labels`, `milestones`, `releases`, `codeComments`, `docs`, `journal` (team, in `agent-os.json`) and `chat` (personal, in `.agent-os/local.json`). Any combination is allowed.
- Templates ship in both languages; label and milestone names come from dictionaries keyed by a stable id (`type:bug` → `type:bug` / `tip:bug`), so renaming is an API call that keeps issues attached.
- Replies to an existing comment use that comment's language.
- `doctor` (and the CI loop check) fails on `ă â î ș ț Ă Â Î Ș Ț` (and the cedilla forms) in any `ro` area.

## Consequences
Adding a third language later means adding dictionaries and templates, not changing the engine. Agent-system files (skills, rules) stay in English, the language they are written and tested in; only what agents *produce* follows the areas.
