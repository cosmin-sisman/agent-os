---
areas: [testing]
paths: ["src/**/*.test.mjs", "src/**/__fixtures__/**"]
keywords: ["node:test", helpers, fixtures, "duplicate tests"]
source: "#9 and #90: a command test imported a helper from another *.test.mjs file"
confidence: high
upstream: "#101"
promotedTo: "docs/rules.md: Tests"
retired: 2026-11-18
retiredBecause: "promoted to docs/rules.md: Tests"
---

Never import from a `*.test.mjs` file: node:test registers that file's tests again in the importer, so they run twice and failures are reported twice. Shared test helpers go in `__fixtures__/` next to the code (excluded from the package). Twice is a pattern, so this should become a rule in the standards (#101).
