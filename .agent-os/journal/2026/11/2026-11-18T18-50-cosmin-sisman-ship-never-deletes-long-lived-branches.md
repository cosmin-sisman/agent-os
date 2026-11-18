---
type: lesson
refs: ["#243", "#241", "#242"]
areas: [loop]
author: cosmin-sisman
---

# Ship never deletes a long-lived branch or the source of a sync

After #241 the sync comes from `main`, and `ship --dry-run` on it announced "delete the branch main". The real clean-up already refused long-lived branches, but the preview said otherwise, and a sync from `release/*` would have lost its branch. `keepReason` is now the one rule behind both the preview and the clean-up: no delete when the head is the integration or production branch, or when the pull request is a sync. The release finish preview now names the real sync (production into integration).
