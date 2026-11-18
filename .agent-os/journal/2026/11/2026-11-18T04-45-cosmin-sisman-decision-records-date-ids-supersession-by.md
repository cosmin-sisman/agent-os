---
type: decision
refs: ["#23", "#27"]
areas: [knowledge]
author: cosmin-sisman
---

# Decision records: date ids, supersession by a new record

`agent-os decision new|list|check` and a doctor `decisions` check.

Decisions:
- An id is the date plus a slug (`2026-11-20-cache-ttl`). Different slugs never collide; the same slug on the same day is refused with a hint. That covers the acceptance criterion.
- Superseding creates a new record. The old record's only edit is its status line, which points at the successor ("superseded by [title](file)"). The rest of an accepted record is never rewritten.
- doctor fails when a superseded record has no link to its successor, or links a record that doesn't exist. This is the issue's scenario. It also checks the name form, the title, the status and the three sections.
- The template follows the docs language (`ro` headings and statuses, in ASCII).
- `decision list` renders the index on demand. The hand-written table in docs/decisions/README.md stays for now as an overview, but it is not the source of truth.
- All 20 records in this repository validate.
