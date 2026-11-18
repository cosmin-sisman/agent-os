---
type: release
refs: ["#1", "#2", "#3", "#4", "#5", "#6", "#7", "#8", "#9", "#63", "#99"]
areas: [cli]
author: cosmin-sisman
---

# Epic #1 (Foundations) complete

All ten sub-issues are merged: CI (#2), the CLI runner and registry (#3), configuration (#4), templates (#5), managed files (#6), languages (#7), the hooks runner (#8), the environment check (#9), the YAML subset (#63) and `init --me` (#99). The design is brought in line with what was built (the merge bases in `.agent-os/base/`, unchecked plugins). Deviations recorded along the way: the Node floor is 22, not 20 (#2), and personal commands never edit `.gitignore` (#99).

The v0.1 milestone has nothing left open. It is closed by the first release (`/release`), not by hand.
