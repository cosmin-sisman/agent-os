---
type: decision
refs: ["#51", "#49", "#27", "#50"]
areas: [init, loop]
author: cosmin-sisman
---

# Forward-only adoption: cutoff, baseline entry, history reported not failed

Forward-only adoption, chosen at init for any repository with history.

Decisions:
- Init records `adoption.cutoff` (today) and a baseline `note` entry with a snapshot of the repository: commits, tags, code, documents, CI, agent files and open change requests.
- doctor already ignored journal entries and issues older than the cutoff. It now also downgrades `links`, `budgets` and `language` failures on files agent-os does not manage to warnings marked pre-existing. Without this, a legacy repository would fail doctor right after init because of an old README link; this meets the acceptance criterion. Failures in managed files, `.agent-os/` or `.claude/` stay failures, and so do risks such as tracked personal files.
- Retrofit is refused with a pointer to #50 rather than half-done.
- Tested on a fixture legacy repository: 2024 history, a tag, and a broken README link. Old issues without milestones are not reported (the issue's scenario), a new one is, and doctor has 0 FAIL.
