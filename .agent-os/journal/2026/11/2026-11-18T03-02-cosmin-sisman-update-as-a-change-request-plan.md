---
type: decision
refs: ["#68", "#27", "#17"]
areas: [updates]
author: cosmin-sisman
---

# Update as a change request: plan, branch, migrate, apply, verify

`agent-os update --plan` and `agent-os update` implement the flow from design §19.

Decisions:
- The target is the version being run (`npx …@<version> update`) and the start is the pin. That makes "which version" explicit and leaves no network lookup inside the CLI.
- Grouped changes come from two sources: a new `changelog.yaml` shipped in the package (breaking, fixes, chore, written at release by #17), and the lifecycle states in `manifest.json` (new, deprecated, legacy, removed).
- All writes happen on `chore/agent-os-<version>`, cut from `origin/<integration>`. The person ends up back where they started. If something fails before the commit, the branch stays checked out so it can be inspected. Rollback is closing the PR.
- .rej files are committed on the update branch so reviewers see them, and each one is an unchecked Before merge item, so /ship refuses to merge until they are resolved. The PR opens as a draft when there are conflicts or the gate fails.
- `--channel next` applies a pre-release without changing the pin. Running a pre-release without that flag is refused.
- `doctor` (#27) is not built yet, so preflight checks the clean tree, the version direction and Node, and doctor will join it.
- The tests run against a real git fixture with a local bare remote and a fake tracker. Nothing leaves the temporary directory, and no update PR was opened on a real repository.
