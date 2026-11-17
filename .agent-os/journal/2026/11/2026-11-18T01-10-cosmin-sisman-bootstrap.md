---
type: decision
refs: ["#1", "#10", "#21", "#31", "#37", "#42", "#47", "#56"]
areas: [github, knowledge, loop]
author: cosmin-sisman
---

# Repository bootstrapped from the design

The repository was created public, with `development` as the default branch and `main` as the release branch. The setup script created 31 labels, 8 milestones (v0.1 to v1.0) and 62 issues: 8 epics, with every feature issue a sub-issue of its epic and blocked by its prerequisites through GitHub's dependencies API. GitHub Projects v2 is not set up yet, because the token lacks the `project` scope (#20).

Requirements recorded from the owner: per-area languages (`en`, or `ro` without diacritics), separate indexing of core, external and local skills, no committed file index, a self-improvement loop with no exceptions, at least five people on their own laptops, init for new and existing repositories (retrofit or forward-only), `/next`, complete tickets with several labels, `development` as default, `/gh-actions` and `/test`, conflict-free history files, lessons learned with recall, and an MCP and environment check.
