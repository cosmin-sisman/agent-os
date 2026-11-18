---
areas: [gate, security]
paths: ["src/gate/**"]
keywords: [shell, injection]
source: "#117 review: gateAffected.command"
confidence: medium
---

Values read from the repository (package names, paths, ids) must never be put into a shell command unchecked: a branch can set them, so validate them against a strict allowlist and refuse anything else (the gate's {path} could have held '; touch pwned').
