---
type: decision
refs: ["#13", "#91", "#44"]
areas: [skills, github]
author: cosmin-sisman
---

# /ticket and issue new: complete issues, duplicates first

`agent-os issue new` validates before it sends anything: the title form, exactly one type and one priority, at least one area, a milestone, a test-scenarios section in the issues language, and ASCII in ro. It then searches for duplicates and stops when a request looks like an existing one, offering `--extend` or `--force-new`. Only after that does it create the issue and its relationships.

Decisions:
- Relationships go through the capability plans from #91, so the same command gives GitHub's dependencies API and sub-issues, and the documented fallbacks on a platform without them. The tracker gained `comment`, `appendToBody` and `search` for that.
- Labels are accepted as stable ids and translated, so skills can always say `type:bug` whatever the labels language.
- The test scenarios are required in the body now. When /test (#44) exists, /ticket's skill will call `test plan` to write them; for now the skill tells the agent how to write them.
- Read-only check on this repository: `issue similar` for a /ticket-like title finds #13 itself at score 1.
