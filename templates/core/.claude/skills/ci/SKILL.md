---
name: ci
description: Write or review CI the way best practice asks (least-privilege permissions, pinned actions and images, timeouts, concurrency, no untrusted input in scripts, pull_request_target and OIDC rules), for {{vocab.platform}}. Use when someone adds or changes a workflow or pipeline, asks whether CI is safe, or a check behaves strangely.
argument-hint: "review [<file>…] | write <what the job does>"
---

# /ci: workflows that are safe by default

{{#if slots.ci}}This project binds the `ci` slot to `{{slots.ci}}`: use that skill to write the jobs, then review them here.{{/if}}

## review

```
agent-os ci review                 # every CI file in the repository
agent-os ci review <file>… [--strict]
```

- **Errors** must be fixed before the {{vocab.changeRequest}}: injection, unpinned actions or images, missing permissions, `pull_request_target` running the PR's code, `only`/`except`.
- **Warnings** are fixed, or the description says why not.
- **Notes** are suggestions.

The review only reads. Fixing a workflow is a change like any other, on its own branch.

## write

Start from the checklist (`agent-os ci checklist`) and the jobs agent-os generates (gate, loop, retro):
- **Permissions:** the least, at the top (`contents: read`), widened only on the job that needs more. `id-token: write` only where OIDC replaces a stored secret.
- **Pin every third-party action** to its full commit SHA, with the version in a comment. Images name a version, and a digest where the registry allows it.
- **Untrusted input never goes into `{{{expr.open}}} {{{expr.close}}}` inside `run:`:** titles, bodies, branch names, commit messages. Pass it through `env:` and use `"$VAR"`. On GitLab, quote `$CI_MERGE_REQUEST_TITLE` and similar variables, and never `eval` them.
- **Every job has a timeout.** Change-request workflows cancel superseded runs (`concurrency`, `interruptible: true`).
- **`actions/checkout` uses `persist-credentials: false`** unless a step pushes.
- **Self-managed:** use `ci.image` and `ci.tags` from `agent-os.json`, and the internal registry (`npmRegistry`).
- **Lint before pushing:** actionlint on GitHub, `glab ci lint` on GitLab. Then run `agent-os ci review` on the files you changed.

## Learn

A CI mistake the review did not catch is a lesson: `agent-os lessons add`, then propose the rule upstream with `/upstream`.
