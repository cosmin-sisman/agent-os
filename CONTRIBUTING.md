# Contributing

This repository uses the workflow agent-os will install. Until the CLI exists, the steps below are done by hand.

## Branches

- `development` is the default branch and the integration branch. Every feature or fix PR targets it and is squash-merged.
- `main` is the release branch. It changes only through a release PR from `development` (merge commit) or a hotfix.
- Branch names: `<type>/<issue>-<slug>` in English kebab-case, for example `feat/12-ticket-skill`. Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `perf`.

## Issues

- Every change starts from an issue. Search for duplicates first.
- Labels: exactly one `type:*`, exactly one `priority:*`, one or more `area:*`, and optionally a `size:*` and flags.
- Every issue has a milestone. Large work is an epic (`type:epic`) with sub-issues, and dependencies use GitHub's *blocked by* relationship.
- Assign yourself when you start. Don't pick up an issue assigned to someone else without asking in its comments.

## Pull requests

- Title: `<type>(<scope>): <summary> [#N]`, lowercase, imperative, ≤ 72 characters. The brackets list every issue the body closes or references.
- Body: the template's sections. `## Lessons` is required: write the lesson, or "None: <reason>".
- Add a journal entry in the same PR: `.agent-os/journal/YYYY/MM/<YYYY-MM-DDTHH-MM>-<github-user>-<slug>.md`, with front matter `type`, `refs`, `areas`, `author`.
- One PR closes one issue (`Closes #N`).

## Decisions

A decision that changes the design gets a record in `docs/decisions/<YYYY-MM-DD>-<slug>.md` (see [the index](docs/decisions/README.md)), in the same PR as the change.

## Code

Node ≥ 20, ESM, no runtime dependencies, Windows, macOS and Linux. Every file starts with a 1–3 line header saying what it is. Tests use `node:test`.
