---
type: decision
refs: ["#24", "#29", "#14", "#15"]
areas: [knowledge, loop]
author: cosmin-sisman
---

# Lessons: inbox, active, retired; recall by path, area and keyword

`agent-os lessons add|recall|search|review|accept|promote|retire|check`, the /lessons skill, recall in /start and /pr, a doctor check and the Learn contract.

Decisions:
- Captures go to the inbox, one file per capture (`<UTC minute>-<author>-<slug>`), so they never conflict. Accepting moves a card to `active/<slug>.md`, and promote/retire record where it went.
- Recall scores path globs above areas above keywords, weighed by confidence, and returns at most 3 cards within about 400 tokens. Paths come from the files changed in /pr and from paths written in the issue in /start, so a lesson shows up before the first file is touched. That covers the issue's scenario.
- Recall is read-only. The counters have one writer, /retro (#29), and a test checks that recall leaves the card untouched.
- Validation is shared by `lessons check` and doctor. doctor also warns when ten or more cards wait in the inbox.
- The Learn contract is a test: every core skill template must have a Learn step. start, next and ship gained one.
- Tests that need an example of a planned command now pick one from the registry, so they stop breaking each time a command ships.
- This repository's 9 cards validate. One active card had an unquoted `422` keyword (a number in YAML), which is the yaml-hex-colors lesson again; it is now quoted.
- AGENTS.md is close to its budget, so the area is documented in docs/reference/lessons.md instead.
