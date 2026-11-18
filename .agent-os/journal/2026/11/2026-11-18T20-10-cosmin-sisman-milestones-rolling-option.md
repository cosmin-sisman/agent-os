---
type: decision
refs: ["#248"]
areas: [loop]
author: cosmin-sisman
---

# milestones.rolling: a project that plans with its own milestones keeps them

`release finish` and `setup` always kept a rolling "Stage 0 - Release N" milestone. At both releases of this repository it was created and then deleted by hand, because the project plans with v0.x milestones. The new key `milestones.rolling` (default true, so existing projects are unchanged) turns that off. Release finish then neither closes nor opens a milestone, setup creates none, and a release is numbered from the release tags (`release-N`, as the title convention expects). This repository sets it to false.
