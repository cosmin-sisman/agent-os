---
type: decision
refs: ["#22", "#27", "#25"]
areas: [knowledge]
author: cosmin-sisman
---

# Journal: one file per entry, add, list, show, check

`agent-os journal` writes, lists, shows and validates entries under `.agent-os/journal/YYYY/MM/`. This entry was written with it.

Decisions:
- File names use the UTC minute plus the author login plus a slug, and a numeric suffix for the rare same-author, same-minute, same-title case. Two branches can never add the same file, so the journal never conflicts. A test merges two branches' journals in both orders and checks that no file collides and that the list sorts by time.
- Earlier entries in this repository used local times. They are left as they are: their names are valid and rewriting history would only churn.
- Validation is `journal check` (exit 1 with file and problem). `doctor` (#27) will call it; until then, `npm test` checks this repository's own journal.
- The body follows the journal language; a ro journal must be ASCII, with the line number in the file.
- Chronicle (#25) stays separate: it will read entries through `readJournal`.
