---
type: decision
refs: ["#71", "#24"]
areas: [upstream]
author: cosmin-sisman
---

# /upstream: a whitelist draft, filtered search, approval before sending

`agent-os upstream draft` and the /upstream skill.

Decisions:
- The draft is built from a whitelist (version, profile, skill or command, configuration key names, OS and Node), and the free text is filtered: code, paths, links, emails, mentions, secrets, and the project's own terms (name, owner, folder, host). The output says what was removed. This covers the issue's scenario (a lesson with a private path) and the acceptance criterion.
- The duplicate search sends only words from the filtered title (orchestrator's condition), and a test checks the query for private terms. A similar issue gets a reaction or a comment instead of a twin, and filing a twin needs `--new`.
- Nothing is sent without `--file --approve`, and `upstream.enabled: false` saves the draft locally.
- doctor's `commands` check now reads only code (fences and backticks), not prose or quoted placeholders. The /upstream skill's prose ("agent-os should…") surfaced the false positive.
- Dry run only on this repository: a draft from the inbox lesson about piping a check. Its inline code was removed and no similar upstream issue was found. Nothing was filed.
