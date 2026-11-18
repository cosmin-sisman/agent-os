# GitHub is the coordination layer

Status: accepted · amended by [platforms](2026-11-18-platforms-github-and-gitlab.md)

## Context
The design target is five or more people, each on their own laptop with their own agent sessions, on one repository. They comment on issues and PRs. A coordination file in the repository (a ledger, a shared memory) conflicts constantly. A local mechanism (a shared database, a session registry) does not reach the other laptops. Local hooks may not be installed on everyone's machine.

## Decision
- Shared state is GitHub's: assignees mean "who is on it", linked branches and draft PRs mean "work started", comments are the conversation, milestones and relationships are the plan.
- Claiming an issue = assigning yourself + linking a branch. `/next` and `/start` skip issues assigned to others.
- `agent-os overlap` warns when open PRs or pushed branches touch the same files as yours.
- Personal state (ledgers, caches, ports, machine limits, chat language) lives in gitignored `.agent-os/local.json` and `.agent-os/cache/`.
- Anything that must hold for the team is a CI check. Local hooks only remind early.
- The multi-session orchestrator is per laptop and optional; it never coordinates other people.

## Consequences
Work is visible to everyone without extra tooling. The CLI needs reliable GitHub reads (with caching and rate-limit handling). A team without CI loses the guarantees, so `init` generates the workflows.
