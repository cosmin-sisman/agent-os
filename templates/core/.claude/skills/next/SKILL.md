---
name: next
description: Recommend what to work on next from the repository's live state (your {{vocab.changeRequests}} that need you, reviews requested from you, your issues, free issues in the current milestone), each with a one-line reason, then offer /start. Use when someone asks what to do next, where to start, or what is most important now.
---

# /next: what to work on

Answer from the repository, never from memory or from an earlier answer in this conversation: the state changes.

## 1. Ask the CLI

```
agent-os next --json
```

The order is fixed and deterministic:
1. Your {{vocab.changeRequests}} with requested changes or failing checks.
2. Reviews requested from you.
3. Your issues in progress (a branch exists).
4. Your other issues, by milestone, priority, then how many issues they unblock.
5. Unassigned issues in the current milestone, by priority, with a bonus for the areas you closed issues in recently.

Blocked issues, epics and issues assigned to someone else are left out; `excluded` says why.

## 2. Explain the top three

One line each, in the chat language of the person you are talking to: the item, then its `reason`. Don't reorder them by your own judgment; if you think the order is wrong, say so after the list and why. Mention what was left out only when it matters (for example, the most important issue is blocked).

## 3. Offer the next step

For an issue: offer `/start <n>`. For a {{vocab.changeRequest}}: offer to open it and address the review or the checks. Do nothing until the person picks one.

## 4. Learn

If the person picks something other than the top recommendation, ask why in one line. A recurring reason (a label that is missing, a priority that is wrong) is a lesson: `agent-os lessons add "…" --area <area> --source "/next"`.
