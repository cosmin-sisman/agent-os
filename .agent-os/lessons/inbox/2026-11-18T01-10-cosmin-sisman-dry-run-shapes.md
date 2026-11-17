---
areas: [cli]
paths: ["scripts/**", "bin/**", "src/**"]
keywords: [dry-run, stub]
source: "scripts/github/setup.mjs, first dry run"
confidence: high
---

A `--dry-run` stub must return the same shape as the real call (an empty array for a list, not `{}`). Otherwise the dry run crashes where the real run would work, and the dry run stops being trusted.
