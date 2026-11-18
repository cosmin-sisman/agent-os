---
name: retro
description: Triage the lessons inbox and repeated review findings into rule changes, active cards or rejections, and update the recall counters. Use at every release, when the Retro issue asks for it, or when someone asks to review the lessons.
---

# /retro: from lessons to rules

## 1. The plan

```
agent-os retro plan
```

It groups the inbox by theme and proposes a decision for each lesson. It also lists review findings repeated on three or more recent pull requests, each proposed as a rule.

## 2. Decide each one, with the person

Every inbox lesson ends as one of these; nothing stays undecided:
- **rule**: a line in the rule file that owns the topic (for example `.claude/rules/…` or `AGENTS.md`), with its reason. Make that change in a pull request.
- **card**: an active lesson, recalled by its paths and keywords.
- **rejected**: with the reason (a duplicate, no longer true, too vague).

A repeated review finding becomes a rule line, or a check when it can be automated.

## 3. Apply

```
agent-os retro apply --accept <id> --promote <id>="<file: section>" --reject <id>="<reason>"
```

It refuses while any inbox lesson has no decision. It also updates the `recalled` and `followed` counters of the active cards from the journal; /retro is their only writer.

## 4. Record

Add a `lesson` journal entry listing what became a rule, a card or a rejection, and commit it with the rule changes.

## 5. Learn

If triage keeps finding the same kind of lesson, the Learn step that captures it is missing a rule: propose it.
