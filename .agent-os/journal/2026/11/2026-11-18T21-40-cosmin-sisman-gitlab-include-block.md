---
type: note
refs: ["#233"]
areas: [platform, ci]
author: cosmin-sisman
---

# GitLab: the agent-os jobs are wired into .gitlab-ci.yml

On GitLab, agent-os installed `.gitlab/agent-os-*.yml`, but nothing included them, so the loop and gate never ran until someone edited `.gitlab-ci.yml` by hand. Install now writes a managed `include` block. A placer puts it inside the project's own top-level `include:` list, so the key is never duplicated and the team's file stays byte for byte, or adds an `include:` when there is none. An include written as a string, a map or another indentation is a conflict with a `.rej`, never a rewrite. Updates touch only the block. The platform switch plan previews the same block with the same placer.
