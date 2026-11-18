# CI review: `agent-os ci` and `/ci`

Workflows run with the repository's tokens, so a small mistake becomes a security hole. `/ci` writes CI by a checklist, and `agent-os ci review` checks it. The review only reads; it never changes a file.

```sh
agent-os ci review                     # .github/workflows/*.yml, .gitlab-ci.yml, .gitlab/*.yml
agent-os ci review <file>… [--strict]  # --strict: warnings fail too
agent-os ci checklist                  # every rule, with its level
```

Exit codes: 1 on any error (or any warning with `--strict`), otherwise 0. Notes never fail.

## GitHub Actions

| Rule | Level | What |
|---|---|---|
| `gh-injection` | error | untrusted input inside `${{ }}` in `run:`: issue, PR, comment and review titles and bodies, `github.head_ref`, head commit messages, `inputs.*`. Pass it through `env:` and use `"$VAR"` |
| `gh-permissions` | error | no top-level `permissions:`, or `write-all` |
| `gh-pin-actions` | error | an action or reusable workflow not pinned to a full commit SHA (local `./` actions and `docker://…@sha256:` are fine) |
| `gh-pr-target` | error | `pull_request_target` checking out the pull request's head |
| `gh-timeout` | warn | a job without `timeout-minutes` |
| `gh-concurrency` | warn | a pull request workflow without `concurrency` |
| `gh-persist-credentials` | warn | `actions/checkout` without `persist-credentials: false` |
| `gh-secrets-in-run` | warn | `${{ secrets.X }}` inside `run:` |

## GitLab CI

| Rule | Level | What |
|---|---|---|
| `gl-injection` | error | `$CI_MERGE_REQUEST_TITLE`, `$CI_COMMIT_MESSAGE` and other user-controlled variables used unquoted, or passed to `eval`/`sh -c` |
| `gl-rules` | error | `only:`/`except:` instead of `rules:` |
| `gl-image-tag` | error | an image with no version, or `latest` |
| `gl-include-ref` | error | `include: remote`, or `include: project` without `ref` |
| `gl-timeout` | warn | a job without `timeout:` (and no default) |
| `gl-interruptible` | note | a merge request job that is not `interruptible: true` |
| `gl-image-digest` | note | an image pinned by tag, not digest |

Every workflow agent-os generates (gate, loop, retro, on both platforms, with and without `ci.image`/`ci.tags`/`npmRegistry`) passes its own review with no errors or warnings. A test keeps it that way, and keeps this repository's own workflows clean.

The YAML parser reads block scalars (`run: |`) verbatim, as real workflows use them.

## The labels workflow (opt-in)

With `"ci": { "labels": true }`, install adds a workflow that keeps the platform's labels in step with agent-os.json and stack.yaml. It runs `agent-os setup --only labels`, which completes labels and never replaces or deletes them.

**GitHub** (`.github/workflows/agent-os-labels.yml`):
- **preview**, on `pull_request` (never `pull_request_target`): it uses the read-only workflow token (`issues: read`) and **no secret**, and writes what would change to the job summary.
- **apply**, on a push to the integration branch: the only job that may write labels. It has `issues: write` and runs only there. It uses `AGENT_OS_LABELS_TOKEN` when the organization makes the workflow token read-only, else the workflow token. `ci.labelsEnvironment` puts it in a deployment environment, to require approval or to scope the secret.

**GitLab** (`.gitlab/agent-os-labels.yml`, included from `.gitlab-ci.yml`):
- **preview**, in merge request pipelines: it reads labels with `AGENT_OS_LABELS_READ_TOKEN` (a `read_api` token) when set, otherwise it skips. It never writes.
- **apply**, only on a push to the protected integration branch (`$CI_COMMIT_REF_PROTECTED`): it uses `AGENT_OS_LABELS_TOKEN`, a project access token with the `api` scope stored as a **protected, masked** CI variable. The job token cannot write labels.

The user creates and stores the tokens; agent-os never does. Without a token, a job says which one is missing and changes nothing. Both workflows pass `agent-os ci review`.
