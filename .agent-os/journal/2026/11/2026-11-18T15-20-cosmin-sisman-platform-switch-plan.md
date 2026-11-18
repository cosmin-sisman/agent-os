---
type: note
refs: ["#98"]
areas: [platform]
author: cosmin-sisman
---

# Platform switch: the plan and a fixture, no apply yet

`agent-os platform switch --to <platform> --project … --plan` compares the install plan for both platforms. It lists:
- the old route's managed files to remove, using the lock's hashes; files edited by hand are conflicts and are never deleted;
- the new route's files to add, and the core files to rewrite;
- the `.gitlab-ci.yml` with its includes when moving to GitLab;
- the team's own files to port by hand;
- the configuration keys that change, and the journal references to re-link from the importer's map.

It exits 1 until nothing from the old route would remain. Applying it on one branch as one change request is left for later, as agreed for #98. The fixture `src/platform/__fixtures__/switch-github/` is a GitHub project with its own CI, a journal entry and an importer map.
