# Contributing

agent-os is installed in its own repository (#61): the rules in `.claude/rules/`, the skills in `.claude/skills/` and the hooks in `.claude/settings.json` apply here as in any project. The hooks run this repository's own CLI (`node bin/agent-os.mjs`), never a published copy. The path is relative to the repository root. A session whose shell has moved into a subfolder gets a non-blocking hook error (exit 1, never 2), so tools still run, without the guards. The loop is `/next`, `/start <n>`, the work, `/pr`, `/ship`. This file keeps only what is specific to this repository.

## Branches

- `development` is the default branch and the integration branch. Every feature or fix PR targets it and is squash-merged.
- `main` is the release branch. It changes only through a release PR from `development` (merge commit) or a hotfix.
- Branch names: `<type>/<issue>-<slug>` in English kebab-case, for example `feat/12-ticket-skill`. Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `perf`.

## Issues

- Every change starts from an issue. Search for duplicates first.
- Labels: exactly one `type:*`, exactly one `priority:*`, one or more `area:*`, and optionally a `size:*` and flags.
- Every issue has a milestone. Large work is an epic (`type:epic`) with sub-issues, and dependencies use GitHub's *blocked by* relationship.
- Claim an issue before the first edit: `agent-os start <n>` assigns you, creates the linked branch and sets In Progress. Don't pick up an issue assigned to someone else without asking in its comments.

## Pull requests

- Title: `<type>(<scope>): <summary> [#N]`, lowercase, imperative, ≤ 72 characters. The brackets list every issue the body closes or references. CI checks it (`agent-os check title`), and so can you before pushing: `node bin/agent-os.mjs check title "<title>" --body-file <body>`.
- Body: the template's sections. `## Lessons` is required: write the lesson, or "None: <reason>".
- Add a journal entry in the same PR: `agent-os journal add --type decision --title "…" --area <area> --ref "#N" --body-file <file>` writes `.agent-os/journal/YYYY/MM/<YYYY-MM-DDTHH-MM>-<github-user>-<slug>.md` (UTC) with front matter `type`, `refs`, `areas`, `author`. `agent-os journal check` validates every entry (also part of `npm test`).
- One PR closes one issue (`Closes #N`).

## Decisions

A decision that changes the design gets a record in `docs/decisions/<YYYY-MM-DD>-<slug>.md` (see [the index](docs/decisions/README.md)), in the same PR as the change.

## Code

Node ≥ 22 (every LTS line still supported upstream), ESM, no runtime dependencies, Windows, macOS and Linux. Every file starts with a 1–3 line header saying what it is. Tests use `node:test`, live next to the code as `*.test.mjs`, and run with `npm test`.

## Catalog entries

Adding or changing a layer, technology, language, provider, runtime or blueprint in `catalog/` follows [the catalog guide](docs/reference/catalog.md); `agent-os stack catalog check` must pass.

## Checks

Every PR runs two required checks:
- `ci`: `npm test`, `agent-os stack catalog check` and `npm run site` on Linux, macOS and Windows with Node 22, 24 and 26, plus `actionlint` on the workflows;
- `agent-os/loop`: a valid Lessons section, a journal entry, and `doctor --ci`.

The loop and gate jobs live in `ci.yml`, so the package's own loop, gate and retro workflows are turned off in `agent-os.json` (`ci.loop`, `ci.gate`, `ci.retro`). Before you push:
- run `npm test`;
- run `agent-os check title` and `agent-os check loop --body-file <body>`, and look at the exit code (never through a pipe);
- after changing a command, an option or a core skill, run `npm run docs`: the commands reference and the skill catalog are generated, and a test fails when they are stale.
