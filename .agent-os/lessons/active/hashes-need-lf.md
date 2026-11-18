---
areas: [artifacts, ci]
paths: [".gitattributes", "artifacts/**", "scripts/site/**"]
keywords: [crlf, windows, sha256, stale]
source: "#2, CI matrix with windows-latest"
confidence: likely
recalled: 0
followed: 0
---

Anything that records content hashes (artifact sources, the lock file) breaks on Windows checkouts that convert line endings. Pin `* text=auto eol=lf` in `.gitattributes` from the first commit, and `agent-os init` should add it to every project it installs into.
