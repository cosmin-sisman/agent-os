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
