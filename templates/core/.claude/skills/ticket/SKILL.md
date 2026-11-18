---
name: ticket
description: Create a complete issue (title convention, body from the form, one type and one priority label, one or more area labels, milestone, assignees, parent, blockers and test scenarios) after a duplicate search, in the issues language. Use when someone asks for a ticket or issue, or agrees to one you proposed.
argument-hint: "<the problem, short>"
---

# /ticket: a complete issue

Request: $ARGUMENTS

Issues are written in **{{lang.issues}}**{{#if lang.issues == "ro"}} (Romanian without diacritics: plain a, i, s, t){{/if}}. Labels are named in **{{lang.labels}}**.


**A vulnerability is never a ticket.** If the work describes something exploitable (an injection, XSS, an authorization bypass, a leaked secret…), report it privately instead: `agent-os security report --title "…" --body-file <f>`. That is a draft security advisory on GitHub and a confidential issue on GitLab. `agent-os issue new` refuses one. Hardening that reveals nothing exploitable is a normal ticket: add `--hardening`, which adds the security label.

## 1. Agreement

Create the issue only if the person asked for it or agreed to your proposal. Otherwise propose it (a title plus one or two lines on why it matters) and stop.

## 2. Duplicates first

```
agent-os issue similar "<a title draft>"
```

If an issue already covers it, show it and propose adding to it instead: `agent-os issue new … --extend <n>` posts your text as a comment there. Never create a twin. If the work is too big for one {{vocab.changeRequest}}, propose an epic with sub-issues: one {{vocab.changeRequest}} closes one issue.

## 3. Facts

Collect the evidence before writing: the exact error, `file:line`, command output, the account or role that sees it, and what you tried. Reproduce it when that is cheap. What you don't know becomes an open question in the issue, never a guess.

## 4. Title and body

- Title: `<Area>: <the problem in short>`, at most 70 characters, no final period.
- Scenarios: draft them with `agent-os test plan` once the issue exists, or write them yourself.
- Body: the sections of the project's issue form, plus **{{#if lang.issues == "ro"}}## Scenarii de test{{else}}## Test scenarios{{/if}}** with Given / When / Then lines, including the edge cases and, for a bug, the regression test that will prove the fix.
- Code, commands, file names and errors stay verbatim in backticks.
- Write the body to a file in the scratchpad.

## 5. Labels, milestone, relationships

- Exactly one type (`{{labels.type.feature}}`, `{{labels.type.bug}}`, `{{labels.type.docs}}`, `{{labels.type.chore}}`, `{{labels.type.epic}}`, `{{labels.type.research}}`) and one priority (`{{labels.priority.p0}}` … `{{labels.priority.p3}}`); one or more `area:*`; optionally a size and flags (`{{labels.needs-decision}}`, `{{labels.good-first-issue}}`). Label ids such as `type:bug` are accepted and translated.
- A milestone is required: the roadmap stage it serves, or the rolling release milestone for work outside the stages.
- A parent epic (`--parent`), what blocks it (`--blocked-by`), what it blocks (`--blocks`), and assignees: only people who will do it.

## 6. Create

```
agent-os issue new --title "<Area>: <problem>" --body-file <file> \
  --label <type> --label <priority> --label area:<x> [--label <size>] \
  --milestone "<milestone>" [--assignee <login>…] [--parent <n>] [--blocked-by <n>…] [--blocks <n>…]
```

It refuses an issue that misses a type, a priority, an area, a milestone or the test scenarios, and says what to add. It searches for duplicates again before creating. Relationships follow the platform's capabilities: where blocking links or sub-issues are not available, it falls back to a related link, the `{{labels.blocked}}` label and a "Blocked by #N" line, and it says so.

## 7. Report

The issue link, its milestone and why, its parent and blockers, and one line on what it contains. To start: `/start <number>`.

## 8. Learn

If something about this request should change how issues are written here (a missing area, a label nobody uses, a recurring kind of request), write it to `.agent-os/lessons/inbox/`. Otherwise say there is no lesson.
