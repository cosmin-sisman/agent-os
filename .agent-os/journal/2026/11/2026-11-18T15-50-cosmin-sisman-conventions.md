---
type: decision
refs: ["#19", "#15", "#16"]
areas: [github, ci]
author: cosmin-sisman
---

# Title and commit conventions, checked in CI

`agent-os check title|commit` checks a title against its description in both directions: every closed or referenced issue must be in the `[#…]` suffix, and every issue in the suffix must be closed or referenced. It names each problem and proposes a corrected title when one can be built. The limits and types are configuration, and syncs and dependency bots are exempt by default.

Decisions:
- The repository's CI gained a `pr-title` job inside the required `ci` check. Title and body reach the script only through environment variables, never interpolated into it, which is the standard defence against script injection from PR text. The aggregator now accepts "skipped", because pr-title does not run on pushes.
- The past PR titles in this repository (#129, #130, #140, #144, #147) all pass the new check.
- /pr (#15) and /ship (#16) will call the same function before opening and before merging.
