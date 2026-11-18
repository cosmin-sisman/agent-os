# Decision records

One file per decision, named `<YYYY-MM-DD>-<slug>.md`. The id is the date plus a slug, never a running number, so two branches can add decisions at the same time without colliding.

Each record has: **Status** (proposed · accepted · superseded by …), **Context**, **Decision**, **Consequences**. A record is never rewritten after it is accepted: a change is a new record that supersedes it.

| Record | Decision |
|---|---|
| [managed-files-and-lock](2026-11-18-managed-files-and-lock.md) | installed files are tracked by hash; updates merge, never clobber |
| [language-per-area](2026-11-18-language-per-area.md) | `en` or ASCII `ro`, chosen per area |
| [github-as-coordination-layer](2026-11-18-github-as-coordination-layer.md) | teams coordinate on GitHub; personal state stays local; CI enforces |
| [skill-registry-and-slots](2026-11-18-skill-registry-and-slots.md) | core, external and local skills registered separately; core calls slots |
| [integration-branch-is-default](2026-11-18-integration-branch-is-default.md) | `development` is the default branch so `Closes #N` works |
| [no-committed-file-index](2026-11-18-no-committed-file-index.md) | headers + on-demand maps instead of a committed FILES.md |
| [journal-not-memory-file](2026-11-18-journal-not-memory-file.md) | one file per history entry; each PR carries its own |
| [self-improvement-loop](2026-11-18-self-improvement-loop.md) | capture, triage, apply, verify — enforced by a required CI check |
| [init-profiles-and-retrofit](2026-11-18-init-profiles-and-retrofit.md) | four profiles; retrofit or forward-only for existing repos |
| [lessons-learned-store](2026-11-18-lessons-learned-store.md) | lessons as files with a lifecycle; recalled automatically by area and path |
| [environment-check](2026-11-18-environment-check.md) | declared MCP servers, CLIs, scopes and variables, checked locally and in the repo |
| [stack-map](2026-11-18-stack-map.md) | a bilingual catalog and one `stack.yaml`; layers drive labels, gate, env, lessons |
| [artifacts-in-repo](2026-11-18-artifacts-in-repo.md) | visual artifacts versioned in the repo, published to Pages, verified and indexed |
| [upstream-feedback](2026-11-18-upstream-feedback.md) | `/upstream` files improvements on the public repo from any project, privacy-filtered |
| [versions-and-safe-updates](2026-11-18-versions-and-safe-updates.md) | pinned version, lifecycle markers (new, stable, deprecated, legacy, removed), updates through a PR with migrations |
| [platforms-github-and-gitlab](2026-11-18-platforms-github-and-gitlab.md) | GitHub or GitLab (cloud, self-managed), one adapter interface, capability probing with fallbacks, platform routes |
| [audit](2026-11-18-audit.md) | `/audit`: subjects from idea to system, separate lenses, evidence-based findings, artifact + issues |
| [coding-standards](2026-11-18-coding-standards.md) | English code, headers, clarity, a decision procedure between solutions; always on |
| [security](2026-11-18-security.md) | `/security`: relevant advisories, layer-based checks in every change request, threat models and abuse cases, private reporting |
| [system-map](2026-11-18-system-map.md) | `system.yaml` + `/system`: repo shape, components, edges, exposure, endpoint inventory, contract drift and breaking-change alerts |
