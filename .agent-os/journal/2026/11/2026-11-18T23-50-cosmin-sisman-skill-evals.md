---
type: note
refs: ["#59"]
areas: [testing]
author: cosmin-sisman
---

# Skill evals: fixture repositories and deterministic scenarios

The four repository states are generated per run, as real git repositories with dated commits, so nothing large is committed. Six scenarios check that the skills stop where they must: profiles detected right, a destructive migration makes release ask, contradicting specs block ingest, discover cites evidence and writes nothing. They also measure map against reading an area (1 step instead of 53, about 775 tokens instead of 15,000) and recall against the whole lesson store (3 of 30, about 78 tokens instead of 425). They run in npm test on every change request and push. The `evals` workflow runs them on demand: it has no schedule, by this repository's rule. Model-driven scenarios are listed and never reported as run.
