---
type: incident
refs: ["#28", "#11"]
areas: [platform, github]
author: cosmin-sisman
---

# setup would have replaced existing ruleset rules

Found in review of the #28 dry run, before anything was applied. When it updated an existing ruleset, `setup` replaced every rule type it also wanted with its own version. The live check `ci` would have lost its `integration_id` (15368), and the `pull_request` rule would have lost parameters such as `allowed_merge_methods`. The dry-run message also listed the whole desired set of checks as if all of them were being added.

Fix: an existing ruleset is only ever completed. Rules and checks it already has stay exactly as they are; missing rule types are appended, and missing checks are appended to the existing list. The message now says "required checks: ci (existing) + agent-os/loop (new); other rules and checks are kept as they are". A test reproduces the live ruleset.

Lesson: an "update" of someone else's configuration object must merge, never replace, and its dry run must name what stays as well as what changes.
