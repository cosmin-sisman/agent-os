---
type: lesson
refs: ["#232", "#98"]
areas: [loop]
author: cosmin-sisman
---

# Ship watches referenced issues after the merge

#98 was closed one second after `ship` commented "stays open" on it. Its branch had been created with `gh issue develop`, which links the branch, and so the pull request, to the issue. GitHub closes linked issues on merge into the default branch, but asynchronously. Ship checked too early. Ship now watches the issues it only references for a short, bounded time after the merge (4 looks, 1.5 s apart) and reopens one the platform closed, with its comment. The Done status on the board came from the project's automation, after the close. That automation is the owner's and is unchanged.
