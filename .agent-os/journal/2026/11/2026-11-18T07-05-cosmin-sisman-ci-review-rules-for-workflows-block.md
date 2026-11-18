---
type: note
refs: ["#45"]
areas: [ci]
author: cosmin-sisman
---

# CI review: rules for workflows, block scalars in the YAML parser

CI is reviewed by rules, not by eye: `agent-os ci review` reads GitHub workflows and GitLab CI files and reports injection (untrusted `${{ }}` in `run:`, unquoted or evaluated `$CI_MERGE_REQUEST_TITLE`), missing permissions, unpinned actions and images, `pull_request_target` running the PR's code, timeouts, concurrency and credentials. Errors fail; warnings fail only with --strict. To read real workflows, the YAML parser now supports block scalars (| and >, with chomping), taken verbatim before comments and blank lines are processed, so the rest of the parser did not change. Generated workflows gained concurrency (GitHub) and timeouts with interruptible (GitLab), and a test keeps every generated variant and this repository's own workflows free of errors and warnings.
