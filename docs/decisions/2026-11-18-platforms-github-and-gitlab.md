# GitHub and GitLab, through adapters and capability probing

Status: accepted · amends [GitHub as the coordination layer](2026-11-18-github-as-coordination-layer.md)

## Context
Many teams, especially in companies, run GitLab: gitlab.com or a self-managed instance on their own infrastructure. A package that only speaks GitHub excludes them. The two platforms share concepts (issues, labels, milestones, branches, change requests, CI) but differ in names, paths, APIs and features. On GitLab, features also depend on the tier and the instance version.

## Decision
- `platform.type` is `github` or `gitlab`, with an optional `host` for GitHub Enterprise Server and GitLab self-managed or Dedicated, and an optional private CA. `init` detects it from the git remote and confirms. Authentication is delegated to `gh` and `glab`.
- One tracker adapter interface, with a GitHub and a GitLab implementation. Skills depend on **capabilities** (sub-items, dependencies, exclusive labels, multiple assignees, boards, pages, …), never on the platform's name.
- `agent-os platform probe` discovers capabilities from the live instance and caches them. Every capability has a documented fallback, so a lower GitLab tier or an older version degrades gracefully instead of failing.
- Platform-specific templates live in separate routes (`templates/platform/github`, `templates/platform/gitlab`). The lock records the platform, and only that route is installed and updated. Vocabulary follows the platform: `/mr` and `!N` on GitLab, `/pr` and `#N` on GitHub.
- Self-managed is first-class: private CA, proxies, air-gapped install, version-gated features, runner tags. `/upstream` is off by default on self-managed hosts.
- `/gh-actions` becomes `/ci`, covering GitHub Actions and GitLab CI.

## Consequences
The package fits company environments that GitHub-only tools cannot serve. Each new feature must state its capability and its fallback, and the test matrix grows to include a GitLab instance.
