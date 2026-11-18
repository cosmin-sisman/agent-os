---
name: handoff
description: End a session or a day so someone else (or you tomorrow) can continue - a status comment on each issue you hold with work in flight and one handoff journal entry. Use when someone says they are stopping, handing over, or going away.
---

# /handoff: leave it ready to continue

## 1. Push what you have

Commit and push work in progress on its branch (a `wip:` commit is fine on an issue branch). Work only on your laptop is invisible to the next person.

## 2. Next steps, per issue

For each issue you hold, write one line on what comes next: what to do, what you were about to try, what is waiting on whom.

## 3. Hand off

```
agent-os handoff --next 14="answer the review on #150" --next 22="rerun the gate after #9 lands" --summary "<one line>"
agent-os handoff --dry-run      # see the comments first
```

Each issue assigned to you with a pushed branch or an open pull request gets one comment in **en**. The comment gives the branch, the last commit, the pull request and its checks, the open blockers, the unticked scenarios and your next step. Issues held by others never get one. A `handoff` journal entry lists them all.

## 4. Learn

If picking up someone's work was hard, say what was missing: it is a lesson for this skill.
