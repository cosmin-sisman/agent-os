---
type: decision
refs: ["#33", "#14", "#15"]
areas: [collab, platform]
author: cosmin-sisman
---

# Overlap: who else changes your files, cached by head commit

`agent-os overlap` and its use in /start and /pr.

Decisions:
- Two sources: open change requests (the platform's files API, on both GitHub and GitLab) and pushed branches without one. The branches are compared locally against `origin/<integration>`, which costs no API calls.
- The files are cached by `<number>@<head sha>`. That key never goes stale, so the cache never needs invalidating; only the list has a 10-minute TTL. A cached run over 30 open PRs makes no file calls, which covers the acceptance criterion.
- A folder is written with its trailing slash (`src/db/`) and overlaps everything below it. This lets /start check the paths an issue mentions before any file changes.
- Overlap is a warning, never a block. The fix for overlap is a conversation, not a refusal.
- The reference starts docs/reference/collaboration.md, which #32 continues.
