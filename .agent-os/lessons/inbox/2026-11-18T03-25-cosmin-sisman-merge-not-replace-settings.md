---
areas: [platform, github]
paths: ["src/platform/setup-*.mjs", "scripts/github/**"]
keywords: [ruleset, settings, update, integration_id, merge]
source: "#28 dry run review: setup would have replaced the live ruleset's rules"
confidence: high
---

When updating a platform setting that already exists (a ruleset, branch protection, a label), merge into it and keep every field you did not mean to change. Replacing it with your desired version drops what the platform or the owner added, such as an `integration_id` or `allowed_merge_methods`. The dry run should say what is kept as well as what is new.
