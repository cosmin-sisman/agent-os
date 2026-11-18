---
type: decision
refs: ["#9"]
areas: [env]
author: cosmin-sisman
---

# agent-os env: requirements against the repository and the laptop

Checks receive a probe (run a command, read a file, ask whether a variable is set) instead of touching the system directly. Tests run them against a fake machine, and the real one is `systemProbe`. Commands run without a shell and with timeouts.

Decisions:
- Secrets never enter findings. The probe can only say whether a variable is set, not read its value. Tool output is parsed, never echoed. Literal secrets are reported by key path. On the orchestrator's request, a test plants fake tokens in .mcp.json, the gh output and an environment value, and checks every output channel.
- Three modes: `fast` (no commands, for SessionStart), `ci` (repository only), `full`.
- Plugins (`requires.plugins`) are not checked yet: there is no stable way to list them from the CLI. This is noted on #9.
- The `/env` skill is the first file under `templates/core/`. It is installed by `init` once templates are wired into installation (#94, #49).
