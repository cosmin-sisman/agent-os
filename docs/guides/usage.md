# Using agent-os

This guide covers everyday work once agent-os is installed. It explains the daily loop, what each skill is for, how to pick a profile, a few common scenarios, and what to do when something is blocked. Install steps are in the [README](../../README.md#-quick-start).

You talk to the skills in Claude Code: type the slash command, or just say what you want in plain words. Each skill runs `agent-os` commands for its mechanical steps, so you can run those commands yourself in a terminal too. This guide is in English. The installed templates (rules, skills, issue forms) and the chat can be Romanian: see [a Romanian-speaking team](#a-romanian-speaking-team).

About the samples:
- **CLI output** is real. It comes from agent-os 0.1.2, run in a throwaway repository or read-only on this one, trimmed where marked `…`.
- **Agent replies** are marked *example*: they show the gist of what the agent says, and the wording varies.

## Contents

- [The daily loop](#the-daily-loop)
- [The skills](#the-skills)
- [Choosing a profile](#choosing-a-profile)
- [Use cases](#use-cases)
- [Troubleshooting](#troubleshooting)

## The daily loop

```text
/next  →  /start  →  work  →  /pr  →  /ship        and, from time to time, /release
```

| Step | What it does | What it enforces |
|---|---|---|
| `/next` | Ranks what needs you: your change requests, reviews asked of you, your issues, free issues in the current milestone | Nothing; it only reads |
| `/start` | Assigns you, creates the branch from the right base, links it to the issue, moves the issue to In Progress, checks it out | **Claiming before editing**: one issue, one branch, one owner. It names overlapping work |
| work | You and the agent change the code | Hooks guard as you go (Claude Code only): no push to `development` or `main`, no skipped git hooks, lessons recalled for the paths you touch |
| `/pr` | Opens the pull request (merge request on GitLab) only when it is ready | **The gate passed on this commit**, a **journal entry**, a non-empty **Lessons** section, a title in convention, a linked issue |
| `/ship` | Merges a green, reviewed change request, closes the issues it closes, keeps the referenced ones open, removes the branch and worktree | **Required checks** (`ci`, `agent-os/loop`) and approvals. A branch that is behind goes back to its author |
| `/release` | Merges `development` into `main` with a merge commit, tags, writes grouped notes, rolls the milestone, syncs back | Release checks, and asks first about risky changes (for example a destructive migration) |

`agent-os/loop` is a required check on every change request. It fails without a `## Lessons` section, or when the change records a lesson or decision but adds no journal entry. For a trivial change, write `None: <why>`. The journal (`.agent-os/journal/`) holds one small file per entry, so two change requests never conflict on it.

## The skills

Each section says when to use the skill, what to type, and what comes back. The slash form and the plain-words form do the same thing.

### /next

When: you sit down and want to know what matters most.

> `/next` · "what should I work on next?"

```text
$ agent-os next --limit 3
1. #59 Skill evals: fixture repositories and scenarios
   assigned to you and in progress (a branch exists)  →  continue #59
2. #262 Docs: real install steps in the README and a usage guide
   assigned to you and in progress (a branch exists)  →  continue #262
…
```

*Example reply:* "#59 is yours and already has a branch, so continuing it is the shortest path. Shall I `/start` it?"

### /ticket

When: you have an idea, a bug or a request that is not an issue yet. It searches for duplicates first, then files the issue with its labels, milestone and test scenarios.

> `/ticket` · "open an issue: the cart should show the total in euro"

It refuses a title that breaks the convention and says why:

```text
$ agent-os issue new --title "Distribution: accept the other-agents decision (AGENTS.md line, doctor, guides)" …
not created; fix:
  - the title is 79 characters; keep it to 70
```

Once the title is fixed, the issue is created:

```text
created #258: https://github.com/cosmin-sisman/agent-os/issues/258
```

### /start

When: you take an issue, either right after `/next` or when someone says "pick up #12".

> `/start 262` · "let's work on #262"

```text
$ agent-os start 262
started #262 on docs/262-real-install-steps-readme-usage (from development)
  assign @cosmin-sisman
  create docs/262-real-install-steps-readme-usage from development and link it to #262
…
Done means tested: add the tests the issue's scenarios describe in this branch.
```

An epic is not started directly; its open sub-issues are:

```text
$ agent-os start 56 --dry-run
#56 is done in parts: start one of its open sub-issues (#57, #59). One change request closes one issue.
```

### /test

When: an issue is created or started (to plan scenarios), and before a change request (to run the suites and find changed code with no test).

> `/test` · "what still needs a test here?"

```text
$ agent-os gate
agent-os: warning: 1 changed file(s) with no changed test: src/cart.mjs (agent-os test gaps)
| Suite | Command | Result | Time |
|---|---|---|---|
| test | `npm test` | passed | 0.3 s |

gate: passed
```

```text
$ agent-os test gaps
1 changed file(s) with no changed test:
  src/cart.mjs
Add the tests the issue's scenarios describe, or say in the change request why none is needed.
```

The suites come from `gate` in `agent-os.json`, for example `agent-os config set gate.test "npm test"`.

### /pr (/mr on GitLab)

When: the change is done. It checks readiness first, opens the change request only when nothing is missing, then follows its checks and review threads.

> `/pr` · "open the PR"

```text
$ agent-os pr preflight --title "feat(cart): show the total in euro [#3]" --body-file body.md
not ready:
  - title: the title lists #3, which the description neither closes nor references (add "Closes #N" or "Refs #N", or drop it from the title)
  - the body has no "## Lessons" section
  - "## How it was tested" is missing: the real commands and results
  - the body closes or references no issue: add "Closes #N"
…
```

*Example reply:* "Not ready yet: the description needs `Closes #3`, a Lessons section and how it was tested. I'll add them from what we did and run the gate again."

### /ship

When: the change request is green and approved.

> `/ship 259` · "merge it"

```text
$ agent-os ship 259
shipped PR #259 (2b317d6)
  #258: closed
  deleted origin/feat/258-accept-other-agents-decision-agents
  switched to development
  deleted the local branch feat/258-accept-other-agents-decision-agents
```

It refuses while a test scenario in the issue is not ticked. The fix is to tick the scenarios the tests cover, or move them to a follow-up issue.

### /release

When: you decide to release `development` to production, or to ship a hotfix. It never runs on its own.

> `/release 0.1.3` · "let's release what's on development"

```text
$ agent-os release plan --version 0.1.3
release v0.1.3: v0.1.2 → origin/development
title: release-4: 0.1.3

## Chore

- chore(release): sync v0.1.2 into development (#261)

To upgrade: `npx -y @cosmin-sisman/agent-os@0.1.3 update --plan`, then `update`.

No risks found.
…
```

When the plan finds a risk, such as a destructive migration, `/release` asks you before it finishes.

### /kickoff

When: a new product in an empty repository. It interviews you one question at a time, writes `docs/product.md`, proposes a stack from the catalog's blueprints, then creates the first milestone and issues.

> `/kickoff` · "I want to build a booking app for a small gym"

```text
$ agent-os stack propose --level 2
1. booking-app (Booking app, level 2, typescript)
   Public site, online booking and an admin panel. No backend of your own: the BaaS takes its place. …
   start from it: agent-os stack new --from booking-app
2. membership-monolith (Membership monolith, level 2, polyglot)
   Gym memberships, QR check-in and a front-desk panel. …
```

The issues come from the product doc, each citing its line (see `/ingest-docs`). The whole path is in [Start a new product](greenfield.md).

### /ingest-docs

When: the repository already has specifications. It turns them into epics and sub-issues that cite their source. When two specs disagree, it asks you before it creates anything.

> `/ingest-docs` · "create the issues from docs/"

```text
$ agent-os ingest plan docs/product.md
1 specification(s): 2 epic(s), 6 issue(s) in all

Cart  (docs/product.md:3)
  - Cart: A visitor adds products to a cart  (docs/product.md:4)
  - Cart: The cart shows the total in euro  (docs/product.md:5)

Checkout  (docs/product.md:7)
…
review it with the person, then: agent-os ingest apply
```

### /discover

When: you adopt agent-os in a repository with history. It infers the conventions the team already follows (commit style, branch prefixes, merge method, areas), each with its evidence, and applies only the ones you accept.

> `/discover` · "what conventions does this repo already follow?"

*Example reply:* "From the last 200 commits: Conventional Commits in 94% (evidence: …), `feat/` and `fix/` branch prefixes, squash merges. Apply all three, or pick?"

Its CLI step is `agent-os discover plan`. No sample is shown here: in 0.1.2 that command fails on this repository with an API error, which is reported as a bug.

### /doctor

When: you want to know whether the setup is healthy, after an update, before a release, or when a hook or skill behaves strangely.

> `/doctor` · "is our agent-os setup OK?"

```text
$ agent-os doctor --offline
warn  [area-map] the AGENTS.md area map does not mention docs/, src/
      fix: add one table row per missing directory: | `dir/` | what it holds |
info  [agents] only Claude Code runs the hooks (guards, session context, reminders) and the subagent fan-out (/audit lenses, /discover areas). …

readiness 98/100: 21 ok, 1 warn, 0 fail (skipped: issues, labels, titles)
```

Each finding names its fix, and `agent-os doctor --fix` applies the mechanical fixes.

### /env

When: someone joins the project, a tool or MCP server is missing, or a skill fails for an environment reason.

> `/env` · "do I have everything this project needs?"

```text
$ agent-os env --fast
nothing to check: agent-os.json has no requires yet

fast check: 0 failing, 0 warning(s), 0 ok
```

Once `requires` lists tools, CLIs, MCP servers or variables, it prints the exact command that fixes each gap. `agent-os env propose` suggests requirements from the stack.

### /lessons

When: something went wrong or took long and should not happen again, or before you work in an unfamiliar area.

> `/lessons` · "remember that prices must be integers in cents"

```text
$ agent-os lessons add "Prices are integers in cents: floats round wrong on totals, e.g. 0.1+0.2" --area cart --path "src/cart*" --source "#3"
captured .agent-os/lessons/inbox/2026-11-18T22-01-cosmin-sisman-prices-are-integers-in-cents.md (in the inbox; /lessons review or /retro triages it)
```

Once triaged, a lesson comes back by itself when someone works on `src/cart*`.

### /retro

When: at every release, or when the lessons inbox fills up. It turns lessons into rule changes or active cards, or rejects them.

> `/retro` · "let's triage the lessons"

```text
$ agent-os retro plan --offline
1 lesson(s) in the inbox, in 1 theme(s).
  2026-11-18T22-01-cosmin-sisman-prices-are-integers-in-cents: card: specific to some paths: recall it as a card
Decide each with agent-os retro apply --accept/--promote/--reject.
```

### /standards

When: there are several reasonable ways to implement something, or you want a file or diff checked against the coding standards. It compares the options, picks one with a reason, and implements only that one.

> `/standards` · "should we round each line or the total?"

```text
$ agent-os standards choice --title "Where to round prices" --option "a: round each line" --option "b: round the total" --pick a --why "Each invoice line must match what the visitor saw." --dry-run
Where to round prices

- **a**: round each line ← chosen
- **b**: round the total

**Choice: a.** Each invoice line must match what the visitor saw.
Only a is implemented; b is not.
```

### /stack

When: you want to know what the project is built with, compare two technologies, or change a layer. Every recommendation shows the catalog's scores.

> `/stack` · "what stack fits a small booking app?"

The `agent-os stack propose` output is shown under `/kickoff`. Other steps are `agent-os stack show`, `stack compare <tech> <tech>` and `stack set <layer> <tech> --why …` (recorded as a decision).

### /system

When: you need the map of components, what each exposes and consumes, and where they live: before a security or architecture review, or after you add a service.

> `/system` · "how is this project put together?"

```text
$ agent-os system detect
shape: single app (npm), 1 component(s)
  shop                 package  .
                       evidence: package.json
```

### /audit

When: you want an idea, a spec, the project, a release, a problem or a whole system reviewed through separate lenses, with evidence behind every finding.

> `/audit` · "audit this project before we hand it over"

```text
$ agent-os audit plan "this project"
subject: idea: a description of something to build
confirm with the person: Audit this as an idea (a description of something to build)? Or as one of: spec, project, release, problem, system.
lenses (4): product, architecture, stack, performance-cost

run each lens in its own subagent with its brief (agent-os audit plan … --json gives them), save each answer as JSON, then agent-os audit merge <answers>
```

It asks what kind of subject this is before it runs. The merged report becomes an artifact, and its findings become issues only once you confirm.

### /ci

When: someone adds or changes a workflow or pipeline, or asks whether CI is safe.

> `/ci` · "review our GitHub Actions"

```text
$ agent-os ci review
3 file(s): 0 error(s), 0 warning(s), 0 note(s)
```

It checks for least-privilege permissions, pinned actions and images, timeouts, concurrency, and untrusted input in scripts.

### /artifact

When: a result reads better as a page than as Markdown, such as an analysis, a comparison, a release report or a stack map. Artifacts live in `artifacts/`, are verified against their sources and are linked from issues.

> `/artifact` · "make a page comparing the pricing options"

```text
$ agent-os artifact new analysis cart-pricing --title "Cart pricing options" --dry-run
would create artifacts/2026-11-18-cart-pricing/ (analysis, snapshot, draft): artifact.yaml, template.html, data.json, index.html. Fill in data.json, then agent-os artifact build; status current when it is ready.
```

### /handoff

When: you stop for the day, go on leave, or hand an issue to someone else. It posts a status comment on each issue you hold with work in flight and adds one handoff journal entry.

> `/handoff` · "I'm done for today"

```text
$ agent-os handoff --dry-run
would comment on 3 issue(s) you hold with work in flight:

#262 Docs: real install steps in the README and a usage guide
Handoff from @cosmin-sisman:

- Branch: `docs/262-real-install-steps-readme-usage`
- Change request: none yet
- 2 test scenario(s) still unticked
…
```

### /runbook

When: a product is in maintenance or about to change hands. It writes the deploy, rollback and restore runbooks and the takeover dossier, and runs the upkeep audit.

> `/runbook` · "write down how to deploy and roll back"

```text
$ agent-os runbook --dry-run
would be written docs/runbooks/deploy.md (3 fact(s) to fill)
would be written docs/runbooks/rollback.md (2 fact(s) to fill)
would be written docs/runbooks/restore.md (3 fact(s) to fill)
would be written docs/runbooks/takeover.md (9 fact(s) to fill)

fill in what the repository cannot tell, then walk them with agent-os security exercise
```

### /orchestrate

Optional. Use it when you run several sessions on one laptop and want one of them to coordinate the others. It never coordinates other people; teams coordinate on the platform.

> `/orchestrate` · "coordinate my sessions: brief one worker per issue"

```text
$ agent-os orchestrate brief 3
briefed w3. Give this to the worker session:

BRIEF #3:
Worktree: (agent-os start <n> --worktree)

1. Claim it first: agent-os start 3 --worktree, and work only in that worktree.
…
5. Permissions are the person's: a refused action is reported to the person, never retried through another session.
```

### /upstream

When: agent-os itself should do something better. It drafts an issue for the public agent-os repository with private details removed, and files it only once you approve the exact text.

> `/upstream` · "agent-os should say which hook is missing"

```text
$ agent-os upstream draft --title "Name the missing hook in doctor" --what "doctor says there are no agent-os hooks, but not which event lacks one" --kind feature
Title: Name the missing hook in doctor
Labels: type:feature, upstream

### agent-os version

0.1.2
…
```

## Choosing a profile

`init` reads the repository and suggests a profile; it writes nothing:

```text
$ agent-os init --detect
suggested profile: greenfield (high): 0 commit(s) and no code: a new project
  commits 0 (0 in 90 days), last never, tags 0
  code files 0, documents 0, CI none, agent files none
```

| Your repository looks like | Profile | Start with | Guide |
|---|---|---|---|
| empty, or a few commits and no code | `greenfield` | `/kickoff` | [Start a new product](greenfield.md) |
| specifications or docs, little code | `spec-first` | `/ingest-docs` | [From specifications to issues](spec-first.md) |
| recent commits and open change requests | `active` | `/discover`, and choose forward-only or retrofit | [Adopt agent-os in a live repository](active.md) |
| tags and releases, few recent commits | `maintenance` | `/audit`, `/runbook`, `/handoff` | [Keep a finished product healthy](maintenance.md) |

For an `active` repository:
- `--methodology forward-only` applies the conventions from today on and leaves history as it is. Choose it when the team is busy and history is good enough.
- `--methodology retrofit` also brings the history into the system (`agent-os retrofit plan`, then `retrofit apply`). Choose it when you want past work to be searchable.

## Use cases

### A solo greenfield product

Ana starts a booking app alone. She creates the repository, runs `init --profile greenfield --solo`, opens Claude Code and types `/kickoff`. After the interview she has `docs/product.md`, a stack from a blueprint, a first milestone and issues. From then on it is the daily loop. With no reviewer, `--solo` sets required approvals to 0, but `ci` and `agent-os/loop` still gate every merge.

```bash
agent-os init --profile greenfield --solo --lang en --yes
agent-os init --me --chat en --yes
```

### A team of three on an existing repository

The team lead runs `init --detect`, then `init --profile active --methodology forward-only --team`, and opens one change request with the result. Each person then runs `agent-os init --me` on their own laptop. `/start` assigns and branches, so everyone sees who holds what. When two branches touch the same files, `start` and `pr preflight` name the overlap. `--team` requires one approval per change request.

```bash
agent-os init --profile active --methodology forward-only --team --yes
agent-os setup --dry-run
```

`setup` makes the platform match the agreement: branch protection, labels and milestones. Run it once the team agrees.

### A GitLab self-managed team

Pass the platform and the host, because the remote's host name alone does not say it is GitLab. Log in with `glab auth login --hostname <host>` first. `/pr` is installed as `/mr`, and references use `!N` for merge requests.

```bash
agent-os init --profile greenfield --platform gitlab --host https://gitlab.example.com --project team/app --team --yes
```

### A Romanian-speaking team

Every team area (issues, change requests, labels, milestones, docs, journal) can be `ro`, which means Romanian without diacritics (ASCII only). Areas can also be mixed: here commits stay in English. Each person picks their own chat language.

```bash
agent-os init --profile greenfield --platform gitlab --host https://gitlab.example.com --project echipa/magazin --team --lang ro --area-lang commits=en --chat ro --yes
```

```text
$ agent-os lang show
chat          ro  (personal)
issues        ro
prs           ro
commits       en
branches      ro
labels        ro
…
```

The installed AGENTS.md block is in Romanian too:

```text
Acest repository urmeaza agent-os 0.1.2. Reguli in `.claude/rules/`, skill-uri in `.claude/skills/` (incepe cu /next, /start, /pr si /ship), setarile echipei in `agent-os.json`.
```

`agent-os lang set <area> <en|ro>` changes one area later, renaming the labels and milestones with it.

### A hotfix

Production is broken. Start the issue as a hotfix: the branch comes from `main`, not `development`. Then fix it, `/pr`, and `/release` with the hotfix flag, which releases to `main` and syncs back to `development`.

```bash
agent-os start 41 --hotfix
agent-os release plan --version 1.4.1 --hotfix
```

### An audit and security pass

Before a handover, or every quarter:
- `/audit` reviews the project lens by lens;
- `agent-os security pass` checks the change for each layer it touches and reads scanner reports;
- the advisory watch follows the advisories (GHSA, OSV, KEV) that touch your dependencies.

A vulnerability is never filed as a public issue: it goes to a draft security advisory on GitHub, or a confidential issue on GitLab.

```bash
agent-os audit plan "this project" --as project
agent-os security pass
agent-os security watch --dry-run
```

```text
$ agent-os security pass

no scanner reports were read (security.reports or --report): secret scanning and dependency audit results are missing from this pass

security pass on 2 changed file(s), layers none: 0 failing, 0 warning(s)
```

### Parallel sessions with the orchestrator

You run three sessions on one laptop. Turn the role on in your personal settings, then claim it in one session. That session briefs workers and does not edit files (a guard refuses it). Each worker runs `agent-os start <n> --worktree` and works in its own worktree. The ledger is personal, in `.agent-os/cache/`, and never committed.

```bash
agent-os init --me --orchestrator --sessions 3 --yes
agent-os orchestrate claim
agent-os orchestrate brief 3
agent-os orchestrate reconcile
```

```text
$ agent-os init --me --orchestrator --sessions 3 --yes
wrote .agent-os/local.json: chat ro, 3 session(s) with an orchestrator, 1500 MB free memory minimum
```

### Using Codex or Cursor

AGENTS.md and the CLI work in any agent, so a mixed team follows one flow. The installed AGENTS.md block tells other agents that a request for `/<name>` means reading `.claude/skills/<name>/SKILL.md` and following it, and that every step in it is an `agent-os` command.

Two parts work only in Claude Code:
- **Hooks**: guards, session context and reminders. In other agents the same rules apply later, at push time, through the required checks and branch protection. Nothing stops you while you edit.
- **Subagent fan-out**: the `/audit` lenses and `/discover` areas. Other agents run the same briefs one after another.

`agent-os doctor` names both in an `info` note. The background is in the [decision record](../decisions/2026-11-18-other-agents-agents-md-first.md).

## Troubleshooting

**Something is off.** Run `doctor` first. Every finding names its fix, and `--fix` applies the mechanical ones.

```bash
agent-os doctor
agent-os doctor --fix
```

**A push to `development` or `main` is blocked.** Long-lived branches change only through change requests. Locally, the guard says so. For the first 14 days after install (adoption mode), it only warns:

```text
agent-os guard "push-protected": this pushes to development: pushing to a long-lived branch skips review: claim the issue first (agent-os start <n>) so the work is on its own branch, then open a change request
(adoption mode until 2026-12-02: allowed this time)
```

On the platform, branch protection refuses the push. Either way, the fix is to move the commits to an issue branch (`agent-os start <n>`) and open a change request. Never work around a guard.

**`agent-os/loop` fails.** Its output says what is missing. Run the same check locally before you push the description:

```bash
agent-os check loop --body-file body.md
```

```text
agent-os/loop: 2 problem(s)
  - the description has no "## Lessons" section: add it with the lesson, or "None: <why>"
  - the change request records a lesson or decision but adds no journal entry: agent-os journal add … (or say "None: <why>" for a trivial change)
```

Add the Lessons section, then add a journal entry with `agent-os journal add --type note --title "…" --area <area>`.

**A merge conflict.**
- A change request that is behind or conflicts with `development` goes back to its author: `/ship` does not merge it, and nobody else updates your branch for you. Update it with the base yourself, run the gate again, and push.
- After `agent-os update`, a managed file you also changed is merged three ways. Where the merge cannot decide, it leaves a `.rej` file next to it, and `doctor` reports it ("holds an unresolved update conflict") until you resolve it and delete the `.rej`.

```bash
agent-os update --plan
agent-os update
```
