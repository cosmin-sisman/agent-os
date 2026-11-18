# Environment check

`agent-os env` compares what the project needs (`agent-os.json` → `requires`) with what the repository declares and what this laptop has. Every problem comes with the command that fixes it. Decision: [environment check](../decisions/2026-11-18-environment-check.md).

```json
"requires": {
  "mcp": [
    { "name": "postgres", "scope": "project", "transport": "http", "url": "https://mcp.example.com/pg", "why": "schema reads" },
    { "name": "figma", "scope": "user", "optional": true, "why": "ui-design slot" }
  ],
  "cli": { "node": ">=22", "gh": ">=2.60", "docker": "*" },
  "platformScopes": ["repo", "workflow", "project"],
  "env": ["DATABASE_URL"]
}
```

```bash
agent-os env          # everything (runs gh/glab, the tools, claude mcp list)
agent-os env --fast   # repository side and variables, no commands: under a second (SessionStart uses it)
agent-os env --ci     # repository side only, for CI
```

Exit code: `0` when nothing fails (warnings are fine), `1` when something fails, `2` when the check could not run.

| Check | Side | Fails when | Fix shown |
|---|---|---|---|
| project MCP servers | repo | `.mcp.json` lacks a `scope: project` server, or uses another transport | the exact `claude mcp add --scope project …` |
| literal secrets | repo | a value in `.mcp.json` looks like a credential instead of `${VAR}` | the placeholder to use, and a reminder to rotate it |
| variables | laptop | a variable in `requires.env` is not set | where to set it |
| platform login and scopes | laptop | `gh` / `glab` is missing, logged out, or lacks a scope | `gh auth refresh -h <host> -s <scope>` or `glab auth login --hostname <host>` |
| tools | laptop | a tool in `requires.cli` is missing or outside its version range | install or upgrade |
| MCP servers | laptop | a required server is not installed, needs authentication or fails | `claude mcp add …`, `/mcp`, `claude mcp get …` |

An optional server that is missing is a warning, not a failure.

**Secrets are never shown.** Variables are reported as set or not set, never by their value. Platform tokens are reported by their scopes and source (`gh auth (github.com)`), never their value. A literal secret in `.mcp.json` is reported by its key path (`mcpServers.github.env.GITHUB_TOKEN`). The output of `gh`, `glab` and `claude` is parsed, never echoed. Tests plant fake tokens on every input and check that none reaches stdout, stderr, `--json` or the SessionStart reminder.

At session start, the fast check runs as a hook and warns once about anything missing. The `/env` skill explains the findings and applies fixes only with your consent.

## Requirements the stack suggests: `agent-os env propose`

The stack map implies some requirements. A provider the catalog marks with `mcpHint` (Sentry, Vercel, Supabase, Stripe, …) suggests looking for its MCP server, and a provider with a well-known command-line tool suggests that tool (`vercel`, `wrangler`, `supabase`, `stripe`, `sentry-cli`, `gh`, …).

```sh
agent-os env propose                                   # list what the layers in use suggest; adds nothing
agent-os env propose --accept mcp:sentry --accept cli:supabase
agent-os env propose --accept-all [--dry-run]
```

- Nothing is ever added silently. `propose` lists, and only `--accept <id>`, `--accept-all` or a "yes" at the interactive question writes to `agent-os.json` → `requires`.
- An accepted MCP server is added as `optional` and user-scoped, with a `why` naming the layers. agent-os never assumes the server exists: `agent-os env` checks it like any other requirement, and the team can make it required or project-scoped later.
- Accepted CLIs are added with the range `*`; tighten it to a version range when the team needs one.
- Only layers in use (status `chosen`) count, and what `requires` already lists is not proposed again.
