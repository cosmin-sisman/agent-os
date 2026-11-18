---
type: decision
refs: ["#91", "#92", "#93", "#13"]
areas: [platform]
author: cosmin-sisman
---

# Capabilities instead of platform names

`agent-os platform probe` builds a capability map (subItems, dependencies, exclusiveLabels, multipleAssignees, board, pages, branchRules, linkedBranches) and caches it for 24 hours. Every entry carries where its value came from: known, probed, inferred, config or unknown.

Decisions:
- GitLab's tier is inferred from what answers (group epics, push rules) rather than from the license API, which needs admin rights. Premium-only capabilities are marked "inferred", not "probed", so nobody mistakes an inference for a fact.
- Unknown counts as missing, so an unreachable or unauthenticated instance falls back to the safe behaviour instead of failing or guessing.
- The fallbacks are actions, not prose: `planBlockedBy`, `planParent` and `planAssignees` return the steps a skill performs. /ticket (#13) and the GitLab adapter (#92) consume them.
- An architecture test (`src/platform/no-platform-branching.test.mjs`) fails the build when a command or skill template checks the platform's name outside the platform modules. I made it fail once on purpose to prove it works.
