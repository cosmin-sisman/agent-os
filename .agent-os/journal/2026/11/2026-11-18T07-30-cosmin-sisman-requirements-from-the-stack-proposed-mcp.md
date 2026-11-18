---
type: note
refs: ["#79"]
areas: [env]
author: cosmin-sisman
---

# Requirements from the stack: proposed MCP servers and CLIs, accepted explicitly

`agent-os env propose` turns the stack into suggested requirements: an MCP server for each provider in use that the catalog marks with mcpHint, and the provider's well-known CLI. Nothing is added silently; a proposal reaches agent-os.json only by its id, with --accept-all, or after a yes. MCP proposals are optional and user-scoped, because a hint is not a guarantee that a server exists; `agent-os env` then checks the accepted ones like any other requirement.
