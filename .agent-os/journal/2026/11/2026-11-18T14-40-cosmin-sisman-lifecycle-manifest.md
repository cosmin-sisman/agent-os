---
type: decision
refs: ["#66", "#67", "#68", "#27"]
areas: [updates]
author: cosmin-sisman
---

# The lifecycle manifest is enforced on every pull request

Items are collected from the code itself (the command registry and each command's options, the configuration schema, hook handlers, templates, catalog entries), so nothing can ship without appearing in the manifest. 369 items at 0.0.0, all `new`.

Decisions:
- `manifest.json` is committed as the last release's baseline and rebuilt at release. The design said "generated at release", and this keeps that. Committing it adds one thing: every PR is checked against it by a test, so a removal without deprecation fails immediately, not at release time.
- States change only through `src/lifecycle/lifecycle.yaml`. Allowed transitions are explicit (stable never goes straight to removed), deprecations need a replacement and a removal version, and removals need an existing migration (#67).
- `deprecatedInUse` finds deprecated config keys and the commands and flags in a project's hooks. `agent-os manifest usage` exposes it today, and doctor will reuse it (#27).
- Found on the way: the YAML subset could not read a document that is only an inline value (`[]`). Fixed, with a test.
- On the orchestrator's instruction: no npm publish and no npm tokens. The package is not on npm yet, so the pinned `npx -y @cosmin-sisman/agent-os@x` hook command (#65) works only after the owner publishes.
