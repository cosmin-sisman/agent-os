---
type: decision
refs: ["#3"]
areas: [cli]
author: cosmin-sisman
---

# The CLI skeleton: one runner, a registry with lifecycle states, honest planned commands

`bin/agent-os.mjs` only calls `run(argv, io)` in `src/cli/main.mjs`, which never calls `process.exit`, so the whole CLI is testable in memory. Commands live one per file in `src/commands/` and load lazily from `src/cli/registry.mjs`.

Decision: the registry lists every command from the design with a lifecycle state (`planned`, `new`, `stable`, `deprecated`) and its issue. A planned command exits 2 and links its issue instead of pretending to work, and `--help` shows what is ready and what is planned. This is the first concrete use of the lifecycle markers (design §19).

Output rules: text on stdout, diagnostics on stderr, exactly one JSON object on stdout with `--json` (on success and on failure), exit codes 0, 1 and 2.
