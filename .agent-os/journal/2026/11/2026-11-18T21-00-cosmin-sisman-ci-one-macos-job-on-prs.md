---
type: decision
refs: ["#250"]
areas: [ci]
author: cosmin-sisman
---

# CI: one macOS job on pull requests, the full matrix on push

macOS jobs on pull requests kept waiting past their timeout without ever getting a runner, and each time the change request needed a rerun (#246, #249). On `pull_request`, the matrix now leaves out macOS on Node 24 and 26 through an `exclude` computed from the event. Linux and Windows keep Node 22, 24 and 26, and a push to `development` or `main` runs all nine jobs. The `ci` aggregator needs the test job as a whole, so it passes with the smaller matrix. The required checks are unchanged.
