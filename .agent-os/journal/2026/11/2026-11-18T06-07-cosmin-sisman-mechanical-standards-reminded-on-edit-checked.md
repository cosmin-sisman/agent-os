---
type: decision
refs: ["#103", "#101", "#26"]
areas: [standards, hooks]
author: cosmin-sisman
---

# Mechanical standards: reminded on edit, checked in doctor

A PostToolUse `standards` handler and a doctor `standards` check, sharing src/standards/checks.mjs.

Decisions:
- The reminder covers only what the edit added: a new TODO without `#N` is named by its line (the issue's scenario), and old ones elsewhere in the file are left to doctor. Each finding is reminded once per session.
- It never blocks the edit (the acceptance criterion). It answers with `additionalContext` only, reads one file, and has an 800 ms timeout (orchestrator's conditions). The runner gained PostToolUse context output for this.
- A missing header is reminded only for a new file (Write); doctor's `headers` check covers new files on the branch.
- English comments are detected by non-ASCII letters in comment text, which holds when `codeComments` is en. Teams with ro comments are not reminded.
- Size uses the new `standards.maxFileLines` (500).
- The handler is installed into projects through the existing hooks block. This repository has no .claude/settings.json, so nothing is enabled here.
