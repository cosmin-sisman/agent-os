---
type: decision
refs: ["#62", "2026-11-18-other-agents-agents-md-first"]
areas: [distribution]
author: cosmin-sisman
---

# Other agents: AGENTS.md first, the CLI everywhere, hooks and skills degrade (proposed)

A proposed decision record, with the research behind it. Codex and Cursor read AGENTS.md natively and share the SKILL.md folder shape in other locations. Their hooks use their own files and event models, which are not stable enough to target. AGENTS.md, the CLI and the platform checks work without Claude Code. Hooks degrade to CI enforcement at push time, skills stay readable procedures, and subagent fan-out runs sequentially. Generating per-agent files is rejected for now. The status stays proposed: the owner accepts it, and the template line it describes comes after that.
