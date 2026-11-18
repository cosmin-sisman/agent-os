---
type: decision
refs: ["#65", "#68", "#8"]
areas: [updates, hooks]
author: cosmin-sisman
---

# The pinned version reaches every hook

The hooks block is now part of what the installer manages (`.claude/settings.json#hooks`), and its command is computed from the pin. It uses `npx -y @cosmin-sisman/agent-os@<exact>`, or the project's own install when agent-os is an exact devDependency. `settingsHooks` refuses to build a block without a command, so an unpinned hook cannot be written by mistake.

Decisions:
- Without a pin yet, the running version is used, still exact. The SessionStart check suggests pinning it.
- A devDependency with a range is treated as unpinned, because two laptops can resolve different versions. Hooks then fall back to npx with the pin, and the check asks for an exact install (`-E`).
- The check runs at SessionStart (a single warning per session), in `agent-os version --check`, and later in doctor (#27).
