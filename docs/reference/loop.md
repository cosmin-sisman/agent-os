# The loop check: `agent-os/loop`

The self-improvement loop has no exceptions, so it can't depend on hooks on someone's laptop: it runs in CI on every change request. Decision: [self-improvement loop](../decisions/2026-11-18-self-improvement-loop.md).

```bash
agent-os check loop --body-file body.md [--base development] [--author ana]
agent-os check loop --from-ci     # in CI: reads the GitHub event file or the GitLab merge request variables
```

It passes when all of these hold:

| Rule | Passes | Fails |
|---|---|---|
| Lessons | `## Lessons` (`## Lectii` in ro) says something: a lesson, or `None: <why>` | missing, empty, only the template comment, or a bare `None` |
| Journal | the branch adds an entry under `.agent-os/journal/`, or Lessons says `None: <why>` (a trivial change) | a lesson or decision with no journal entry |
| doctor | `agent-os doctor --ci` has no failure | any FAIL, with its fix |

Change requests from dependency bots (`dependabot[bot]`, `renovate[bot]`, `github-actions[bot]`) are exempt; the release entry records their changes.

## In CI

agent-os installs the workflow for the platform:

- GitHub: `.github/workflows/agent-os-loop.yml`, a job named `agent-os/loop` on every pull request event (including `edited`, so fixing the description reruns it).
- GitLab: `.gitlab/agent-os-loop.yml`; include it from `.gitlab-ci.yml` (`include: - local: .gitlab/agent-os-loop.yml`). It runs in merge request pipelines.

Both check out the full history (`fetch-depth: 0` / `GIT_DEPTH: 0`) so the branch can be compared with its target. They read the description from the event and never interpolate it into a script. They run the pinned version.

`agent-os setup` adds `agent-os/loop` to the required checks of the branch ruleset (GitHub), next to `branches.requiredChecks`, so a change request whose loop check fails cannot merge.
