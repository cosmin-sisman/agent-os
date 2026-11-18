---
type: decision
refs: ["#93", "#11", "#159", "#160"]
areas: [platform]
author: cosmin-sisman
---

# GitLab setup: protected branches and merge checks for the ruleset

`agent-os setup` on GitLab, through `glab api`.

Decisions:
- GitLab has no rulesets. Their counterpart is protected branches plus two project merge checks (pipelines must succeed, all threads resolved), plus approval rules on Premium. "Pipelines must succeed" is what makes `agent-os/loop` and the CI gate required on GitLab.
- The same rule as #159 and #160 applies: existing protection, label colors, descriptions someone wrote, and milestone descriptions are kept. Differences are reported as "keep … as it is", and only missing pieces are added.
- Labels are scoped (`type::bug`). Existing unscoped or other-language labels are renamed in place, so they stay on their issues. This is the issue's scenario (`tip::bug` in ro).
- A second run plans nothing: tested against an in-memory GitLab project (`__fixtures__/fake-gitlab-project.mjs`). Nothing was sent to any GitLab instance.
