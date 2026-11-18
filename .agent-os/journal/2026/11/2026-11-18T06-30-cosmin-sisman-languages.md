---
type: decision
refs: ["#7"]
areas: [i18n]
author: cosmin-sisman
---

# The language engine

Areas come straight from the configuration schema, so the schema stays the only list. `languageFor(config, area)` is what templates and skills call. Core labels and milestones live in YAML dictionaries keyed by stable ids (`src/i18n/*.yaml`, read with the package's YAML parser). Ids never change, so a language switch is a rename, not a new label.

Decision: the ASCII rule targets Romanian diacritics specifically (comma-below and cedilla forms, upper case, decomposed), not all non-ASCII. Emoji, such as the attribution footer, and other languages' letters are legitimate in ro text, while a blanket ASCII rule would reject them for no benefit.

The language rule for agents is rendered from the configuration (`agent-os lang rule`). Installing it as `.claude/rules/language.md` comes with the template engine (#5) and `init`.
