# Init profiles, retrofit and forward-only adoption

Status: accepted

## Context
agent-os is installed into empty repositories, repositories with only specifications, repositories in full development and finished products. One install path cannot fit all four, and an existing repository's history is either worth importing or not, depending on the team.

## Decision
- `init` detects signals, proposes one of four profiles (`greenfield`, `spec-first`, `active`, `maintenance`), confirms it and asks four to six questions.
- Existing repositories choose a methodology:
  - **retrofit**: a reviewable plan (`retrofit plan`) to create or map labels, create milestones from tags, link merged PRs and issues, normalize *open* PRs' titles and descriptions, and write a baseline journal; `retrofit apply` is idempotent and rate-limited, and never rewrites closed PRs;
  - **forward-only**: a cutoff date and a baseline snapshot; `doctor` ignores what predates the cutoff.
- New installs start in adoption mode: hooks warn for 14 days (configurable) before enforcing. The CI loop check is required from day one.
- `agent-os phase next` moves a project between profiles as it matures.

## Consequences
Teams can adopt agent-os without stopping work or rewriting history they do not care about, and the same package grows with the project.
