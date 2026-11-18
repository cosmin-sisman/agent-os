---
name: test
description: Plan test scenarios into an issue, run the suites a change needs, write the results into the {{vocab.changeRequest}}, and find changed logic with no test. Use when an issue is created or started, before opening a {{vocab.changeRequest}}, or when someone asks what to test.
argument-hint: "plan <issue> | pr | local | gaps"
---

# /test: scenarios first, results always

{{#if slots.testing}}This project binds the `testing` slot to `{{slots.testing}}`: use that skill for writing the tests themselves, and these commands for the scenarios and the results.{{/if}}

## plan: scenarios into the issue

```
agent-os test plan <n>            # what it has and what it proposes
agent-os test plan <n> --write    # adds them, after you have filled in the …
```

- A **bug** starts with its regression scenario: Given the steps to reproduce, when it runs, then the expected behaviour. The test must fail before the fix and pass after it.
- A **feature** gets one scenario per acceptance criterion. Replace each `…` with the real condition and action before writing.
- Scenarios are `- [ ] Given …, when …, then …` lines, in the issues language (**{{lang.issues}}**).

## local: run what the change needs

```
agent-os test local          # the suites the diff needs (the gate)
agent-os test local --all
```

## gaps: changed logic without a test

```
agent-os test gaps
```

Each file it lists needs a test from the issue's scenarios, or a line in the {{vocab.changeRequest}} saying why none is needed.

## pr: the results into the {{vocab.changeRequest}}

```
agent-os test pr [<n>]
```

It writes the gate's results table into **How it was tested**, in its own block, replaced on every run.

## Before /ship

Tick each scenario the tests cover in the issue. `/ship` refuses while a scenario of an issue it closes is unticked. Move a scenario you did not cover to a follow-up issue rather than leaving it open.

## Learn

A bug that no scenario would have caught is a lesson about planning: capture it with `agent-os lessons add`.
