---
type: decision
refs: ["#69", "#66", "#163"]
areas: [updates]
author: cosmin-sisman
---

# Legacy features are opt-in folders; deprecations speak when used

Legacy opt-in and deprecation reporting.

Decisions:
- A legacy feature is a folder, `templates/legacy/<id>/`. The install plan adds it as a route only when `legacy` in agent-os.json names it, so legacy items are absent unless enabled. The manifest lists each feature as `legacy:<id>`, so lifecycle.yaml can give it removeIn and a replacement.
- doctor's new `lifecycle` check reports each enabled feature as debt, with its removal version and replacement. It fails on an unknown id. It also lists the deprecated items still in use (config keys and hook commands) through the existing `deprecatedInUse`.
- A deprecated or legacy command or flag prints a note on stderr when it runs, read from lifecycle.yaml (the current package), not from manifest.json (the last release).
- The package ships no legacy feature yet, so the tests use a fixture template tree.
- Lesson captured from PR #163: never pipe a check whose exit code decides the next step.
