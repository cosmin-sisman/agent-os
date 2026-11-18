---
areas: [github, platform]
paths: ["scripts/github/**", "src/platform/**"]
keywords: [idempotent, sub-issues, 422]
source: "#88, scripts/github/setup.mjs rerun"
confidence: high
promotedTo: "AGENTS.md: Conventions an agent can't infer"
---

GitHub answers a repeated sub-issue link with HTTP 422 "duplicate sub-issues", not "already exists". Idempotent platform scripts must treat each platform's "already linked" errors as success, and the set of messages is part of the adapter, not of the caller.
