# Other coding agents: what they read (November 2026)

The research behind [the proposed decision](../decisions/2026-11-18-other-agents-agents-md-first.md) (#62). Most sources are third-party guides and forum threads, not vendor documentation, and the surfaces changed often in 2026. Items marked *to verify* need checking against the vendor's own docs before anything is built on them.

| Surface | Claude Code | Codex CLI | Cursor |
|---|---|---|---|
| AGENTS.md | imported from CLAUDE.md | read natively, always loaded; survives compaction | read natively, at the root and in subfolders |
| Rules | `.claude/rules/`, CLAUDE.md | AGENTS.md (plus its own rules surface) | `.cursor/rules/*.md(c)`; team, project and user rules |
| Skills (`SKILL.md` folders) | `.claude/skills/` | `.agents/skills/`, `~/.agents/skills/` (since about v0.94, early 2026) | `.cursor/skills/`, `.agents/skills/`, `~/.cursor/skills/`; Claude and Codex folders reported compatible (*to verify*) |
| Hooks | `.claude/settings.json` | `.codex/hooks.json`; sources disagree on whether it is stable (*to verify*) | `.cursor/hooks.json`, also in cloud agents |
| Subagents | yes | yes (plugins, subagents) | `.cursor/agents/` |

What it means for agent-os:
- AGENTS.md and the CLI already reach every agent.
- Skills are close to portable: the folder shape is shared, only the location differs.
- Hooks are not portable: each agent has its own file, event names and payloads.

## Sources

- Codex CLI: [instruction stack (AGENTS.md, rules, hooks, skills)](https://codex.danielvaughan.com/2026/05/07/codex-cli-instruction-stack-six-surfaces-agents-md-rules-hooks-skills/), [plugins, skills, hooks and MCP](https://codex.danielvaughan.com/2026/04/09/building-codex-cli-plugin-skills-hooks-mcp/), [Codex guide](https://blakecrosley.com/en/guides/codex), [compatibility reference](https://cdn.jsdelivr.net/npm/@softspark/ai-toolkit@4.20.0/kb/reference/codex-cli-compatibility.md), [Everything Claude Code on Codex](https://www.mintlify.com/affaan-m/everything-claude-code/platforms/codex)
- Cursor: [rules](https://cursor.com/help/customization/rules.md), [rules, mdc, AGENTS.md and hooks (forum)](https://forum.cursor.com/t/cursor-setup-with-rules-mdc-agents-md-and-hooks/161005), [rules, commands, skills and hooks](https://theodoroskokosioulis.pages.dev/blog/cursor-rules-commands-skills-hooks-guide), [agent plugins request (forum)](https://forum.cursor.com/t/agent-plugins-isolated-packaging-lifecycle-management-for-sub-agents-skills-hooks-rules-incl-agent-md-across-cursor-ide-cli/151250), [AGENTS.md guide](https://morphllm.com/agents-md-guide) (its hooks column looks outdated)
