---
type: decision
refs: ["#15", "#43", "#33", "#24"]
areas: [skills, testing]
author: cosmin-sisman
---

# /pr: open only when ready; the gate selects suites by path

`agent-os pr preflight|create|status|threads|reply` and `agent-os gate`. The /pr skill (/mr on GitLab) runs the review, the journal entry, the gate, the body and the opening, then watches the checks and answers review threads in their language.

Decisions:
- The gate is defined once: `gate` (suite → command) stays as it was, and a new `gatePaths` key maps globs to suites. Adding a key instead of reshaping `gate` keeps the manifest item `config:gate.<name>` stable, so no deprecation was needed.
- "Never opens with a failing check" is enforced through the saved gate result. `pr create` refuses unless the gate passed on exactly the current commit with a clean tree, so a result from an earlier commit or a dirty tree cannot slip through. CI checks after opening are followed with `pr status --watch`.
- The Lessons section must be non-empty, and "None" alone is refused: it has to be "None: <why>".
- The issue's type and area labels are copied to the PR through the issues endpoint (`gh pr edit` fails here because of the classic Projects GraphQL).
- This PR covers the gate's selection and run. The generated CI workflow and the local/CI parity stay with #43. The overlap warning (#33) and lessons recall (#24) will be added to /pr when they exist.
- This repository has no agent-os.json yet, so this PR was opened with gh and not with `agent-os pr create`.
