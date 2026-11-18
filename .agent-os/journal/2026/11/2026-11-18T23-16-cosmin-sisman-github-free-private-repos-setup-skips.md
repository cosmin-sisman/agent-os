---
type: decision
refs: ["#274"]
areas: [platform, doctor]
author: cosmin-sisman
---

# GitHub Free private repos: setup skips protection with a note; doctor warns

On a private repository on GitHub Free, the rulesets API answers 403 "Upgrade to GitHub Pro or make this repository public to enable this feature". Branch protection is not available either. The setup plan threw on that answer, and the owner's install lost the whole platform plan, labels, milestones and branches included.

Now:
- That answer, and only that one, becomes a `keep` step marked `unavailable`. It explains that only the local hooks and the required CI checks remain, and that without protection a failing check does not block a merge. Any other error still stops the plan.
- A new repository with only its first-pushed branch gets the other long-lived branch created from it. With no branch on GitHub at all, the plan says to push the first commit first.
- doctor has a platform check, `protection`. It warns, never fails, when protection is unavailable or not set up as agreed, and names the fix.

Choice: detect the plan limit from the API's own answer, not from the repository's visibility and the account's plan. The answer is what decides, it costs no extra call, and it stays right if GitHub changes which plans include rulesets.
