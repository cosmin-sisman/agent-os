---
type: decision
refs: ["#258", "#62", "2026-11-18-other-agents-agents-md-first"]
areas: [distribution, doctor]
author: cosmin-sisman
---

# Accepted: other agents read AGENTS.md first; doctor names the Claude Code-only parts

The owner accepted the decision on other coding agents (2026-11-18-other-agents-agents-md-first, #62). This implements its "Once accepted" bullet:
- the record is `Status: accepted`;
- the installed AGENTS.md block has one line for other agents: a request for `/<name>` means reading `.claude/skills/<name>/SKILL.md` and following it, and every step in it is an `agent-os` command. The block is now rendered in the docs language, so `ro` installs get the whole block in Romanian (ASCII), not only the new line;
- doctor has an `agents` check that returns one `info` finding naming the Claude Code-only parts (hooks, subagent fan-out). `info` is a new finding level: it counts as ok, never lowers the score, and is printed after the warnings;
- the FAQ entry and the guides index name the same parts.

Existing installs get the new block through `agent-os update` (a managed block, three-way merged), so no migration is needed; nothing shipped is removed or renamed.
