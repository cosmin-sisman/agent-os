---
type: note
refs: ["#76"]
areas: [stack]
author: cosmin-sisman
---

# Stack changes as decisions: in-place edit, comparison, proposed issues

`stack set` and `stack status` treat a layer change as an architecture decision. stack.yaml is edited textually, only the one key, so comments and layout survive; the result is re-parsed and the change refused if it did not land. A proposed decision record carries the catalog comparison of the old and new choice, and the follow-up issues (migration, adoption, removal, the provider's environment) are proposed in the output, never created by the command. Layer overrides of provider or language are kept, so the comparison shows what will really apply.
