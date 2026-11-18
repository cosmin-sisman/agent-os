# Other coding agents: AGENTS.md first, the CLI everywhere, hooks and skills degrade

Status: accepted

## Context
Teams mix agents: one person uses Claude Code, another Codex or Cursor. agent-os installs four kinds of things, and each reaches other agents differently (#62, research: [other agents](../research/other-agents.md)):
- **AGENTS.md**, with a managed `agent-os` block. CLAUDE.md only imports it.
- **The CLI**: every mechanical step is an `agent-os` command with `--json`, so any agent that can run a shell command can use it.
- **Skills** in `.claude/skills/<name>/SKILL.md`.
- **Hooks** in `.claude/settings.json`: guards, session context, reminders.

As of November 2026:
- **AGENTS.md** is read natively by Codex and Cursor, including nested files.
- **Skills** use the same `SKILL.md` folder shape in both. Codex reads them from `.agents/skills/`. Cursor reads `.cursor/skills/` and `.agents/skills/`, and is reported to read Claude's folders too (to verify).
- **Hooks** exist in both, but in each agent's own format and file (`.codex/hooks.json`, `.cursor/hooks.json`). The event names and payloads differ from Claude Code's, and the sources disagree on how stable they are.

These surfaces moved several times during 2026.

## Decision
- **What works without Claude Code, as it is:**
  - AGENTS.md is the source of truth for every agent;
  - the CLI is the one interface for every mechanical step;
  - the platform side (issue forms, templates, the `agent-os/loop` and gate workflows, the required checks).

  An agent that only reads AGENTS.md and runs the CLI follows the same flow.
- **What degrades, explicitly:**
  - *Hooks* run only in Claude Code. Elsewhere, the same rules are enforced later, by the required checks in CI (`agent-os/loop`, the gate) and branch protection. A push that a guard would have stopped is refused by the platform or fails the change request instead.
  - *Skills* are Markdown procedures. An agent that does not load `.claude/skills/` can still follow one when AGENTS.md points to it by name.
  - *Subagent fan-out* (`/audit` lenses, `/discover` areas) runs sequentially in an agent without subagents. The CLI output (briefs, plans) is the same.
- **Once accepted:** the installed AGENTS.md block gets one line for other agents. A request for `/<name>` means reading `.claude/skills/<name>/SKILL.md` and following it, and every step in it is an `agent-os` command. `doctor` and the guides then name the Claude Code-only parts. Done in #258.
- **Rejected for now:**
  - Generating per-agent files (`.cursor/rules/`, `.codex/hooks.json`, `.agents/skills/` copies): every format is a moving target, and each copy is one more managed file to merge. They would also duplicate AGENTS.md, whose budget exists to keep it read in full.
  - A hook adapter per agent: the CI checks already enforce the rules, and an adapter would have to track each agent's event model.

  Revisit when an agent's hook or skill format is documented as stable. That would be an `agents` setting choosing extra install targets, built on capabilities, like platforms (§20).

## Consequences
- A mixed team works on one flow without anyone installing Claude Code. What they lose is earlier feedback: hooks warn at edit time, CI only at push time.
- Nobody should assume a guard protects them in another agent: that is why `doctor` and the guides name the Claude Code-only parts once this is accepted.
- The AGENTS.md budget matters more: it is the one file every agent reads.
- To watch: Codex and Cursor hook formats, and whether `.agents/skills/` becomes the shared skills folder. If it does, installing skills there is a small, separate decision.
