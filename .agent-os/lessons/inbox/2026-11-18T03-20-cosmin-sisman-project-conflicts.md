---
areas: [github, platform]
paths: ["scripts/github/**", "src/platform/**"]
keywords: [projects-v2, graphql, retry, conflict]
source: "scripts/github/project.mjs, first run"
confidence: high
---

GitHub Projects v2 answers bursts of item mutations with "temporary conflict, please try again". Every project mutation in the adapter needs a retry with exponential backoff, and the retry must not create duplicates (adding an item that already exists returns the existing item).
