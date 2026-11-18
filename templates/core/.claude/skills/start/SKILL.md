---
name: start
description: Start work on an issue the way the team can see it. Assign yourself, create its branch from the right base and link it to the issue, move it to In Progress and check it out. Use when someone says "start", "take", "pick up" or "work on" an issue, or after /next proposes one and the person agrees.
argument-hint: "<issue number> [--hotfix]"
---

# /start: claim an issue and branch

Issue: $ARGUMENTS

## 1. Preview

```
agent-os start <n> --dry-run
```

Show the person the branch name, its base and the steps. The branch is `<type>/<n>-<slug>` from the issue's type label; a `--hotfix` branch is `hotfix/<n>-<slug>`, cut from the production branch instead of the integration branch.

## 2. Stops, not errors

- **Assigned to someone else**: do not take it. Propose a short comment on the issue asking them (in **{{lang.issues}}**{{#if lang.issues == "ro"}}, without diacritics{{/if}}), and use `--force` only after they agree.
- **Done in parts** (open sub-issues): propose one of the sub-issues. One {{vocab.changeRequest}} closes one issue.
- **An epic**: same, start one of its sub-issues.
- **Closed**: ask whether to reopen it or open a new one with /ticket.

## 3. Start

```
agent-os start <n>
```

Add `--worktree` only when the person runs several sessions in parallel; by default the branch is checked out in place.

## 4. Before writing code

- Read the issue, its test scenarios and its conversation: `agent-os thread {{vocab.issueRef}}<n>` lists the participants, the language and the decisions made in comments; follow those decisions. Unclear acceptance criteria are a question in the issue, not a guess.
- Done means tested: the scenarios become tests in this branch.

## 5. Learn

`agent-os start` lists the lessons that apply to the issue (its areas, the paths and words it mentions). Say which ones you will follow, and follow them. If starting went wrong (a wrong base, a claim conflict), capture it: `agent-os lessons add "…" --area <area> --source "#<n>"`.
