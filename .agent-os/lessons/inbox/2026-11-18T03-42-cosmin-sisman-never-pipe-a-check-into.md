---
areas: [cli, skills]
paths: [".claude/skills/**", "templates/core/.claude/skills/**"]
keywords: ["exit code", pipe, pipefail, "check title"]
source: "PR #163: a failing check title piped into head -1 let the commit through"
confidence: high
---

Never pipe a check into another command when its exit code decides what happens next: `agent-os check title … | head -1 && git commit` commits even when the check fails, because the pipeline returns the status of `head`. Check the exit code first (run the check on its own, or use `set -o pipefail`), then trim the output. Example: PR #163 went out with a 75-character title.
