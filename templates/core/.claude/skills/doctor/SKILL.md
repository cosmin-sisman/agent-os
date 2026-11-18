---
name: doctor
description: Check the agent system, the repository and the {{vocab.platform}} hygiene, repair what is mechanical, and propose the rest. Use when someone asks whether the setup is healthy, after an update, before a release, or when a hook or skill behaves strangely.
---

# /doctor: is the system healthy?

## 1. Run it

```
agent-os doctor --json
```

`--offline` skips the {{vocab.platform}} checks (no network). `--ci` is what CI runs: local and deterministic.

## 2. Report

In the chat language of the person you are talking to: the readiness score, then each FAIL with its fix, then the warnings grouped by check. Quote the fix that doctor gives; don't invent another.

## 3. Repair

- Findings marked fixable are mechanical (for example `.gitignore` entries, diacritics in a ro area). Offer `agent-os doctor --fix` and run it once the person agrees. Then run doctor again.
- Everything else is a proposal. For each one, say what to change and where, and do it only when asked. Something too big for now becomes an issue through /ticket.
- Never silence a check by editing what it reads (raising a budget, deleting a journal entry).

## 4. Learn

When the same finding keeps coming back, propose a lesson or a rule so it stops happening.
