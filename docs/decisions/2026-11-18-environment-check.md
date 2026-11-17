# Declared requirements and an environment check

Status: accepted

## Context
Several people on their own laptops end up with different MCP servers, scopes, CLI versions and variables. Missing an MCP server or a GitHub scope (for example `project`, needed for Projects v2) shows up as a confusing failure in the middle of a skill.

## Decision
- `agent-os.json` declares `requires`: MCP servers (name, scope, transport, optional, why), CLI versions, GitHub token scopes, environment variable names and plugins.
- `agent-os env` and the `/env` skill check the repository side (`.mcp.json` complete, no literal secrets) and the laptop side (servers installed and connected in the right scope, CLIs, scopes, variables present). They print fix commands, never values.
- It runs at `init`, as a sub-second offline subset at SessionStart, in full on demand and before `/release`. CI checks the repository side only.

## Consequences
A new teammate gets a working setup from one command's report. Skills can assume their tools exist, or fail early with the fix.
