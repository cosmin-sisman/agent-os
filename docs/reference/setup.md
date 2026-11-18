# Platform setup

`agent-os setup` makes a repository ready on its platform. It shows the plan first, and `--dry-run` stops there.

```bash
agent-os setup --dry-run                 # what it would change, remote and local
agent-os setup                           # apply
agent-os setup --only labels,milestones  # areas: branches, ruleset, labels, milestones, files
agent-os lang set labels ro              # switch the labels language and rename them in place
```

| Area | On GitHub |
|---|---|
| branches | creates the integration branch (`branches.integration`, default `development`) from the production branch if it is missing, and makes it the **default branch**, so `Closes #N` closes issues when a PR merges |
| ruleset | protects both branches: no direct pushes (pull requests only), no force pushes, no deletion, review threads resolved, `branches.requiredApprovals`, and `branches.requiredChecks` plus `agent-os/loop` ([loop check](loop.md)) as required status checks. Admins can still merge through a pull request. A ruleset that already covers both branches is reused and completed, never duplicated |
| labels | creates the core labels from the dictionary in the `labels` language, and updates their color and description. Switching language **renames** them, so they stay on their issues. Other labels are left alone |
| milestones | makes sure the rolling milestone (`Stage 0 - Release N (in progress)`) exists, numbered after the last release, and renames it when the `milestones` language changes |
| files | installs the platform route (issue templates, the PR template, skills) as managed files (see [managed files](managed-files.md)) |

Running it again changes nothing once the repository is set up. Planning only reads from the platform; nothing is sent until a step is applied. GitLab setup is #93.

## On GitLab

`agent-os setup` does the same on GitLab (gitlab.com or self-managed, through `glab api`). It completes what exists and never replaces it.

| Area | On GitLab |
|---|---|
| branches | creates the integration branch from production and makes it the default branch |
| ruleset | protects both branches (no direct push, merges by developers and maintainers, no force push); turns on *pipelines must succeed* (so `agent-os/loop` and your CI gate merges) and *all threads must be resolved*; adds an approval rule for `branches.requiredApprovals` on Premium, and only notes it on Free. A branch that is already protected differently is kept and reported |
| labels | scoped labels (`type::bug`, `tip::bug` in ro), so a group allows one label at a time. Existing `type:bug` or other-language labels are renamed in place and stay on their issues; colors and descriptions someone wrote stay |
| milestones | the rolling milestone, created or renamed into the milestones language (issues, due date and description stay) |
| files | `.gitlab/issue_templates/`, `.gitlab/merge_request_templates/` and `.gitlab/agent-os-loop.yml` in the configured languages |
