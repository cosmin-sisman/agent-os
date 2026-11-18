---
areas: [cli]
paths: ["src/config/**"]
keywords: [schema, personal, validation, inheritance]
source: "#4, failing test on the first run"
confidence: high
---

When a schema marks ownership (personal or team) on some nodes, every leaf must resolve its owner from the nearest marked ancestor, with an explicit default for unmarked leaves. Checking the flag only where it is written lets team keys slip into the personal file. A test that tries each wrong-file case caught it.
