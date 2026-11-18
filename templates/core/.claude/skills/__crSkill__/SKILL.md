---
name: {{vocab.crSkill}}
description: Open a {{vocab.changeRequest}} for the current branch only when it is ready (the gate passed on this exact commit, a journal entry, a non-empty Lessons section, a title in convention), then watch its checks and answer review threads. Use when a change is done, or when someone asks to open, update or follow a {{vocab.changeRequest}}.
argument-hint: "[issue number]"
---

# /{{vocab.crSkill}}: a {{vocab.changeRequest}} that is ready

Issue: $ARGUMENTS

{{vocab.changeRequests}} are written in **{{lang.prs}}**{{#if lang.prs == "ro"}} (Romanian without diacritics){{/if}}; the journal in **{{lang.journal}}**. Never open one with a failing check: the CLI refuses, and you never work around it.

## 1. Review before the reviewers

- Read the whole diff against `origin/{{branches.integration}}`. Remove debugging leftovers, unrelated changes and commented-out code.
- {{#if slots.standards}}Run the standards pass with the `{{slots.standards}}` skill on the diff; fix what it finds or say in the body why not.{{else}}Check the diff against the coding standards rule.{{/if}}
- {{#if slots.review}}Run the `{{slots.review}}` skill on the diff and address its findings.{{else}}No review skill is bound (`slots.review`); review the diff yourself for correctness first.{{/if}}
- Check the issue's test scenarios: each one has a test in this branch, or the body says why not.

## 2. Journal entry and commit

```
agent-os journal add --type decision --title "<what was decided>" --area <area> --ref "{{vocab.issueRef}}<n>" --body-file <file>
```

The entry says what was decided and why, and what was left out. Commit it with the work. Commit messages follow the convention (`agent-os check commit`).

## 3. Gate

```
agent-os gate
```

It runs the suites the diff needs (`gate` and `gatePaths` in agent-os.json) on a clean tree. If a suite fails, fix it and run the gate again. Put its results table in **How it was tested**, with any extra checks you ran by hand.

## 4. Title and body

- Title: `type(scope): summary [{{vocab.issueRef}}<n>]`, at most {{conventions.maxTitleLength}} characters with the suffix.
- Body: the project's template, filled in: What, Why (`Closes {{vocab.issueRef}}<n>`), How it was tested (real results), **Lessons** (a lesson for the rules, or `None: <why>`; never empty), Notes for reviewers.
- Write it to a file in the scratchpad, then:

```
agent-os pr preflight --title "<title>" --body-file <file>
```

Fix every problem it lists. It suggests a corrected title when it can.

## 5. Open

```
agent-os pr create --title "<title>" --body-file <file> [--draft]
```

It pushes, opens the {{vocab.changeRequest}} into `{{branches.integration}}`, copies the issue's type and area labels and records it on the issue. Report the link, and refer to it as `{{vocab.crRef}}N` from then on.

## 6. Checks and review

```
agent-os pr status --watch
agent-os pr threads
agent-os pr reply <thread-id> --body-file <file> [--resolve]
```

- A failing check: read its log, fix it in a new commit, run the gate again and push. Never re-run a red check hoping it turns green without understanding it.
- Review threads: answer **in the language of the comment**, briefly, with what you changed or why not. Resolve a thread only when the change is pushed or the reviewer agreed.
- A decision made in a thread goes, quoted, into the journal entry.

## 7. Learn

If something here went wrong or took long (a check you did not expect, a review comment that a rule could have prevented), propose a lesson in the Lessons section and with `/lessons`.
