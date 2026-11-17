# agent-os: design overview

Status: draft for v0.1. This document is the target design. Each section links the issues that build it, and each decision links its record in [`docs/decisions/`](../decisions/).

## 1. What agent-os is

agent-os installs a working agreement between people, coding agents and GitHub into any repository. It sets up the skills, rules, hooks and small deterministic scripts that let several people, each with their own agent sessions on their own laptops, move work from idea to production the same way every time. It also keeps the system improving itself as the project grows.

It is distributed in two ways:

- `npx @cosmin-sisman/agent-os init`, which writes the files into the repository;
- as a Claude Code plugin, for the parts that live outside the repository.

### Goals

1. **One flow, every repo.** The path is ticket → branch → work → test → PR → merge → release. It looks the same in a new repository, a repository with only specifications, a repository in active development, and a finished product in maintenance.
2. **GitHub is the coordination layer.** Issues, sub-issues, dependencies, milestones, labels, assignees, branches, pull requests and comments are the shared state. Nothing the team needs lives only on one laptop.
3. **No conflicts by construction.** Files that many people write at once are never single shared files. They are directories of small files with unique names, or they are generated on demand and never committed.
4. **The self-improvement loop has no exceptions.** Every unit of work ends by capturing what was learned, and CI refuses a pull request that skips it.
5. **Cheap context.** Agents get the conventions they could not infer and pointers to everything else. Nothing is preloaded just in case.
6. **Core stays separate from extensions.** Core skills, external skills (vendored or from plugins) and project-local skills are registered and indexed separately, and each can be added or removed per project.
7. **Language per area.** Each area (issues, PRs, commits, labels, milestones, chat, docs and so on) is set to `en` or `ro`, independently.

### Non-goals

- Not a task tracker. GitHub is the tracker; agent-os only drives it.
- Not tied to one stack. Stack knowledge (a database, a host, a UI framework) comes in optional packs.
- Not tied to one agent vendor. `AGENTS.md` stays readable by any agent; Claude Code gets the deepest integration (skills, hooks, subagents).

## 2. The layers

| Layer | Holds | Lives in | Written by |
|---|---|---|---|
| Facts | what is true now: product, architecture, areas | `AGENTS.md` (short), `docs/` | people, with agents |
| Policy | rules, each with its reason | `.claude/rules/*.md` | managed core plus project additions |
| Procedure | step-by-step workflows | `.claude/skills/*/SKILL.md` | core, external or local (see §6) |
| Determinism | anything mechanical: GitHub calls, checks, renders | the `agent-os` CLI | the package |
| Enforcement | what must happen even when nobody remembers | Claude Code hooks (local) and CI checks (shared) | the package |
| History | decisions, lessons, incidents, releases, handoffs | `.agent-os/journal/` and GitHub itself | everyone, one file per entry |

Lesson carried over from the reference workflow: **skills call the CLI for mechanical steps instead of letting the model improvise `gh` and `git` commands.** That is what makes the flow reproducible. Every mechanical step therefore gets a CLI subcommand with `--dry-run` and `--json`.

## 3. Installed layout

```
AGENTS.md                         # hand-owned, short; one managed block with pointers
CLAUDE.md                         # "@AGENTS.md"
agent-os.json                     # team config (committed)
.agent-os/
  lock.json                       # managed files: path, version, hash (committed)
  registry/<skill>.json           # one file per registered skill (committed)
  journal/YYYY/MM/<entry>.md      # history, one file per entry (committed)
  lessons/{inbox,active,retired}/ # lessons learned, one file per lesson (committed)
  local.json                      # personal config (gitignored)
  cache/                          # maps, chronicle renders, GitHub snapshots (gitignored)
.claude/
  rules/*.md                      # core rules (managed) + project rules (owned)
  skills/<name>/SKILL.md          # core, external and local skills
  agents/*.md                     # subagents (context-scout, verifiers from packs)
  settings.json                   # hooks: entries whose command starts with "agent-os hook"
.github/
  ISSUE_TEMPLATE/*.yml            # issue forms, in the issues language
  pull_request_template.md        # in the PRs language
  workflows/agent-os-*.yml        # gate, loop check, retro schedule, label sync
docs/decisions/<date>-<slug>.md   # decision records, date-based ids
```

**Managed versus owned.** A managed file is listed in `lock.json` with the hash it was installed with. `agent-os update` replaces it when the local hash still matches. When the file was edited locally, it runs a three-way merge, and any conflict goes to a `.rej` file plus a proposal. `agent-os eject <path>` turns a managed file into an owned one. Files that are part managed, part owned (`AGENTS.md`, `.claude/settings.json`) carry a managed block or managed entries, and agent-os never touches anything outside them. Decision: [managed files](../decisions/2026-11-18-managed-files-and-lock.md).

## 4. Configuration and languages

Two files:

- `agent-os.json`, committed: the team's agreement. It holds the repository, branches, tracker, the language of every shared area, labels, packs, slot bindings, the gate and context budgets.
- `.agent-os/local.json`, gitignored: one person's setup. It holds their chat language, machine limits (RAM, dev ports), and whether they run several sessions on one laptop.

### Language per area

Only two values exist: `en` and `ro`. `ro` means **Romanian without diacritics**: plain ASCII, so it reads the same in every terminal, branch name, label and search box. `agent-os doctor` and the CI loop check reject `ă â î ș ț` in any area set to `ro`.

| Area | Scope | Examples |
|---|---|---|
| `chat` | personal (`local.json`) | how the agent talks to you |
| `issues` | team | issue titles, bodies, comments the agent starts |
| `prs` | team | PR titles, descriptions, comments the agent starts |
| `commits` | team | commit messages |
| `branches` | team | branch slugs (always ASCII kebab-case) |
| `labels` | team | label names and descriptions |
| `milestones` | team | milestone titles and descriptions |
| `releases` | team | release notes, tags' titles |
| `codeComments` | team | comments and headers written in code |
| `docs` | team | human documentation in `docs/` |
| `journal` | team | journal entries and decision records |

Areas mix freely, for example issues in `ro`, PRs in `en`, labels in `ro` and milestones in `en`. A reply to an existing comment uses the language of that comment. Templates ship in both languages. Label and milestone names come from dictionaries. `agent-os lang set labels ro` renames the existing labels through the API, so issues keep their labels. Decision: [languages](../decisions/2026-11-18-language-per-area.md).

## 5. Collaboration model

Design target: at least five people on their own laptops, each with one or more agent sessions, working on the same repository. They talk through issue and PR comments. See [GitHub as the coordination layer](../decisions/2026-11-18-github-as-coordination-layer.md).

- **Claiming work** means assigning yourself and linking a branch (`gh issue develop`, from the integration branch). An early draft PR is optional. `/next` and `/start` never pick an issue someone else is assigned to unless you ask.
- **Seeing overlap.** `agent-os overlap` lists open PRs and pushed branches that touch the same files as your branch. `/start` and `/pr` run it and warn you.
- **Conversation** happens in issue and PR comments. Skills read the thread before acting and answer review threads in the comment's language. Decisions made in comments are quoted verbatim into the journal entry of the PR that implements them.
- **Personal state never enters git.** Ledgers, caches, ports and machine limits are personal. Everything committed is either team agreement or history in files with unique names.
- **Local hooks are convenience; CI is the guarantee.** A teammate may run without hooks, so every rule that must hold for the team is also a CI check.
- **Several sessions on one laptop** is optional. The orchestrator role (one session coordinates, others work in worktrees) is per person and per laptop. Its ledger is local JSON. Across people, coordination happens on GitHub only.

## 6. Skills: core, external, local

Every skill on disk has a registry entry in `.agent-os/registry/<name>.json`:

```json
{ "name": "impeccable", "origin": "external", "source": "github:pbakaus/impeccable@<sha>",
  "version": "4.5.0", "license": "Apache-2.0", "provides": ["ui-design"], "managed": false }
```

| Origin | What | Updated by |
|---|---|---|
| `core` | the workflow skills agent-os ships | `agent-os update` |
| `external` | third-party skills vendored into the repo | `agent-os skill update <name>` (pinned commit) |
| `local` | skills the project writes for itself | the team |
| `plugin`, `builtin` | skills that live outside the repo (Claude Code built-ins such as `code-review`, plugin skills) | not stored, only registered so the index knows them |

- **Capability slots.** Core skills never name an external skill. They call a slot (`review`, `security-review`, `ui-design`, `testing`, `ci`, `docs`), and `agent-os.json` binds each slot to a skill: `"slots": { "review": "code-review", "ui-design": "impeccable" }`. Swapping `impeccable` for another design skill changes one line and nothing in core.
- **Separate indexes.** `agent-os skills` and the SessionStart hook render three tables (core, external, local) from the registry. No generated index is committed, so two people adding two skills never conflict.
- **Consistency.** `doctor` fails when a folder in `.claude/skills/` has no registry entry, or an entry has no folder. Vendored external skills are never edited in place: local changes go in a local overlay skill or upstream.

Decision: [skills registry and slots](../decisions/2026-11-18-skill-registry-and-slots.md).

## 7. The workflow

```
/next ──► /ticket ──► /start ──► work ──► /test ──► /pr ──► review ──► /ship ──► /release
  ▲          │           │                   │         │                  │          │
  │          └─ test plan written into the issue        └─ gate + journal  │          │
  └──────────── /retro ◄── lessons inbox ◄──── every step captures ◄───────┴──────────┘
```

| Skill | Job |
|---|---|
| `/next` | recommends what to do next, with reasons (§9) |
| `/ticket` | creates a complete issue (§8) and its test plan |
| `/start` | claims the issue, creates the branch from the integration branch, optional worktree |
| `/test` | `plan` (scenarios into the issue), `pr` (diff → suites → result table), `local`, `gaps` |
| `/pr` | runs the gate, writes the journal entry, opens the PR with the right title and template |
| `/ship` | merges into the integration branch, closes issues with a comment, cleans up |
| `/release` | integration → production branch, tag, GitHub Release, milestone roll, pack verifiers |
| `/retro` | triages the lessons inbox into rule changes |
| `/doctor` | checks and repairs the agent system and GitHub hygiene |
| `/handoff` | end of session or day: a journal entry plus a comment on each open issue |
| `/gh-actions` | writes and reviews GitHub Actions workflows by best practice |
| `/orchestrate` | optional: one session coordinates the other sessions on this laptop |
| `/kickoff`, `/ingest-docs`, `/discover` | adoption per repository state (§11) |
| `/lessons` | capture, recall, search and review lessons learned on demand (§10) |
| `/stack` | shows, changes, detects and checks the project's stack map (§16) |
| `/upstream` | proposes an improvement to agent-os itself as an issue on its public repository, privacy-filtered (§18) |
| `/artifact` | creates, builds, verifies and links visual artifacts kept in the repository (§17) |
| `/env` | checks that this laptop and the repository have the MCP servers, CLIs, auth scopes and variables the project needs (§15) |

**Integration branch.** By default it is `development`, and init makes it the repository's **default branch**. GitHub closes an issue through `Closes #N` only when the PR merges into the default branch, so this keeps automatic closing working. The production branch (`main`) changes only through a release PR or a hotfix. Both names are configurable. Decision: [integration branch](../decisions/2026-11-18-integration-branch-is-default.md).

## 8. A complete ticket

`/ticket` sets everything GitHub allows:

| Field | Rule |
|---|---|
| Title | `<Area>: <problem>`, ≤ 70 chars, in the `issues` language |
| Body | the issue form's sections, plus `## Test scenarios` (Given/When/Then), written by `/test plan` |
| Labels | **one or more**: exactly one `type:*` and one `priority:*`, one or more `area:*`, optional `size:*` and flags (`needs-decision`, `good first issue`, …) |
| Milestone | required |
| Assignees | zero or more; the creator only when they will do it |
| Relationships | parent (sub-issue API), `blocked by` / `blocking` (dependencies API) |
| Branch | linked through `gh issue develop --base <integration>` when work starts (`/start`) |
| Project fields | Status, Priority, Size, Iteration, when a Project v2 is configured |
| Issue type | when the organization defines issue types |

It always searches for duplicates first and proposes extending an existing issue instead of creating a twin.

## 9. `/next`: what to work on

`agent-os next --json` scores candidates deterministically, and the skill explains the top three. The order:

1. Your open PRs with requested changes or failing checks.
2. Reviews requested from you.
3. Issues assigned to you that are in progress.
4. Issues assigned to you that are not blocked, ranked by milestone (earliest due or lowest version first), then priority, then whether they unblock others.
5. Unassigned, unblocked issues in the current milestone, with a bonus for areas you touched recently (`git log --author`).

Blocked issues (open `blocked by`) and issues assigned to others are left out, with a note.

## 10. Knowledge, history and the self-improvement loop

### No committed file index

Research: [file index](../research/file-index.md). Agents navigate code better on demand than from a preloaded map. A committed list of every file costs context in every session, is redundant with `grep` and `glob`, and conflicts between parallel PRs. agent-os therefore uses three things instead:

- **file headers** (1–3 lines on what a file is), which `grep` finds and which `doctor` asks for on new files only;
- **`agent-os map [path] [--budget N]`**, which renders a map of one area on demand from headers and git, cached by commit in `.agent-os/cache/`;
- **an area map** in `AGENTS.md`, one line per top-level area, which `doctor` checks covers every top-level source directory.

Decision: [no committed file index](../decisions/2026-11-18-no-committed-file-index.md).

### Journal instead of one memory file

One shared `MEMORY.md` or ledger conflicts as soon as two people write to it. The journal is **one file per entry**: `.agent-os/journal/2026/11/2026-11-18T14-02-cosmin-sisman-files-index.md`. Its front matter holds `type` (decision · lesson · incident · release · handoff · note), `refs` (issues, PRs), `areas` and `author`. Unique names mean no conflicts. Each **PR carries its own entry** in its own commits, so history lands exactly when the work does. Decision records use date-based ids (`2026-11-18-<slug>`), never sequential numbers that two branches would both claim. Decision: [journal](../decisions/2026-11-18-journal-not-memory-file.md).

`agent-os chronicle --since <date>` assembles one timeline from git, GitHub (issues, PRs, comments, milestones, releases) and the journal. It is rendered on demand into the cache, never committed.

### The loop (no exceptions)

```
capture ──► triage ──► apply ──► verify
   ▲                               │
   └───────────────────────────────┘
```

- **Capture.** The last step of every core skill is a *Learn* step that writes a lesson to `.agent-os/lessons/inbox/` or states "no lesson" with a reason. The PR template has a required `## Lessons` section. Repeated review findings are captured automatically by `/retro`. You can also capture at any moment with `/lessons add`.
- **Triage.** `/retro` runs at each release. A scheduled workflow also opens or updates a "Retro" issue when the inbox is not empty. Lessons are grouped by theme. Each becomes either a rule line with its reason, in the rule file that owns the topic, or an *active lesson card* when it is too specific for a rule.
- **Apply.** Rule changes and promoted cards go through a normal PR. The journal gets a `type: lesson` entry that links them.
- **Recall.** Lessons are only useful if they come back at the right moment, which is the step most systems lack. When `/start` claims an issue and when `/pr` sees the diff, `agent-os lessons recall` matches active cards to the issue's `area:*` labels, the touched paths and keywords. It returns the few that apply (within a small token budget), and the skill states which ones it is following. A lesson that keeps getting recalled and followed is a candidate for promotion into a rule. One that has not been recalled for a long time is proposed for retirement.
- **Verify.** `doctor` runs in CI on every PR as a **required check** (`agent-os/loop`). It fails when the PR has no journal entry and no explicit `## Lessons` content, when the registry and the skills disagree, when a link or command is broken, when a context budget is exceeded, or when a `ro` area contains diacritics.

A rule that matters for the team is never only a local hook: hooks remind, CI enforces. Decision: [the loop](../decisions/2026-11-18-self-improvement-loop.md).

### Lessons learned as a first-class store

Lessons are kept apart from the journal because they have a lifecycle. A journal entry is a fact about the past. A lesson is advice that should change future behaviour until it is absorbed into a rule or no longer true.

```
.agent-os/lessons/
  inbox/<timestamp>-<author>-<slug>.md     # captured, not yet triaged
  active/<slug>.md                         # accepted cards, recalled by area and path
  retired/<slug>.md                        # absorbed into a rule, or no longer true (kept for history)
```

A card's front matter holds `areas`, `paths` (globs), `keywords`, `source` (the issue, PR, review comment or incident it came from), `confidence`, `recalled` and `followed` counters (updated by `/retro` from the journal, never on every session, so they don't conflict), and `promotedTo` once it becomes a rule. The body states the lesson in one sentence, the reason, and one example.

It works **automatically** through the Learn step of every skill, the recall in `/start` and `/pr`, and `/retro`. It works **on demand** through the `/lessons` skill:

- `add`: capture from the current conversation;
- `recall [path|issue]`: what applies here;
- `search <words>`;
- `review`: triage the inbox now, without waiting for a release;
- `promote` and `retire`.

Decision: [lessons learned](../decisions/2026-11-18-lessons-learned-store.md).

### Context budgets

`agent-os.json` sets size budgets (for example `AGENTS.md` ≤ 8 KB, any rule file ≤ 6 KB, the SessionStart injection ≤ 1.5 KB). `doctor` warns at 80% and fails over 100%. Overflow means splitting the file by topic, not raising the budget.

## 11. Init and repository states

`agent-os init` reads signals (commit count, source files, `docs/` and specifications, open PRs and branches, tags and releases, date of the last commit, CI, an existing `CLAUDE.md` or `AGENTS.md`). It proposes a profile, confirms it with you, and asks four to six questions (languages per area, tracker, packs, integration branch, solo or team).

| Profile | Signals | Installs | Extra skill |
|---|---|---|---|
| `greenfield` | < 5 commits, no code | core light, hooks warn-only | `/kickoff`: product interview → docs, milestones, first issues |
| `spec-first` | docs or specs, little code | core light | `/ingest-docs`: specs → epics and sub-issues, linked to their sources |
| `active` | recent commits, open PRs | full core | `/discover`: infer conventions from history; decision archaeology into the journal |
| `maintenance` | tags, low commit rate | maintenance set | `/audit`, `/runbook`, `/handoff` |

For an existing repository you choose a methodology. Decision: [init and adoption](../decisions/2026-11-18-init-profiles-and-retrofit.md).

- **Retrofit.** Bring history into the system. `agent-os retrofit plan` writes a reviewable plan file covering labels to map or create, milestones from tags, links between merged PRs and issues, normalized titles and templates for *open* PRs, and a baseline journal from history. `retrofit apply` executes it idempotently, rate-limited, and marks what it touched. Closed PRs are never rewritten; their information goes into the journal instead.
- **Forward-only.** Keep history as it is. Init records a cutoff date and a baseline snapshot entry, and `doctor` ignores everything older than the cutoff.

Both modes start in **adoption mode**: hooks only warn for the first 14 days (configurable), then enforce.

## 12. Testing and CI

- **One gate definition.** `agent-os.json` maps path globs to suites (`"src/**": ["typecheck", "unit"]`, `"db/**": ["db"]`). `agent-os gate` runs exactly the suites the diff needs, locally from `/pr` and in CI from the generated workflow.
- **`/test` is wired into other skills.** `/ticket` calls `test plan` (scenarios into the issue), `/pr` calls `test pr` (which suites ran, results table into the PR) and `/ship` checks that the plan's scenarios are ticked. It is bound to the `testing` slot, so a project can swap it.
- **`/gh-actions`** writes and reviews workflows: least-privilege `permissions`, actions pinned to a commit SHA, `concurrency` and `timeout-minutes` on every job, caching, no untrusted `${{ github.event.* }}` inside `run:`, care with `pull_request_target`, OIDC instead of long-lived secrets, reusable workflows, `actionlint` in CI.
- **Generated workflows:** `agent-os-gate.yml`, `agent-os-loop.yml` (required), `agent-os-retro.yml` (scheduled), `agent-os-labels.yml` (label sync from config).

## 13. Packs

Optional bundles of rules, subagents, gate suites and release verifiers. Examples: `stack-postgres` (migration rules, a DB verifier subagent), `deploy-vercel` (release verification), `ui-web` (UI rules, a visual verifier, the `ui-design` slot bound to an external skill), `tracker-gitlab`. Core never assumes a pack.

## 14. Distribution and platform

- Node ≥ 20, ESM, **zero runtime dependencies**, Windows, macOS and Linux (hooks are Node, never shell-specific).
- `npx @cosmin-sisman/agent-os <command>`; a Claude Code plugin with the same skills for user-level install.
- Published with npm provenance from CI.

## 15. Environment and MCP check

A project depends on more than its code: MCP servers (a database, a design tool, the tracker), CLIs and their versions (`gh`, `node`, `docker`), GitHub token scopes (`project` for Projects v2, `workflow` for workflows), environment variables and, sometimes, Claude Code plugins. When one of them is missing or configured differently on one teammate's laptop, the failure shows up late and looks like a bug.

`agent-os.json` declares what the project needs:

```json
"requires": {
  "mcp": [
    { "name": "postgres", "scope": "project", "transport": "http", "why": "schema reads in db-verifier" },
    { "name": "figma", "scope": "user", "optional": true, "why": "ui-design slot" }
  ],
  "cli": { "node": ">=20", "gh": ">=2.60", "docker": "*" },
  "githubScopes": ["repo", "workflow", "project"],
  "env": ["DATABASE_URL"],
  "plugins": []
}
```

`agent-os env` (and the `/env` skill that explains and repairs it) compares this with reality:

- **Repository side:** `.mcp.json` declares every `project` server with the right transport and URL. Placeholders such as `${VAR}` are used instead of literal secrets, and no token is committed (the secret scan covers `.mcp.json`).
- **Laptop side:** each server is installed in the right scope and connected (`claude mcp list`), user-scope servers exist, CLIs meet their versions, `gh auth status` shows the scopes, and variables are set. Values are never printed, only whether they are present.
- **Drift:** a server installed locally but not declared, or declared but authenticated against the wrong account or project, is reported with the exact command that fixes it.

It runs during `init`, as a fast offline subset at SessionStart (only what can be checked in under a second), in full on `/env`, and before `/release`. Results are personal, so they go to `.agent-os/cache/`, never into git. CI checks only the repository side. Decision: [environment check](../decisions/2026-11-18-environment-check.md).

## 16. Stack map

Every project is built in **layers**: public frontend, internal frontend, mobile, APIs, services, workers, data, storage, auth, payments, CI/CD, infrastructure, monitoring and more. agent-os makes those layers the backbone that connects everything else. Decision: [stack map](../decisions/2026-11-18-stack-map.md).

### The catalog (shipped, extendable)

[`catalog/`](../../catalog/) holds plain YAML that people can read and review in a PR:

| File | Holds |
|---|---|
| `layers.yaml` | 24 layers in six groups (experience, interfaces, logic, data, platform, delivery) |
| `technologies.yaml` | 126 technologies, each with its layer, language, default provider, runtime, `complexity` (1–5), `aiFriendly` (1–5) and a note |
| `languages.yaml` | 20 languages with `performance`, `learningCurve`, `aiFriendly`, strength and typical use |
| `providers.yaml` | 39 providers with `ease`, `cost`, `euRegions` (yes · global · verify) and `mcpHint` |
| `runtimes.yaml` | OS and runtimes |
| `blueprints.yaml` | 10 reference stacks, levels 1–5, in a TypeScript family and a polyglot family |

Every text exists in `en` and in ASCII `ro`. A project adds its own entries in `.agent-os/catalog/*.yaml`, which are merged over the shipped catalog, without forking it.

### `stack.yaml` (one file per project, committed)

[`examples/stack.yaml`](../../examples/stack.yaml) shows the format. For each layer it records the technology, provider, status (chosen · evaluating · optional · rejected), **paths** in the repository, owners and a note. It is written in a strict, readable YAML subset that agent-os parses without dependencies: maps, lists, inline `{}` and `[]`, quoted or plain scalars, comments.

### What the stack drives

| Consumer | How it uses `stack.yaml` |
|---|---|
| Labels | `area:*` labels are generated from the layers in use, with names from the `labels` language dictionary |
| Paths | layer `paths` map files to areas, which feeds `/next` familiarity, `overlap`, the AGENTS.md area map and optional CODEOWNERS |
| Gate | suites are attached to layers (`data-layer` → migration tests); `gate` runs the layers the diff touches |
| Environment | providers with `mcpHint` and technologies with known CLIs become proposed `requires` entries; `/env` checks them |
| Lessons | cards are tagged with layers, so recall works by layer as well as by path |
| Packs and slots | technologies suggest packs (a Postgres pack for a Postgres data layer) and external skills for slots |
| Decisions | changing a layer's technology or status writes a decision record with the catalog's comparison (complexity, AI-friendliness, cost, EU regions) |
| Agents | low `aiFriendly` scores make the layer's rules ask agents to read the docs first (through a docs MCP when one is configured) |

### `agent-os stack`

- `new --from <blueprint>`: write `stack.yaml` from a blueprint, then ask about each layer.
- `show`: the stack as a table, with the summary: distinct languages and providers, average complexity, average AI-friendliness, average provider cost, the steepest learning curve, and the EU region check.
- `set <layer> <tech>` and `status <layer> <status>`: change a layer, write the decision record, open the follow-up issues.
- `detect`: infer layers and paths from an existing repository (`package.json`, lockfiles, Dockerfiles, `wrangler.toml`, `vercel.json`, framework configs, migration folders, workflows). Used by `/discover`.
- `drift`: compare `stack.yaml` with the code (for example, the stack says Drizzle but the code imports Prisma) and report it in `doctor`.
- `import <file.xlsx|csv>`: read a stack builder sheet (layer, technology, provider, status, notes) into `stack.yaml`.
- `render`: build the stack map artifact (§17).

`/stack` is the skill around these commands. `/kickoff` uses blueprints to propose a stack by level, and `/discover` uses `detect`.

## 17. Artifacts: visual work that is versioned, verifiable and indexed

Some outputs are read better as a page than as Markdown: a discovery report, an analysis, a stack map, a comparison of options, a release report, an architecture diagram, a retro board. agent-os treats them as **artifacts**, files in the repository with metadata. That way they are versioned by git, reviewed in PRs, linked from issues and readable by anyone with access to the project. Decision: [artifacts](../decisions/2026-11-18-artifacts-in-repo.md).

```
artifacts/
  2026-11-18-stack-map/
    artifact.yaml        # metadata: id, title, type, status, summary, refs, sources (with hashes), authors
    index.html           # self-contained page: inline CSS and JS, data embedded, no external calls
    data/…               # optional data files the page was built from
```

- **Types:** `discovery`, `analysis`, `stack-map`, `comparison`, `decision-support`, `release-report`, `retro`, `architecture`, `dashboard`.
- **Kinds:** a *snapshot* is frozen once merged (a new date means a new artifact), and *living* artifacts are regenerated in place, with history in git.
- **Viewing:** a generated GitHub Pages site serves every artifact plus an index (by type, date, area and linked issue). The index is built in CI from the `artifact.yaml` files and never committed. Private repositories use Pages with access control where the plan allows it, or the CI build attached to the PR.
- **Verifiable:** `sources` list the files and GitHub items an artifact was built from, with content hashes. `agent-os artifact verify` rebuilds or rechecks them and marks the artifact *stale* when a source changed. `doctor` checks metadata, links, size budgets, and that the page loads nothing from outside.
- **Linked:** `refs` point to issues, PRs and decisions. `/artifact link <id> <#N>` comments on the issue or PR with the link and the summary, in that thread's language. The PR template has an optional `## Artifacts` section, and journal entries reference artifacts by id.
- **Chronology:** `agent-os artifact log <id>` shows the artifact's git history, and the chronicle (§10) lists artifacts with the issues and PRs they belong to.

`/artifact` is the skill. It offers `new <type>` (from a template), `build`, `verify`, `link`, `list` and `publish`. `publish` can also mirror the page to an artifact host such as claude.ai, but those links are personal, so the repository copy stays the source of truth.

The first artifact in this repository is the [stack map](../../artifacts/2026-11-18-stack-map/index.html), built from the catalog.

## 18. Upstream: improving agent-os from the projects that use it

The projects that install agent-os find its gaps first. `/upstream` turns what they find into issues on the public repository (`cosmin-sisman/agent-os`), without leaking anything private. Decision: [upstream feedback](../decisions/2026-11-18-upstream-feedback.md).

- **Sources:**
  - something you say ("the /pr skill should also …");
  - a lesson that `/retro` marks as *generic*, meaning it is about agent-os rather than the project;
  - a `doctor` finding that is caused by the package itself;
  - a skill that failed in a way its contract did not expect.
- **Privacy first:** the issue is drafted from a whitelist: agent-os version, profile, the skill or command involved, the configuration keys involved (not their values), OS and Node versions, and your description. Project names, paths, code, remotes, people and secrets are removed. You see the exact text before anything is sent.
- **Duplicates:** it searches open and closed issues upstream and proposes a 👍 or a comment on an existing issue instead of a new one.
- **Form:** the upstream *Improvement* issue form (type `feature` or `bug`, area labels from the package taxonomy), in English, whatever the project's languages are.
- **Tracking:** the created issue's URL is written into the project's journal and, when it came from a lesson, into the lesson card (`upstream:`), so `/retro` can retire the local workaround once the fix ships in a new version. `agent-os update` lists the upstream issues that a new version closes.
- **Opt-out:** `upstream.enabled: false` in `agent-os.json` for teams that must not contact external repositories. The skill then writes the draft to a file instead.

## 19. Versions and safe updates

Five people on five laptops must run the same agent-os, and a new version must never break a working project. Decision: [safe updates](../decisions/2026-11-18-versions-and-safe-updates.md).

### One pinned version per project

`agent-os.json` records `"version": "0.4.2"`, an exact version. Hooks and skills call that version: through the project's `devDependencies` when it has a `package.json`, otherwise through `npx -y @cosmin-sisman/agent-os@<version>`. `doctor` and the SessionStart hook warn when someone's local copy differs. Upgrading is a team decision made in a PR, never a side effect of someone's `npx` cache.

### Semantic versioning, with a contract

The package follows semver. A **breaking** change means any change that needs a person or a migration: a renamed command or flag, a config key whose meaning changed, a skill whose steps a team relies on, or a removed file. Breaking changes ship only in a major release (a minor one before 1.0), always with a migration and a changelog entry.

### Lifecycle markers on everything that ships

The package manifest (`manifest.json`, generated at release) lists every managed file, skill, rule, command, config key, catalog entry and hook handler, each with a lifecycle state:

| State | Meaning | What users see |
|---|---|---|
| `new` | added in this version, may still change in the next minor | marked *new* in `update --plan`, `skills` and the docs |
| `stable` | covered by the semver contract | — |
| `deprecated` | still works; has `deprecatedIn`, `removeIn` and a `replacement` | `doctor` warns wherever it is used, with the replacement |
| `legacy` | kept only for projects that opt in (`legacy: ["old-flow"]`) | absent unless enabled; `doctor` lists it as debt |
| `removed` | gone; kept in the manifest so `update` can explain and migrate | `update` runs its migration or stops with instructions |

The minimum path is `new` → `stable` → `deprecated` (at least one minor version) → `legacy` or `removed`. Nothing goes from `stable` to `removed` directly.

### The update flow

```
agent-os update --plan        # read-only: what changes, grouped and explained
agent-os update               # on a new branch chore/agent-os-<version>, opened as a PR
```

1. **Plan.** Compare the pinned version with the target and list the changelog entries in between, grouped as Breaking, New, Deprecated, Legacy, Removed, Fixes and Chore. Add the files that would change, the files with local edits (three-way merge), the migrations that will run, and the deprecated items this project still uses.
2. **Preflight.** Require a clean working tree and a passing `doctor`, and check the minimum Node and Claude Code versions of the target release.
3. **Branch.** All changes happen on `chore/agent-os-<version>`. Git is the backup, and rollback is closing the PR (or reverting it).
4. **Migrate.** Versioned migrations (`migrations/<version>.mjs`) transform `agent-os.json`, registry entries, lesson and journal schemas and `stack.yaml`. Each one is idempotent and tested against fixture projects, and runs in order.
5. **Apply.** Write the managed files through the lock rules (§3). Local edits are merged, and conflicts go to `.rej` files listed in the PR.
6. **Verify.** Run `doctor`, `env` and the gate on the branch. The PR body carries the plan, the migration log, the conflicts and the results, plus a journal entry of type `release` for the upgrade.
7. **Merge** like any other PR. Teammates get the new pinned version on their next pull.

`agent-os update --channel next` tries pre-releases on a branch without changing the pin, which is useful for the agent-os maintainers and early adopters.

### For this repository

Releases of agent-os carry the same grouping in their GitHub Release notes, generated from the journal and from PR labels (`changelog:breaking`, `changelog:deprecation`, …). The manifest is produced in CI and checked: a removed entry without a migration, or a `deprecated` entry without `removeIn` and `replacement`, fails the release.
