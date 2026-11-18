---
areas: [i18n, cli]
paths: ["src/**/*.yaml", "catalog/**", "templates/**"]
keywords: [yaml, typing, hex, colors, quoting]
source: "#11: label color 000000 parsed as the number 0 by the YAML subset"
confidence: high
upstream: "#101"
---

In YAML, a hex color made only of digits (`000000`, `123456`) is a number, not a string. Quote values that are identifiers rather than quantities (colors, versions, ids, zip codes). Code that reads them should still coerce defensively.
