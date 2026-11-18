---
type: decision
refs: ["#94", "#98", "#11", "#93", "#15"]
areas: [platform, cli]
author: cosmin-sisman
---

# Platform routes and vocabulary

`templates/core/` is installed everywhere. `templates/platform/<type>/` is installed only on its platform. The installer (`src/managed/install.mjs`) renders core plus the active route and hands the files to the managed-files engine. The lock records the platform.

Decisions:
- Vocabulary instead of conditionals: templates say `{{vocab.changeRequest}}` and land at `.claude/skills/__crSkill__/`, so core templates never branch on the platform. The architecture test from #91 keeps it that way.
- On GitLab the change-request skill is `/mr`, and `/pr` is a small alias skill that sends the agent to `/mr`, because Claude Code has no alias mechanism of its own.
- A route may add files but never override a core one; the installer refuses a collision.
- An update for another platform than the lock's is refused and points to #98, so a mixed `.github` + `.gitlab` state cannot happen by accident.
- The real issue and change-request templates now exist for both platforms in en and ASCII ro (GitHub issue forms, GitLab markdown templates with a `/label` quick action), ready for #11 and #93. The change-request skill body is a short interim procedure until #15.
