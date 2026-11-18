---
type: decision
refs: ["#11", "#28"]
areas: [platform, github]
author: cosmin-sisman
---

# setup completes labels and milestones, never replaces them

This applies the rule from the ruleset incident (#159) to labels and milestones too.

- An existing label's color is never changed.
- A description someone wrote stays. A description agent-os wrote (in any language) may follow the labels language, and an empty one is filled in.
- Renaming a label (for example when switching labels to ro) sends only the new name, plus our description when the old one was ours, so the label stays on its issues with its color.
- Renaming a milestone keeps its issues, its due date and a description someone wrote.
- Differences that are left alone are listed as "keep label X as it is: …", so the dry run names what stays.

On this repository the old dry run (posted on #11) said "would update label security: color or description", which would have overwritten its own description. The new one keeps it.
