# The self-improvement loop has no exceptions

Status: accepted

## Context
A system of rules and skills falls behind the project it serves unless updating it is part of the work itself. In the reference workflow the loop existed, but it ran on reminders and at release time, so lessons sometimes stayed in chat.

## Decision
- **Capture**: the last step of every core skill is *Learn*. It writes a lesson to the inbox or states "no lesson" with a reason. The PR template's `## Lessons` section is required.
- **Triage**: `/retro` at every release, and a scheduled workflow that opens or updates a Retro issue whenever the inbox is not empty. Repeated review findings across PRs are proposed as lessons automatically.
- **Apply**: each accepted lesson becomes one rule line with its reason, in the rule file that owns the topic, through a normal PR.
- **Verify**: `doctor` runs on every PR as the required check `agent-os/loop` and fails on a missing journal entry or Lessons section, registry drift, broken links or commands, exceeded context budgets, and diacritics in `ro` areas.
- There is no skip flag. The only way to merge without a lesson is to say explicitly that there is none, and why. Automated dependency PRs are the single case without a hand-written entry: the release writes one entry that covers them.

## Consequences
Every PR costs a few lines of reflection. In exchange the rules always match the project, and the cost is visible and auditable in the journal.
