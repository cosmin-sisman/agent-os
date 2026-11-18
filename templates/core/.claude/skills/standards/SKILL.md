---
name: standards
description: Apply the project's coding standards - review a file or a diff against them, explain a rule, or choose between several ways to implement something and implement only the chosen one. Use before code review in /{{vocab.crSkill}}, when there is more than one reasonable implementation, or when someone asks whether code follows the standards.
argument-hint: "review <path|diff> | choose <the question> | explain <rule>"
---

# /standards: one standard, every change

Request: $ARGUMENTS

{{#if slots.standards}}This project binds the `standards` slot to `{{slots.standards}}`: use it for the review, and the procedure below for choices.{{/if}}

The rules are in `.claude/rules/standards.md` and, for each language in the stack, `.claude/rules/stack/`. Apply them; don't restate them to the person.

## Choose between solutions

When there is more than one reasonable way:

1. Name **two or three** candidates, one line each. Drop the clearly worse ones before you start.
2. Compare them on correctness, simplicity, fit with the existing code and stack, performance where it matters, testability, and cost of change.
3. Pick one and say why **in one sentence**.
4. Implement **only the chosen one**. Never leave two half-solutions, or a flag to switch between them.

Record it:

```
agent-os standards choice --title "<the question>" --option "a: <one line>" --option "b: <one line>" --pick a --why "<one sentence>" [--criterion simplicity="<note>"]
```

Put its output in the {{vocab.changeRequest}} description. If the choice is hard to reverse (a data model, a public API, a dependency, a protocol), add `--record <slug>` so it becomes a decision record.

## Review a file or a diff

Go through the change in this order, and report only real findings, each with its file and line:
1. correctness and errors;
2. clarity (names, size, one responsibility, no dead code, comments that explain why);
3. the header and `TODO(#N)` rules;
4. language rules for its paths;
5. needless complexity or premature optimisation.

Fix what you can in the same change. A finding you leave goes into the {{vocab.changeRequest}} body with its reason.

## Explain a rule

Quote the rule, say why it exists, and show one example from this codebase.

## Learn

A review finding that keeps coming back is a rule to add: capture it with `agent-os lessons add`; /retro turns it into a rule line.
