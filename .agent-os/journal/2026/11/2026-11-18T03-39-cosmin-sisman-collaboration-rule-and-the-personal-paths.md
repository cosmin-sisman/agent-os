---
type: decision
refs: ["#32", "#27"]
areas: [collab, loop]
author: cosmin-sisman
---

# Collaboration rule and the personal-paths check

A core rule `.claude/rules/collaboration.md` (en and ro, in the docs language) and a doctor check, `personal`.

Decisions:
- The rule states only what an agent cannot infer:
  - claim before the first edit; one change request per issue; check overlap;
  - ask before taking someone else's issue, and never update another person's branch;
  - answer in the comment's language, and quote decisions in the journal;
  - which paths are team state and which are personal;
  - CI is the guarantee.
- `personal` fails when git tracks a personal path, which covers the issue's scenario. It proposes `git rm --cached` in a change request but never runs it, even with `--fix`: removing files from the index changes the team's tree (the orchestrator confirmed this).
- `.claude/settings.local.json` and `.claude/worktrees/` are personal too. `.gitignore` handling for them comes with full init (#49); for now doctor fails if they are tracked.
