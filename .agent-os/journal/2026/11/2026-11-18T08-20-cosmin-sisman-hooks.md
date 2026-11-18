---
type: decision
refs: ["#8", "#61"]
areas: [hooks]
author: cosmin-sisman
---

# One hooks runner, guards as configuration

`.claude/settings.json` gets one entry per event calling `agent-os hook <Event>`, with no `[ -f … ] ||` chains and no shell syntax, so it runs the same in bash, zsh and PowerShell. Tests run the real executable through each of those shells where the CI runner has it.

Decisions:
- A handler that crashes or hangs fails open: it is reported once per session (recorded in `.agent-os/cache/hook-failures.json`) and skipped. Only guards may refuse, and only through an explicit decision, never by failing.
- Guard rules match per simple command, after splitting the line outside quotes, and flags must be separate words. The well-known false positive of a flag mentioned inside a commit message does not happen.
- Built-in guards protect the safety nets themselves (`--no-verify`, `commit -n`, `core.hooksPath`). Everything stack-specific (database resets, heavy builds) is a project rule.

This repository does not install the hooks yet, because `npx --no-install agent-os` needs the package installed. That belongs to dogfooding (#61).
