# agent-os

**A working agreement between people, coding agents and GitHub, installed into any repository with one command.**

agent-os sets up the skills, rules, hooks and small deterministic scripts a team needs to move work from idea to production the same way every time. Several people, each with their own agent sessions on their own laptops, coordinate through GitHub issues, PRs and comments. Every piece of work also feeds a self-improvement loop, so the system keeps up with the project.

> **Status: design phase.** Nothing is published yet. The design is in [docs/design/overview.md](docs/design/overview.md), the decisions are in [docs/decisions/](docs/decisions/), and the work is planned in the [milestones](../../milestones) and [issues](../../issues).

## What you will get

```bash
npx @cosmin-sisman/agent-os init      # detects the repo's state, asks 4–6 questions, shows the plan, writes it
npx @cosmin-sisman/agent-os doctor    # checks the agent system and GitHub hygiene; same check runs in CI
npx @cosmin-sisman/agent-os next      # what to work on next, and why
```

- **One flow:** `/next` → `/ticket` → `/start` → work → `/test` → `/pr` → `/ship` → `/release`, with `/retro` closing the loop.
- **Complete tickets:** one or more labels (type, area, priority, size, flags), milestone, assignees, parent and sub-issues, blocked-by and blocking, a linked branch, and test scenarios.
- **`development` as the default branch,** so `Closes #N` closes issues automatically. `main` is production.
- **Made for teams:** GitHub is the shared state; nothing personal is committed; CI enforces what local hooks only remind about.
- **No conflict-prone files:** history is a journal of small files, and each PR carries its own entry. Maps and indexes are generated on demand, never committed.
- **A self-improvement loop with no exceptions:** capture → triage → apply → verify, enforced by a required CI check.
- **Core, external and local skills, kept apart:** a registry with one file per skill, and capability slots so core never hard-codes a third-party skill.
- **Lessons learned that come back:** captured automatically or with `/lessons`, and recalled when you start work in the same area.
- **Environment check:** `/env` verifies MCP servers, CLIs, GitHub scopes and variables, both on your laptop and in the repo.
- **Language per area:** issues, PRs, commits, labels, milestones, docs and chat are each set to `en` or `ro` (Romanian without diacritics), in any combination.
- **Fits any repository state:** empty, specification-only, in active development, or in maintenance. Existing repositories choose *retrofit* (bring history in) or *forward-only*.
- **Testing and CI built in:** one gate definition runs locally and in CI, plus a `/test` skill wired into tickets and PRs and a `/gh-actions` best-practice skill.

## Roadmap

| Milestone | Theme |
|---|---|
| v0.1 Foundations | CLI, config, templates, lock and updates, language engine, hooks runner, environment and MCP check |
| v0.2 Core workflow | GitHub setup, tracker adapter, `/ticket`, `/start`, `/pr`, `/ship`, `/release`, `/next` |
| v0.3 Knowledge and loop | journal, lessons learned with recall, decisions, chronicle, `map`, `/retro`, `doctor`, the required loop check |
| v0.4 Collaboration | multi-person protocol, overlap detection, comment-driven work, optional orchestrator, `/handoff` |
| v0.5 Skill registry | core / external / local registry, slots, `skill add/remove/update` |
| v0.6 Testing and CI | `/test`, gate, `/gh-actions`, generated workflows |
| v0.7 Init and adoption | detection, profiles, retrofit and forward-only, `/discover`, `/kickoff`, `/ingest-docs`, packs |
| v1.0 Release | Claude Code plugin, npm publish with provenance, skill evals, docs, dogfooding |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The project follows its own design: issues are complete, PRs target `development`, and every PR carries a journal entry and a `## Lessons` section.

## License

[MIT](LICENSE)
