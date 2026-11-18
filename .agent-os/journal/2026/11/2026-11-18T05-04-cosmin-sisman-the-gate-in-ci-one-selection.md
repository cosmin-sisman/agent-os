---
type: decision
refs: ["#43", "#15", "#28"]
areas: [testing, ci]
author: cosmin-sisman
---

# The gate in CI: one selection, read from the event

`agent-os gate --from-ci` and the gate workflows for GitHub and GitLab.

Decisions:
- CI uses the same `runGate` and `selectSuites` as a laptop. Only the base branch changes, and it comes from the event (GitHub event file or GitLab merge request variables), never from interpolated text. The same diff therefore selects the same suites, which is the acceptance criterion; a test runs both paths on one diff.
- A push to the integration or production branch runs every suite, because there is no change request to compare against.
- Reading the CI event moved to src/ci/event.mjs, shared by the loop check and the gate.
- This repository runs an `agent-os/gate` job outside the `ci` aggregator. With no agent-os.json here it selects no suite, but it exercises the event reading and the job summary end to end. Adopting agent-os in this repository, and making the check required, are the owner's decisions.
