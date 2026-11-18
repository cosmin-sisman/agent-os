---
type: decision
refs: ["#253", "#250"]
areas: [ci]
author: cosmin-sisman
---

# CI: macOS runs on pushes only

Even the single macOS job left on pull requests by #250 waited past its timeout without a runner (#252), so the problem is macOS runner availability, not the number of jobs. Pull requests now run Linux and Windows on Node 22, 24 and 26 (6 jobs). A push to `development` or `main` runs all 9, so a macOS regression shows in the push run right after the merge and is fixed with a follow-up change request.
