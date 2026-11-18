---
name: {{vocab.crSkill}}
description: Open a {{vocab.changeRequest}} for the current branch with the checks run, the journal entry and the Lessons section. Use when a change is done.
argument-hint: "[issue number]"
---

# /{{vocab.crSkill}}: {{vocab.changeRequest}} with the checks done

Issue: $ARGUMENTS

The full procedure arrives with #15. Until then:

1. Run the checks the change needs (`npm test` or the project's equivalent) and record the real results.
2. Write the journal entry in `.agent-os/journal/` and commit it with the change.
3. Open the {{vocab.changeRequest}} with `{{vocab.cli}}`, using the template: what, why (`Closes {{vocab.issueRef}}N`), how it was tested, lessons.
4. Refer to it as `{{vocab.crRef}}N`.
