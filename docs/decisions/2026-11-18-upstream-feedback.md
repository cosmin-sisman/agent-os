# Upstream feedback from projects, with privacy by construction

Status: accepted

## Context
Every project using agent-os learns something about the package itself. Today that knowledge stays in the project. Sending it upstream by hand is rare, and pasting context from a private project into a public issue risks leaking code, names or secrets.

## Decision
- A core `/upstream` skill drafts an issue for `cosmin-sisman/agent-os` from what the user says, a lesson `/retro` marks generic, a doctor finding caused by the package, or an unexpected skill failure.
- The draft is built from a whitelist (agent-os version, profile, skill or command, config keys without values, OS and Node versions, the description). Everything else is removed, and the user approves the exact text before sending.
- It searches upstream for duplicates first and prefers a reaction or comment on an existing issue.
- The upstream URL is recorded in the project's journal and lesson card. `agent-os update` reports which upstream issues the new version closes, so local workarounds can be retired.
- `upstream.enabled: false` disables network contact; drafts go to a file.

## Consequences
Improvements flow from real use into the package's backlog with a traceable link back, and private projects can take part safely.
