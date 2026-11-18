# Coding standards

Design §22, decision [coding standards](../decisions/2026-11-18-coding-standards.md).

## The core rule

`.claude/rules/standards.md` is installed in every project, in the `docs` language, and loads in every session. It covers:
- English in code (comments in Romanian only when `languages.codeComments` is `ro`);
- a 1–3 line header in every file;
- small single-purpose functions, no dead code, `TODO` only with an issue reference;
- the simplest correct solution, optimized only where it is measured;
- tests with the change;
- how to choose between solutions: name 2–3 candidates, compare them, pick one with a reason, implement only that one;
- quoting identifiers in YAML, and LF line endings.

## Language rules, from the stack

For each **chosen** layer in `stack.yaml`, the catalog gives its technology and language. agent-os installs `.claude/rules/stack/<language>.md` for the languages in use, with Claude Code `paths:` front matter listing the layers' paths, so a rule loads only for its files:

```markdown
---
paths:
  - "services/api/**"
  - "services/workers/**"
---

# Python

Applies to `services/api/**`, `services/workers/**`.
- Type hints on public functions; …
```

Rules ship for TypeScript, JavaScript, Python, SQL and YAML, in `en` and `ro`. A layer whose technology or language agents know poorly (`aiFriendly` ≤ 2 in the catalog) adds a **Read the docs first** section naming it. Layers that are `evaluating`, `optional` or `rejected` install nothing.

Every rule is kept under the 6 KB budget for `.claude/rules/**/*.md`, which `doctor` checks.

The `/standards` skill (review, explain, choose between solutions) is #102, and the on-edit reminders and `doctor --ci` checks are #103.
