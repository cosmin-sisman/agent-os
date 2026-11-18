---
type: decision
refs: ["#2"]
areas: [ci, testing]
author: cosmin-sisman
---

# CI for agent-os itself; Node 22 is the floor

Every PR now runs `ci`: `npm test` and the artifact site build in strict mode (it fails on stale artifacts), on Linux, macOS and Windows with Node 22, 24 and 26, plus actionlint pinned by image digest. One aggregating job, `ci`, is the single required check, so the matrix can change without touching the ruleset.

Decision: the Node floor moves from 20 to 22. Node 20 reached end of life in April 2026, and supporting it would mean testing on an unpatched runtime. The design, CONTRIBUTING and the README badge are updated.

The first tests guard the repository's own rules: the GitHub plan must give every issue exactly one type and one priority, at least one area, a known milestone, epics as parents and no dependency cycles. The site builder gains tests for parsing, staleness and the build.
