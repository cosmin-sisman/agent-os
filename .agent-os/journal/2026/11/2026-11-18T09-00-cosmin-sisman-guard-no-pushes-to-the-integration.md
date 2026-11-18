---
type: lesson
refs: ["#50"]
areas: [hooks, workflow]
author: cosmin-sisman
---

# Guard: no pushes to the integration or production branch

Work for #50 was written while the integration branch was still checked out, because the issue had not been claimed first. The push that followed would have updated development directly; a permission check stopped it before it ran. A built-in guard, push-protected, now refuses any push that would update the integration or production branch, whether named, --all or --mirror, or implied by pushing HEAD while on it, and points to agent-os start. Feature branches and tags push as before, and the CLI's own pushes of working branches are not affected. The lesson, to claim and switch before the first edit, is in the inbox for /retro.
