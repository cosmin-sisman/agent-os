---
type: decision
refs: ["#102", "#101", "#23"]
areas: [standards]
author: cosmin-sisman
---

# /standards: the decision procedure made checkable

The /standards skill and `agent-os standards choice`.

Decisions:
- The procedure for choosing between solutions (two or three candidates, criteria, one pick, a reason in one sentence) is a command as well as skill text. A choice with one option, a pick outside the options, or a multi-sentence reason is refused. The output states that only the chosen one is implemented, which is the acceptance criterion in the place reviewers read.
- Hard-to-reverse choices go to an accepted decision record with the comparison as its Decision section (`--record`), reusing #23.
- /pr runs /standards review before code review unless the `standards` slot binds another skill.
- The issue's scenario (two caching approaches) is a test of the procedure's output. The skill text itself is checked for the procedure's key lines.
