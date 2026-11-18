---
type: lesson
refs: ["#117"]
areas: [gate, security]
author: cosmin-sisman
---

# Gate: component values are validated before they reach the shell

gateAffected.command (#117) put component ids and paths, read from system.yaml or the workspace manifests, into a command run through a shell. A branch can set those values, so a path like `a; touch pwned` would have run in the gate, in CI too. Each substituted value must now match /^[A-Za-z0-9._@/-]+$/, contain no ".." segment and not start with "-"; anything else is refused with exit 2, naming the component, before any suite runs. Values are refused, never quoted: quoting rules differ between shells and platforms, and a strict allowlist does not. The other shell commands (the `gate` suites) come from agent-os.json, which the team reviews like code.
