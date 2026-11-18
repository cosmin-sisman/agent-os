# agent-os: guide for coding agents

agent-os is a CLI plus a set of skills, rules and hooks that it installs into other repositories. This file is for agents working **on this repository**.

## Read first

- [docs/design/overview.md](docs/design/overview.md): the target design. Every feature issue implements a section of it.
- [docs/decisions/](docs/decisions/): accepted decisions. Don't contradict one; propose a new record that supersedes it.
- [CONTRIBUTING.md](CONTRIBUTING.md): branches, issues, PRs, the journal entry and the Lessons section.

## Conventions an agent can't infer

- All repository text is in English. The *installed* templates exist in `en` and `ro`; `ro` is Romanian **without diacritics** (ASCII only).
- Zero runtime dependencies. Use only Node built-ins (`node:fs`, `node:child_process`, `node:test`, `node:util` `parseArgs`).
- Every mechanical step is a CLI subcommand with `--dry-run` and `--json`. A command never writes to stdout or stderr directly: it calls `ctx.output()` and `ctx.debug()` and throws `CliError` with a hint; exit codes are 0 ok, 1 check failed, 2 could not run. A new command is a registry entry plus a file in `src/commands/`. Skills call the CLI; they never build `gh` or `git` commands from scratch.
- Tests are `*.test.mjs` next to the code they test, using `node:test`; `npm test` runs them all. The required check is the `ci` job (`.github/workflows/ci.yml`).
- Text files are LF on every OS (`.gitattributes`): artifacts record sha256 hashes of their sources.
- Never commit generated indexes or caches. They are rendered on demand into `.agent-os/cache/`.
- Hooks and scripts must run on Windows, macOS and Linux: Node only, no shell-specific syntax.
- `--dry-run` stubs return the same shape as the real call (an empty list, not `{}`), or the dry run crashes where the real run works. (lesson: dry-run-shapes)
- Idempotent platform calls treat "already linked" errors as success, and each adapter owns its own list of those messages (GitHub answers a repeated sub-issue link with 422 "duplicate sub-issues"). (lesson: platform-api-duplicates)
- Two platforms are first-class: GitHub and GitLab (including self-managed). Features depend on probed capabilities with a fallback, never on the platform's name (design §20). Platform-specific templates live in their own route.

## Area map

| Path | What |
|---|---|
| `bin/agent-os.mjs` | the executable; it only calls `src/cli/main.mjs` |
| `src/cli/` | the runner (`main.mjs`), the command registry with lifecycle states (`registry.mjs`), global options, the `Context` every command receives, exit codes and `CliError` |
| `src/commands/` | one file per implemented command, exporting `run(ctx)` and optionally `options` and `usage` |
| `docs/design/` | the target design |
| `docs/decisions/` | decision records, date-based ids |
| `docs/research/` | research notes behind decisions |
| `.github/` | issue forms, PR template, workflows (`ci.yml` required check, `pages.yml` artifact site) |
| `catalog/` | the stack catalog in YAML: layers, technologies, languages, providers, runtimes, blueprints |
| `examples/` | example files a project would have (`stack.yaml`) |
| `artifacts/` | visual artifacts: one folder each, with `artifact.yaml` and a self-contained `index.html` |
| `scripts/github/` | scripts that set up this repository's GitHub: `plan.mjs` + `setup.mjs` (labels, milestones, issues, relationships), `project.mjs` (the project board, rerun after creating issues) |
| `scripts/bootstrap/` | one-off Python that produced the first catalog and artifact |
| `scripts/site/` | builds the GitHub Pages site (artifacts plus a generated index) |
