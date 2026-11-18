// The GitHub plan for this repository: labels, milestones, epics and issues with their relationships.
// Read by setup.mjs, which creates them idempotently. Edit here, then rerun setup.mjs.

const D = 'docs/design/overview.md'
const ADR = (s) => `docs/decisions/2026-11-18-${s}.md`

export const labels = [
  ['type:feature', '1f6feb', 'A new capability'],
  ['type:bug', 'd73a4a', 'Something works wrong'],
  ['type:docs', '0075ca', 'Documentation only'],
  ['type:chore', 'bfdadc', 'Tooling, setup, maintenance'],
  ['type:epic', '5319e7', 'Large work split into sub-issues'],
  ['type:research', 'c5def5', 'Investigation that ends in a decision'],
  ['priority:p0', 'b60205', 'Critical: blocks the milestone'],
  ['priority:p1', 'd93f0b', 'High'],
  ['priority:p2', 'fbca04', 'Normal'],
  ['priority:p3', 'c2e0c6', 'Low'],
  ['size:s', 'ededed', 'Up to half a day'],
  ['size:m', 'd4c5f9', 'One to two days'],
  ['size:l', 'bfd4f2', 'Three days or more; consider splitting'],
  ['area:cli', '0e8a16', 'Command line, config, templates, lock'],
  ['area:i18n', '0e8a16', 'Languages per area'],
  ['area:github', '0e8a16', 'GitHub setup, tracker adapter, issues, PRs'],
  ['area:skills', '0e8a16', 'Core workflow skills'],
  ['area:registry', '0e8a16', 'Skill registry, slots, external skills'],
  ['area:knowledge', '0e8a16', 'Journal, decisions, chronicle, map'],
  ['area:lessons', '0e8a16', 'Lessons learned store and recall'],
  ['area:loop', '0e8a16', 'Self-improvement loop, doctor, retro'],
  ['area:collab', '0e8a16', 'Multi-person and multi-session work'],
  ['area:testing', '0e8a16', 'Test skill, gate, test gaps'],
  ['area:ci', '0e8a16', 'GitHub Actions, workflows'],
  ['area:init', '0e8a16', 'Detection, profiles, adoption'],
  ['area:env', '0e8a16', 'Environment, MCP servers, scopes'],
  ['area:hooks', '0e8a16', 'Claude Code hooks runner'],
  ['area:distribution', '0e8a16', 'npm, plugin, docs site'],
  ['needs-decision', 'e99695', 'Waits for a decision before work starts'],
  ['good first issue', '7057ff', 'Small and well-scoped'],
  ['dogfood', 'f9d0c4', 'Uses agent-os on this repository'],
]

export const milestones = [
  ['v0.1 Foundations', 'CLI skeleton, config, template engine, managed files and lock, language engine, hooks runner, environment and MCP check, this repository\'s CI.'],
  ['v0.2 Core workflow', 'GitHub setup with development as default branch, tracker adapter, /ticket, /start, /pr, /ship, /release, /next, title and commit checks.'],
  ['v0.3 Knowledge and loop', 'Journal, decision records, lessons learned with recall, chronicle, on-demand map, /retro, doctor, the required loop check in CI.'],
  ['v0.4 Collaboration', 'Five or more people on their own laptops: claim protocol, overlap detection, comment-driven work, optional per-laptop orchestrator, /handoff.'],
  ['v0.5 Skill registry', 'Core, external and local skills registered separately, capability slots, skill add/remove/update/new, separate indexes.'],
  ['v0.6 Testing and CI', '/test wired into tickets and PRs, one gate locally and in CI, /gh-actions, generated workflows, test gaps.'],
  ['v0.7 Init and adoption', 'Repository state detection, init interview, profiles, retrofit and forward-only adoption, /discover, /kickoff, /ingest-docs, maintenance set, packs.'],
  ['v1.0 Release', 'Claude Code plugin, npm publish with provenance, skill evals, documentation, dogfooding on this repository.'],
]

// e(key, title, milestone, labels, body) for epics; i(key, title, milestone, labels, parent, body, blockedBy)
const e = (key, title, milestone, goal, why, refs) => ({ key, epic: true, title, milestone, labels: ['type:epic', 'priority:p1'], goal, why, refs })
const i = (key, title, milestone, labels, parent, b, blockedBy = []) => ({ key, title, milestone, labels, parent, blockedBy, ...b })

const M1 = 'v0.1 Foundations', M2 = 'v0.2 Core workflow', M3 = 'v0.3 Knowledge and loop', M4 = 'v0.4 Collaboration'
const M5 = 'v0.5 Skill registry', M6 = 'v0.6 Testing and CI', M7 = 'v0.7 Init and adoption', M8 = 'v1.0 Release'

export const issues = [
  // ── v0.1 ──────────────────────────────────────────────────────────────
  e('E1', 'Foundations: the CLI and its engines', M1,
    'A zero-dependency Node CLI that can read the configuration, render templates in either language, install and update managed files safely, run hooks on every OS and check the environment.',
    'Every later milestone is a set of templates and subcommands on top of these engines.', `${D} §3, §4, §14, §15`),
  i('repo-ci', 'Repository tooling and CI for agent-os itself', M1, ['type:chore', 'area:ci', 'priority:p0', 'size:s', 'good first issue'], 'E1', {
    context: 'The repository has docs only. Nothing runs tests or lints workflows.',
    goal: 'Every PR into development runs the tests on Linux, macOS and Windows and lints the workflows.',
    in: ['`package.json` scripts (`test` with `node:test`)', '`.github/workflows/ci.yml`: matrix ubuntu/macos/windows × Node 20/22, actionlint', 'least-privilege permissions, actions pinned to SHAs, concurrency, timeouts', 'a ruleset requiring the CI check on development and main'],
    out: ['publishing (v1.0)'],
    ac: ['a PR shows the CI check on three OSes', 'actionlint passes', 'the check is required on development'],
    scenarios: ['Given a PR with a failing test, when CI runs, then the check fails and the PR cannot merge'],
  }),
  i('cli', 'CLI skeleton: command router, --json, --dry-run, exit codes', M1, ['type:feature', 'area:cli', 'priority:p0', 'size:m'], 'E1', {
    context: 'The design names about twenty subcommands; they need one consistent entry point.',
    goal: '`agent-os <command>` with shared flags, help, and stable exit codes (0 ok, 1 check failed, 2 could not run).',
    in: ['`bin/agent-os.mjs` with `node:util` parseArgs', 'subcommand registry with lazy imports', '`--json`, `--dry-run`, `--cwd`, `--verbose`', 'consistent error output'],
    out: ['the subcommands themselves'],
    ac: ['`agent-os --help` lists commands', '`agent-os unknown` exits 2 with a hint', 'each command module is a separate file'],
    scenarios: ['Given `--json`, when a command fails, then stdout is valid JSON with an `error` field and the exit code is 2'],
  }, ['repo-ci']),
  i('config', 'Config: agent-os.json (team) and .agent-os/local.json (personal)', M1, ['type:feature', 'area:cli', 'priority:p0', 'size:m'], 'E1', {
    context: 'Every value that was hard-coded in the reference workflow (repository, branches, ports, milestones, languages) must come from configuration, split between team and person.',
    goal: 'A validated, documented configuration with defaults, where team values are committed and personal ones never are.',
    in: ['JSON schema for both files, published with the package', 'defaults and validation with precise messages', 'merging: personal values override only keys marked personal', '`agent-os config get|set`', '`.gitignore` entries for local and cache'],
    out: ['the init interview (v0.7)'],
    ac: ['invalid config names the key and the expected value', 'a personal key in the team file is rejected', 'schema documented in docs/'],
    scenarios: ['Given `languages.chat` in agent-os.json, when validated, then it fails: chat is personal'],
  }, ['cli']),
  i('templates', 'Template engine: placeholders, conditionals, per-language variants', M1, ['type:feature', 'area:cli', 'priority:p0', 'size:m'], 'E1', {
    context: 'Skills, rules and GitHub templates must render for any repository, pack set and language.',
    goal: 'A small, dependency-free engine: `{{path.to.value}}`, `{{#if pack.x}}…{{/if}}`, `{{#each}}`, and file variants `name.en.md` / `name.ro.md` chosen per area.',
    in: ['engine with escaping rules for Markdown, JSON and YAML', 'variant selection by area language', 'unit tests with fixtures'],
    out: ['the content of the templates'],
    ac: ['an unknown placeholder fails the render with the file and line', 'rendering is deterministic'],
    scenarios: ['Given issues in ro and PRs in en, when the GitHub templates render, then the issue forms are ro and the PR template is en'],
  }, ['config']),
  i('lock', 'Managed files: lock.json, update with three-way merge, managed blocks, eject', M1, ['type:feature', 'area:cli', 'priority:p1', 'size:l'], 'E1', {
    context: `Decision: ${ADR('managed-files-and-lock')}. Without it every installed copy drifts.`,
    goal: '`install`, `update` and `eject` that never destroy local edits.',
    in: ['`.agent-os/lock.json` (path, version, hash)', 'three-way merge, conflicts to `.rej` with a proposal', 'managed block in Markdown, managed hook entries in settings.json', '`update --relock`'],
    out: ['remote fetching of new versions beyond npm'],
    ac: ['unmodified managed file is replaced on update', 'modified file is merged; conflicts produce .rej and exit 1', 'content outside managed blocks is byte-identical after update'],
    scenarios: ['Given a user edited a managed rule, when update brings a change to another line, then both changes are present', 'Given AGENTS.md with team text around the managed block, when update runs, then only the block changes'],
  }, ['templates']),
  i('i18n', 'Language engine: en or ASCII ro, chosen per area', M1, ['type:feature', 'area:i18n', 'priority:p0', 'size:m'], 'E1', {
    context: `Decision: ${ADR('language-per-area')}. Areas: chat (personal), issues, prs, commits, branches, labels, milestones, releases, codeComments, docs, journal.`,
    goal: 'Every text agent-os or its skills produce follows the language of its area; ro never contains diacritics.',
    in: ['area resolver used by templates and skills', 'dictionaries for labels and milestones keyed by stable ids', 'ASCII check for ro areas (`ă â î ș ț`, comma and cedilla forms, upper case)', 'rule text telling agents which language to write where'],
    out: ['renaming existing labels (lang set, v0.2)'],
    ac: ['each area can be set independently', 'the ASCII check reports file, line and character', 'dictionaries cover every core label and milestone'],
    scenarios: ['Given labels=ro, when labels render, then `type:bug` becomes its ro dictionary name', 'Given a ro issue body containing "ș", when checked, then it fails'],
  }, ['config']),
  i('hooks', 'Hooks runner: one cross-platform `agent-os hook <event>` entry', M1, ['type:feature', 'area:hooks', 'priority:p1', 'size:m'], 'E1', {
    context: 'The reference workflow chained shell one-liners per hook; they break on Windows and are hard to update.',
    goal: 'settings.json carries one entry per event (SessionStart, PreToolUse, PostToolUse, Stop) calling the runner, which dispatches to core and pack handlers with timeouts.',
    in: ['runner with per-handler timeout and isolation (a failing handler never blocks the session unless it is a guard)', 'guard handlers configurable as rules (command needs variable, heavy command below free RAM, forbidden flags such as --no-verify)', 'adoption mode: warn-only until a date'],
    out: ['the content of loop and lessons handlers (v0.3)'],
    ac: ['works in PowerShell, bash and zsh sessions', 'a crashing handler is reported once and skipped'],
    scenarios: ['Given adoption mode, when a guard would refuse, then it warns and allows'],
  }, ['cli']),
  i('env', 'Environment check: MCP servers, CLIs, GitHub scopes, variables (`agent-os env`, `/env`)', M1, ['type:feature', 'area:env', 'priority:p1', 'size:m'], 'E1', {
    context: `Decision: ${ADR('environment-check')}. Teammates end up with different MCP servers, scopes and versions; failures appear late.`,
    goal: 'One command tells each person what is missing or misconfigured on their laptop and in the repository, with the fix command.',
    in: ['`requires` in agent-os.json: mcp (name, scope, transport, optional, why), cli versions, githubScopes, env names, plugins', 'repo side: .mcp.json complete, placeholders not literal secrets', 'laptop side: `claude mcp list`, versions, `gh auth status` scopes, variables present (never printed)', 'fast offline subset for SessionStart (< 1 s)', '`/env` skill that explains and repairs'],
    out: ['installing MCP servers without asking'],
    ac: ['missing project server → exact `claude mcp add` command', 'missing `project` scope → `gh auth refresh -s project`', 'no secret value ever appears in output'],
    scenarios: ['Given .mcp.json with a literal token, when env runs in CI, then it fails and names the key, not the value', 'Given an optional server missing, then it is a warning, not a failure'],
  }, ['config']),

  // ── v0.2 ──────────────────────────────────────────────────────────────
  e('E2', 'Core workflow: from ticket to release', M2,
    'The core skills and the CLI subcommands they call: /ticket, /start, /pr, /ship, /release, /next, on a repository set up with development as the default branch.',
    'This is the flow every other milestone plugs into.', `${D} §7, §8, §9; ${ADR('integration-branch-is-default')}`),
  i('gh-setup', 'Platform setup on GitHub: development as default branch, rulesets, labels, milestones, forms', M2, ['type:feature', 'area:github', 'priority:p0', 'size:m'], 'E2', {
    context: 'Closes #N only closes issues when the PR merges into the default branch.',
    goal: '`agent-os github setup` makes a repository ready: integration branch created and default, rulesets on both branches, labels and milestones from config, issue forms and PR template in the configured languages.',
    in: ['branch creation and default switch', 'rulesets: no direct push, no force push, no deletion, required checks when present', 'label sync (create, update, rename by stable id)', '`agent-os lang set <area> <lang>` renames labels and milestones in place', 'dry-run plan'],
    out: ['Projects v2 board creation (separate issue)'],
    ac: ['idempotent: a second run changes nothing', 'renaming labels keeps them on issues'],
    scenarios: ['Given a repo with main only, when setup runs, then development exists, is default, and both are protected'],
  }, ['templates', 'i18n']),
  i('tracker', 'Tracker adapter interface and GitHub implementation', M2, ['type:feature', 'area:github', 'priority:p0', 'size:l'], 'E2', {
    context: 'Skills need create, relate and move operations without composing gh commands.',
    goal: 'One interface (create, update, relate parent/child, blocked-by/blocking, assign, link branch, link PR, set status, progress) with a GitHub implementation using sub-issues and issue dependencies APIs, and Projects v2 when available.',
    in: ['REST + GraphQL through `gh api`', 'sub-issues and dependencies endpoints', 'Projects v2 fields (Status, Priority, Size, Iteration) when configured', 'rate-limit handling and caching'],
    out: ['GitLab, Jira, Linear adapters (packs, later)'],
    ac: ['each operation has --dry-run and --json', 'missing project scope degrades to a warning'],
    scenarios: ['Given an epic and a child, when relate runs, then the child appears under the epic in GitHub'],
  }, ['cli']),
  i('ticket', '/ticket: complete issues with multiple labels, relationships and test scenarios', M2, ['type:feature', 'area:skills', 'area:github', 'priority:p0', 'size:m'], 'E2', {
    context: `${D} §8. The reference workflow allowed one label only and no assignees beyond the owner.`,
    goal: 'An issue that has everything GitHub allows: title convention, body from the form, one type + one priority + one or more areas + optional size and flags, milestone, assignees, parent, blocked-by/blocking, and a Test scenarios section.',
    in: ['duplicate search and "extend instead" proposals', '`agent-os issue new` used by the skill', 'calls `/test plan` for scenarios', 'language from the issues area', 'Learn step at the end'],
    out: ['branch linking (happens in /start)'],
    ac: ['refuses an issue without milestone or type', 'blocked-by is set through the dependencies API'],
    scenarios: ['Given a request overlapping an open issue, when /ticket runs, then it proposes a comment on that issue and creates nothing'],
  }, ['tracker', 'gh-setup']),
  i('start', '/start: claim the issue, branch from development, optional worktree', M2, ['type:feature', 'area:skills', 'priority:p1', 'size:m'], 'E2', {
    context: 'Starting work must be visible to the team and must cut from the right base.',
    goal: 'Assign yourself, link the branch with `gh issue develop --base <integration>`, set In Progress, create a worktree when the person works with several sessions, recall lessons for the issue\'s areas.',
    in: ['branch naming from labels', 'one PR closes one issue: parts get sub-issues', 'refuses issues assigned to others unless forced', 'runs `overlap` and `lessons recall`'],
    out: [],
    ac: ['the branch appears in the issue\'s Development panel', 'hotfix branches cut from production'],
    scenarios: ['Given an issue assigned to someone else, when /start runs, then it stops and suggests a comment'],
  }, ['tracker']),
  i('pr', '/pr: gate, journal entry, Lessons, title and template, checks and review threads', M2, ['type:feature', 'area:skills', 'priority:p0', 'size:l'], 'E2', {
    context: 'The reference /pr skill was the strongest part of the flow; it must become configurable and carry the journal entry.',
    goal: 'Run the gate for the diff, write the journal entry and the Lessons section, commit in convention, open the PR in the prs language, record it on the issue, watch checks, handle review threads.',
    in: ['`agent-os gate` per changed paths', 'review via the `review` slot', 'journal entry file in the same commit', '`agent-os check title`', 'answers review threads in their language'],
    out: [],
    ac: ['never opens a PR with a failing check', 'the PR body has a non-empty Lessons section'],
    scenarios: ['Given a diff touching only docs, when /pr runs, then only the docs suites run'],
  }, ['start', 'conventions']),
  i('ship', '/ship: merge into development, close issues with a comment, clean up', M2, ['type:feature', 'area:skills', 'priority:p1', 'size:s'], 'E2', {
    context: 'Merging is mechanical but full of traps (worktree branch deletion, Refs vs Closes, behind branches).',
    goal: 'Merge a green, reviewed PR with the configured method, verify issues closed, comment in the issues language, set Done, remove branch and worktree.',
    in: ['preconditions check', 'behind/conflicting PR goes back to its author', 'Refs issues stay open with a progress comment'],
    out: [],
    ac: ['refuses with an unchecked "Before merge" item', 'reopens an issue closed by mistake through a Refs PR'],
    scenarios: ['Given a PR with Refs #5, when shipped, then #5 stays open with a comment'],
  }, ['pr']),
  i('release', '/release: release PR, merge commit, tag, GitHub Release, milestone roll', M2, ['type:feature', 'area:skills', 'priority:p1', 'size:l'], 'E2', {
    context: 'Production releases need reading what goes in (migrations, env) and verifying the deploy.',
    goal: 'Open or update the release PR, read destructive changes and new variables, merge with a merge commit, tag, publish notes, roll the rolling milestone, run pack verifiers and the env check, write a release journal entry.',
    in: ['hotfix mode with sync back to development', 'ask-first cases', 'pack hooks for deploy verification'],
    out: ['stack-specific verification (packs)'],
    ac: ['never squashes or deletes the integration branch', 'safe to rerun'],
    scenarios: ['Given a release with a destructive migration, when /release runs, then it stops and asks'],
  }, ['ship']),
  i('next', '/next: recommend what to work on, with reasons', M2, ['type:feature', 'area:skills', 'area:github', 'priority:p0', 'size:m'], 'E2', {
    context: `${D} §9. People ask the agent where to start; the answer should come from the repository, not from memory.`,
    goal: '`agent-os next --json` scores candidates (your PRs needing changes, reviews requested from you, your in-progress issues, your unblocked assigned issues by milestone and priority, unassigned issues in the current milestone) and the skill explains the top three.',
    in: ['blocked issues and others\' assignments excluded with a note', 'bonus for areas you touched recently', 'offers /start on the choice'],
    out: [],
    ac: ['deterministic for the same GitHub state', 'explains each recommendation in one line'],
    scenarios: ['Given a PR of yours with requested changes, when /next runs, then it comes first'],
  }, ['tracker']),
  i('conventions', 'Title and commit checks: `agent-os check title|commit`', M2, ['type:feature', 'area:github', 'priority:p1', 'size:s', 'good first issue'], 'E2', {
    context: 'PR titles become squash commits; their issue suffix must match the body.',
    goal: 'Configurable checks for PR titles (`type(scope): summary [#N]`, length, suffix matching Closes/Refs both ways) and commit messages.',
    in: ['exit 0/1/2 semantics', 'release title form', 'used by /pr, /ship and CI'],
    out: [],
    ac: ['explains exactly what to change'],
    scenarios: ['Given a body with Closes #3 and a title ending [#4], then exit 1 naming both'],
  }, ['cli']),
  i('projects', 'Optional GitHub Projects v2 board: creation and field sync', M2, ['type:feature', 'area:github', 'priority:p2', 'size:m', 'needs-decision'], 'E2', {
    context: 'Projects v2 needs the `project` token scope. The design should work without it.',
    goal: '`agent-os github project` creates or links a board with Status, Priority, Size and Iteration, and `sync` keeps issues placed.',
    in: ['decide the default field set', 'sync dry-run', 'graceful degradation without scope'],
    out: [],
    ac: ['without scope every other command still works'],
    scenarios: ['Given no project scope, when /ticket runs, then it warns once and continues'],
  }, ['tracker']),

  // ── v0.3 ──────────────────────────────────────────────────────────────
  e('E3', 'Knowledge and the self-improvement loop', M3,
    'History, lessons and the loop that keeps the agent system current, built from small files that never conflict and enforced by CI.',
    'Without it the system drifts from the project within weeks.', `${D} §10; ${ADR('journal-not-memory-file')}; ${ADR('self-improvement-loop')}; ${ADR('lessons-learned-store')}`),
  i('journal', 'Journal: one file per entry, schema, add/list', M3, ['type:feature', 'area:knowledge', 'priority:p0', 'size:m'], 'E3', {
    context: 'A single memory file conflicts and gets forgotten.',
    goal: '`.agent-os/journal/YYYY/MM/<timestamp>-<author>-<slug>.md` with front matter (type, refs, areas, author), written by skills and by hand.',
    in: ['`agent-os journal add|list|show` with filters', 'schema validation in doctor', 'journal language from config'],
    out: ['chronicle (separate issue)'],
    ac: ['two branches adding entries never conflict', 'list renders on demand, nothing committed'],
    scenarios: ['Given two PRs merged in any order, then both entries exist and list sorts them by timestamp'],
  }, ['config']),
  i('decisions', 'Decision records with date-based ids', M3, ['type:feature', 'area:knowledge', 'priority:p1', 'size:s'], 'E3', {
    context: 'Sequential ADR numbers collide across branches.',
    goal: '`agent-os decision new <slug>` creates `docs/decisions/<date>-<slug>.md` from a template; supersession is a new record.',
    in: ['template in both languages', 'doctor checks status and links'],
    out: [],
    ac: ['two decisions on the same day with different slugs never collide'],
    scenarios: ['Given a superseded record, then doctor requires the link to its successor'],
  }, ['journal']),
  i('lessons', 'Lessons learned store with automatic recall (`agent-os lessons`, `/lessons`)', M3, ['type:feature', 'area:lessons', 'priority:p0', 'size:l'], 'E3', {
    context: `${ADR('lessons-learned-store')}. Lessons must come back at the moment of work, not sit in a file.`,
    goal: 'inbox/active/retired lesson files; capture automatic and on demand; recall by areas, paths and keywords within a token budget in /start and /pr; promote and retire.',
    in: ['card schema (areas, paths, keywords, source, confidence, recalled, followed, promotedTo)', '`agent-os lessons add|recall|search|review|promote|retire`', '`/lessons` skill', 'Learn step contract for every core skill'],
    out: ['triage at release (/retro)'],
    ac: ['recall returns at most N cards within the budget, ranked by match', 'counters are updated only by /retro (single writer)'],
    scenarios: ['Given a card with paths `src/db/**`, when /start runs on an issue touching src/db, then the card is recalled and named'],
  }, ['journal']),
  i('chronicle', 'Chronicle: one timeline from git, GitHub and the journal', M3, ['type:feature', 'area:knowledge', 'priority:p1', 'size:m'], 'E3', {
    context: 'The team wants an impeccable chronological record tying issues, comments, PRs, branches, milestones and releases together.',
    goal: '`agent-os chronicle --since <date> [--area x] [--issue N]` renders a timeline into the cache.',
    in: ['GitHub events: issues opened/closed, comments, PRs, reviews, merges, milestone changes, releases', 'journal entries interleaved', 'Markdown and JSON output'],
    out: ['committing the render'],
    ac: ['each line links its source'],
    scenarios: ['Given a decision made in an issue comment, then the chronicle shows the comment and the PR that implemented it'],
  }, ['journal', 'tracker']),
  i('map', 'On-demand map instead of a committed file index (`agent-os map`)', M3, ['type:feature', 'area:knowledge', 'priority:p1', 'size:m'], 'E3', {
    context: `Research: docs/research/file-index.md. ${ADR('no-committed-file-index')}.`,
    goal: '`agent-os map [path] [--budget N]` renders headers, sizes, covering tests and recent changes for one area, cached per commit; doctor checks headers on new files and the AGENTS.md area map coverage.',
    in: ['header extraction for common comment styles', 'test association by convention', 'token budget trimming'],
    out: ['ranked symbol maps (later, evals decide)'],
    ac: ['nothing generated is committed', 'a 10k-file repo maps one folder in under a second when cached'],
    scenarios: ['Given a new file without a header, then doctor warns on that file only'],
  }, ['cli']),
  i('doctor', 'doctor: agent system and GitHub hygiene, readiness score', M3, ['type:feature', 'area:loop', 'priority:p0', 'size:l'], 'E3', {
    context: 'The reference system-check proved its value; it must become generic and run in CI.',
    goal: 'Checks registry vs skills, AGENTS.md pointers, links, commands, hooks, front matter, context budgets, ASCII ro areas, journal and lessons schemas, milestones and labels on issues, PR titles, relationships; `--fix` for mechanical repairs; a readiness score.',
    in: ['`--offline`, `--ci`, `--json`', 'proposals for what cannot be fixed mechanically', 'forward-only cutoff respected'],
    out: [],
    ac: ['0 FAIL on a fresh init', 'each finding names the fix'],
    scenarios: ['Given a skill folder without a registry entry, then doctor fails naming it'],
  }, ['journal', 'i18n']),
  i('loop-ci', 'The required loop check in CI (`agent-os/loop`)', M3, ['type:feature', 'area:loop', 'area:ci', 'priority:p0', 'size:m'], 'E3', {
    context: `${ADR('self-improvement-loop')}: no exceptions, so it cannot depend on local hooks.`,
    goal: 'A generated workflow runs doctor --ci on every PR and fails without a journal entry or a non-empty Lessons section.',
    in: ['workflow template following /gh-actions practices', 'bot dependency PRs handled by the release entry', 'made required by github setup'],
    out: [],
    ac: ['a PR with an empty Lessons section cannot merge'],
    scenarios: ['Given Lessons "None: typo fix", then the check passes', 'Given Lessons left as the template comment, then it fails'],
  }, ['doctor']),
  i('retro', '/retro and the scheduled Retro issue', M3, ['type:feature', 'area:loop', 'area:lessons', 'priority:p1', 'size:m'], 'E3', {
    context: 'Captured lessons must be triaged regularly, not only when someone remembers.',
    goal: '/retro groups inbox lessons and repeated review findings by theme, proposes rule lines with reasons or active cards, updates recall counters, promotes and retires; a weekly workflow opens or updates a Retro issue when the inbox is not empty.',
    in: ['repeated review findings across recent PRs', 'run at every /release'],
    out: [],
    ac: ['every inbox entry ends as rule, card, or rejected with reason'],
    scenarios: ['Given the same review finding on three PRs, then /retro proposes a rule'],
  }, ['lessons']),
  i('session-context', 'SessionStart context: assignments, recalled lessons, pending loop items', M3, ['type:feature', 'area:hooks', 'area:loop', 'priority:p1', 'size:s'], 'E3', {
    context: 'Each session should start oriented, within a strict token budget.',
    goal: 'The SessionStart handler injects: branch and issue, your assignments and review requests, lessons for the current branch, pending inbox count, env warnings, skills index pointer, all under the configured budget.',
    in: ['budget enforcement', 'offline fallback'],
    out: [],
    ac: ['never exceeds the budget', 'never blocks the session'],
    scenarios: ['Given no network, then it injects local information only'],
  }, ['hooks', 'lessons']),

  // ── v0.4 ──────────────────────────────────────────────────────────────
  e('E4', 'Collaboration: five or more people, their own laptops', M4,
    'Make the whole flow safe and visible when many people and many agent sessions work in parallel.',
    'Shared local resources and shared files do not exist across laptops; GitHub does.', `${D} §5; ${ADR('github-as-coordination-layer')}`),
  i('collab-rules', 'Collaboration rules template: claim protocol, comments, personal vs team state', M4, ['type:docs', 'area:collab', 'priority:p0', 'size:s'], 'E4', {
    context: 'The reference rules assumed one person and one machine.',
    goal: 'A core rule file describing claiming, asking before taking others\' issues, comment conventions, what is personal and never committed, and that CI is the guarantee.',
    in: ['both languages'],
    out: [],
    ac: ['doctor finds no personal paths tracked by git'],
    scenarios: ['Given .agent-os/local.json committed by mistake, then doctor fails'],
  }),
  i('overlap', 'Overlap detection: `agent-os overlap`', M4, ['type:feature', 'area:collab', 'priority:p1', 'size:m'], 'E4', {
    context: 'Two people editing the same files find out at merge time.',
    goal: 'List open PRs and pushed branches whose changes intersect your branch\'s files, with authors and issues; used by /start and /pr.',
    in: ['GitHub PR files API and remote branch diffs', 'cache with TTL'],
    out: [],
    ac: ['runs under 3 s on a repo with 30 open PRs (cached)'],
    scenarios: ['Given another open PR touching src/a.ts, when I change src/a.ts, then /pr warns and names it'],
  }, ['tracker']),
  i('comments', 'Comment-driven work: read threads, decisions to journal, reply language', M4, ['type:feature', 'area:collab', 'area:github', 'priority:p2', 'size:m'], 'E4', {
    context: 'People talk in issue and PR comments; agents must read and respect that conversation.',
    goal: 'Skills read the thread before acting, quote decisions verbatim into the journal entry, reply in the comment\'s language, and use @mentions only for real people.',
    in: ['`agent-os thread <N>` summary with decisions highlighted'],
    out: [],
    ac: ['a decision in a comment appears in the implementing PR\'s journal entry'],
    scenarios: ['Given a ro review comment, then the reply is ro (ASCII)'],
  }, ['journal']),
  i('orchestrator', 'Optional per-laptop orchestrator: role, guard, local ledger, typed messages', M4, ['type:feature', 'area:collab', 'priority:p2', 'size:l'], 'E4', {
    context: 'One person may run several sessions; the reference orchestrator worked but its ledger was a shared Markdown file.',
    goal: '/orchestrate with claim/release, a guard that stops the orchestrator from editing, a local JSON ledger, the brief template and message types (BRIEF/ACK/QUESTION/UPDATE/DONE/REVISE/CLOSE).',
    in: ['ledger in .agent-os/local', 'reconciliation with worktrees and PRs'],
    out: ['coordinating other people'],
    ac: ['works with zero or more worker sessions'],
    scenarios: ['Given the orchestrator tries to Edit, then the guard refuses'],
  }, ['hooks', 'start']),
  i('handoff', '/handoff: end-of-session or end-of-day handoff', M4, ['type:feature', 'area:collab', 'priority:p2', 'size:s'], 'E4', {
    context: 'Work moves between people and days; state lived in a hand-written file.',
    goal: 'A handoff journal entry plus a status comment on each open issue you hold, in the issues language.',
    in: ['open PRs, branches, blockers, next steps'],
    out: [],
    ac: ['the next person can continue from the comments alone'],
    scenarios: ['Given two open issues, then each gets one status comment'],
  }, ['journal']),

  // ── v0.5 ──────────────────────────────────────────────────────────────
  e('E5', 'Skill registry: core, external and local skills kept apart', M5,
    'A registry and capability slots so projects add, remove and update external and local skills without touching core.',
    'Third-party skills (design, review) evolve independently and must be swappable.', `${D} §6; ${ADR('skill-registry-and-slots')}`),
  i('registry', 'Registry format: one JSON per skill', M5, ['type:feature', 'area:registry', 'priority:p0', 'size:m'], 'E5', {
    context: 'Nothing recorded where a skill came from.',
    goal: '`.agent-os/registry/<name>.json` with origin, source, version, license, provides, managed; doctor consistency check.',
    in: ['schema', 'registration of builtin and plugin skills without files'],
    out: [],
    ac: ['doctor fails on any mismatch between folders and entries'],
    scenarios: ['Given two branches each adding a skill, then they merge without conflict'],
  }, ['config']),
  i('skill-cmd', '`agent-os skill add|remove|update|list|new`', M5, ['type:feature', 'area:registry', 'priority:p1', 'size:l'], 'E5', {
    context: 'Adding a third-party skill was a manual copy.',
    goal: 'Vendor from a git URL at a pinned commit (license recorded), update to a newer commit with a diff preview, remove cleanly, scaffold local skills.',
    in: ['sources: github:owner/repo[/path]@ref, local path', 'never edits vendored files'],
    out: ['a public skill marketplace'],
    ac: ['remove leaves no folder, entry or slot binding behind'],
    scenarios: ['Given an external skill updated upstream, when update runs, then it shows the diff before writing'],
  }, ['registry', 'lock']),
  i('slots', 'Capability slots: core skills call review, ui-design, testing, ci, security-review, docs', M5, ['type:feature', 'area:registry', 'priority:p1', 'size:m'], 'E5', {
    context: 'Core skills named external skills directly.',
    goal: 'Slots bound in agent-os.json; core templates reference slots; doctor checks every used slot is bound or explicitly empty.',
    in: ['default bindings to Claude Code built-ins where they exist'],
    out: [],
    ac: ['swapping a design skill is a one-line config change'],
    scenarios: ['Given ui-design unbound, when /pr touches UI, then it warns and continues'],
  }, ['registry']),
  i('skill-index', 'Separate skill indexes: core, external, local', M5, ['type:feature', 'area:registry', 'priority:p1', 'size:s'], 'E5', {
    context: 'Indexes kept in AGENTS.md by hand fell behind and conflicted.',
    goal: '`agent-os skills` and the SessionStart pointer render three tables from the registry; nothing committed.',
    in: ['short descriptions from front matter'],
    out: [],
    ac: ['adding a skill needs no edit to AGENTS.md'],
    scenarios: ['Given a new local skill, then it appears under Local immediately'],
  }, ['registry', 'session-context']),

  // ── v0.6 ──────────────────────────────────────────────────────────────
  e('E6', 'Testing and CI built into the flow', M6,
    'Testing that is planned at ticket time, executed by diff at PR time and enforced in CI, plus a skill for writing good GitHub Actions.',
    'Local-only gates were the largest risk of the reference workflow.', `${D} §12`),
  i('gate', 'One gate definition: `agent-os gate` locally and in CI', M6, ['type:feature', 'area:testing', 'area:ci', 'priority:p0', 'size:m'], 'E6', {
    context: 'The same checks must run on every laptop and in CI.',
    goal: 'Suites mapped to path globs in agent-os.json; `gate` runs exactly what the diff needs and prints a results table.',
    in: ['--base, --all, --json', 'generated agent-os-gate.yml'],
    out: [],
    ac: ['local and CI runs select the same suites for the same diff'],
    scenarios: ['Given a change in db/ only, then only the db suite runs'],
  }, ['config']),
  i('test-skill', '/test: plan, pr, local, gaps — wired into /ticket, /pr and /ship', M6, ['type:feature', 'area:testing', 'area:skills', 'priority:p0', 'size:l'], 'E6', {
    context: 'Tests were decided late and scenarios lived nowhere.',
    goal: 'plan writes Given/When/Then scenarios into the issue; pr maps the diff to suites, runs them and writes the results table into the PR; local runs suites; gaps lists changed logic without tests. Bound to the testing slot.',
    in: ['scenario format shared with issue forms', '/ship checks the scenarios are ticked'],
    out: [],
    ac: ['every issue created by /ticket has scenarios', 'every PR from /pr has a results table'],
    scenarios: ['Given a bug issue, then plan adds a regression scenario that must fail before the fix'],
  }, ['gate', 'ticket']),
  i('gh-actions', '/ci: write and review CI by best practice (GitHub Actions, GitLab CI)', M6, ['type:feature', 'area:ci', 'area:skills', 'priority:p1', 'size:m'], 'E6', {
    context: 'Workflows are security-sensitive and easy to get wrong.',
    goal: 'A skill with a checklist and a reviewer: least-privilege permissions, SHA-pinned actions, concurrency, timeouts, caching, no untrusted expressions in run, pull_request_target rules, OIDC, reusable workflows, actionlint.',
    in: ['review mode for existing workflows', 'templates for gate, loop, retro, labels'],
    out: [],
    ac: ['every generated workflow passes its own review'],
    scenarios: ['Given `${{ github.event.issue.title }}` inside run, then the review flags injection'],
  }),
  i('test-gaps', 'Test gaps check: changed logic without a test', M6, ['type:feature', 'area:testing', 'priority:p2', 'size:s'], 'E6', {
    context: 'The reference test-gaps hook worked but was stack-specific.',
    goal: 'Configurable mapping from source globs to test globs; Stop hook warning and gate input.',
    in: [],
    out: [],
    ac: ['no false warnings for files the config excludes'],
    scenarios: ['Given src/a.ts changed and no a.test.ts, then it is listed'],
  }, ['gate']),

  // ── v0.7 ──────────────────────────────────────────────────────────────
  e('E7', 'Init and adoption for every repository state', M7,
    'Detect whether a repository is empty, spec-only, in active development or in maintenance, and install what fits, with retrofit or forward-only adoption for existing ones.',
    'The package must be useful on the first day in any repository.', `${D} §11; ${ADR('init-profiles-and-retrofit')}`),
  i('detect', 'Repository state detection and profile suggestion', M7, ['type:feature', 'area:init', 'priority:p0', 'size:m'], 'E7', {
    context: 'One install path does not fit four kinds of repositories.',
    goal: 'Signals (commits, code, docs/specs, open PRs, tags, last commit date, CI, existing agent files) → profile with confidence and reasons.',
    in: ['works offline with git only, richer with gh'],
    out: [],
    ac: ['explains the suggestion in one line'],
    scenarios: ['Given an empty repo, then greenfield', 'Given tags and no commits for 6 months, then maintenance'],
  }, ['cli']),
  i('init', 'Init interview and install plan', M7, ['type:feature', 'area:init', 'priority:p0', 'size:l'], 'E7', {
    context: 'Init must ask little and show everything before writing.',
    goal: 'Confirm profile; ask languages per area, tracker, packs, integration branch, solo/team; show the file plan and GitHub plan; write; run env and doctor.',
    in: ['non-interactive mode with flags', 'existing CLAUDE.md/AGENTS.md merged into managed blocks'],
    out: [],
    ac: ['doctor reports 0 FAIL right after init'],
    scenarios: ['Given --yes and flags, then no prompt appears'],
  }, ['detect', 'lock', 'gh-setup', 'env']),
  i('retrofit', 'Retrofit adoption: plan and apply history into the system', M7, ['type:feature', 'area:init', 'area:github', 'priority:p1', 'size:l'], 'E7', {
    context: 'Some teams want their existing issues, PRs and milestones brought into the conventions.',
    goal: '`retrofit plan` writes a reviewable plan (labels to map/create, milestones from tags, PR↔issue links, normalized open PR titles and bodies, baseline journal); `retrofit apply` executes it idempotently and rate-limited.',
    in: ['closed PRs are never rewritten', 'marker on what was touched'],
    out: [],
    ac: ['apply twice = no changes the second time'],
    scenarios: ['Given 200 closed PRs, then the plan changes none of them and writes a baseline journal'],
  }, ['init', 'tracker', 'journal']),
  i('forward-only', 'Forward-only adoption: cutoff and baseline', M7, ['type:feature', 'area:init', 'priority:p1', 'size:s'], 'E7', {
    context: 'Other teams want conventions from today on, without touching history.',
    goal: 'Record a cutoff date and a baseline snapshot entry; doctor ignores older items.',
    in: [],
    out: [],
    ac: ['doctor passes on a legacy repo right after init'],
    scenarios: ['Given old issues without milestones, then doctor does not report them'],
  }, ['init', 'doctor']),
  i('discover', '/discover: infer conventions and decisions from history', M7, ['type:feature', 'area:init', 'area:knowledge', 'priority:p2', 'size:l'], 'E7', {
    context: 'Active repositories have conventions that rules should reflect, not override.',
    goal: 'Infer commit style, branch naming, merge strategy, areas; draft the AGENTS.md area map; extract decisions from PR discussions into journal entries.',
    in: ['parallel subagents per area', 'proposals reviewed before writing'],
    out: [],
    ac: ['every inferred rule cites its evidence'],
    scenarios: ['Given a repo using `feature/` prefixes, then the proposed rule uses them'],
  }, ['init', 'journal']),
  i('kickoff', '/kickoff (greenfield) and /ingest-docs (spec-first)', M7, ['type:feature', 'area:init', 'priority:p2', 'size:l'], 'E7', {
    context: 'Empty and spec-only repositories need a plan before code.',
    goal: '/kickoff interviews about the product and writes docs, milestones and first issues; /ingest-docs reads existing specifications, reports contradictions and creates epics and sub-issues linked to their sources.',
    in: [],
    out: [],
    ac: ['every created issue cites its source section'],
    scenarios: ['Given two specs that disagree, then /ingest-docs asks before creating issues'],
  }, ['init', 'ticket']),
  i('maintenance', 'Maintenance profile: /runbook and the takeover dossier', M7, ['type:feature', 'area:init', 'priority:p3', 'size:m'], 'E7', {
    context: 'Finished products need safe upkeep and easy takeover.',
    goal: '/runbook writes deploy, rollback and restore procedures from the release flow; a takeover dossier (architecture, dangerous operations, accounts) helps new maintainers. Audits use /audit with the project preset (E13).',
    in: [],
    out: [],
    ac: ['audit is read-only until issues are confirmed'],
    scenarios: ['Given a known vulnerable dependency, then one p0/p1 issue is proposed'],
  }, ['init']),
  i('packs', 'Packs: format and one reference pack', M7, ['type:feature', 'area:init', 'priority:p2', 'size:m'], 'E7', {
    context: 'Stack knowledge must stay out of core.',
    goal: 'A pack format (rules, subagents, gate suites, release verifiers, requires, slot bindings) and `agent-os add <pack>`; one reference pack (for example stack-postgres).',
    in: [],
    out: ['many packs'],
    ac: ['removing a pack removes everything it installed'],
    scenarios: ['Given a pack requiring an MCP server, then env reports it after add'],
  }, ['lock', 'registry']),

  // ── v1.0 ──────────────────────────────────────────────────────────────
  e('E8', 'Release 1.0', M8,
    'Publish agent-os as an npm package and a Claude Code plugin, with documentation, evals and the package used on itself.',
    'A stable public release.', 'README.md'),
  i('plugin', 'Claude Code plugin packaging', M8, ['type:feature', 'area:distribution', 'priority:p1', 'size:m'], 'E8', {
    context: 'Some parts belong at user level, not in each repository.',
    goal: 'A plugin manifest exposing the core skills and hooks, consistent with the npx install.',
    in: [], out: [], ac: ['installing both does not duplicate skills'], scenarios: ['Given plugin and repo install, then doctor reports one source per skill'],
  }, ['registry']),
  i('publish', 'npm publish with provenance and versioning', M8, ['type:chore', 'area:distribution', 'area:ci', 'priority:p1', 'size:s'], 'E8', {
    context: 'Releases must be reproducible and verifiable.',
    goal: 'A release workflow publishing with npm provenance from tags, with release notes from the journal.',
    in: [], out: [], ac: ['package page shows provenance'], scenarios: ['Given a tag, then the workflow publishes exactly that commit'],
  }, ['repo-ci']),
  i('evals', 'Skill evals: fixture repositories and scenarios', M8, ['type:feature', 'area:testing', 'priority:p2', 'size:l'], 'E8', {
    context: 'Skills regress silently; map must prove it reduces steps.',
    goal: 'Fixture repos (empty, spec-only, active, maintenance) and scenarios that check skills stop where they must; step and token comparisons for map and recall.',
    in: [], out: [], ac: ['runs in CI on a schedule'], scenarios: ['Given a PR with a destructive migration fixture, then /release asks'],
  }, ['test-skill']),
  i('docs', 'Documentation: guides per profile and per language', M8, ['type:docs', 'area:distribution', 'priority:p1', 'size:m'], 'E8', {
    context: 'Users start from different repository states.',
    goal: 'Quick starts for the four profiles, configuration reference, language areas, skills catalog, FAQ.',
    in: [], out: [], ac: ['every command documented'], scenarios: ['Given a new user, then the greenfield guide works end to end'],
  }, ['init']),
  i('dogfood', 'Dogfood: install agent-os on this repository', M8, ['type:chore', 'dogfood', 'area:distribution', 'priority:p1', 'size:m'], 'E8', {
    context: 'Until now the conventions here are applied by hand (CONTRIBUTING.md).',
    goal: 'Run init on this repository and remove the hand-written parts the package now provides.',
    in: [], out: [], ac: ['doctor and the loop check pass on this repository'], scenarios: ['Given a new PR here, then the loop check runs'],
  }, ['init', 'loop-ci']),
  i('compat', 'Other agents: AGENTS.md-first compatibility (Codex, Cursor)', M8, ['type:research', 'area:distribution', 'priority:p3', 'size:s'], 'E8', {
    context: 'Teams mix agents.',
    goal: 'Decide and document what works without Claude Code (AGENTS.md, CLI) and what degrades (hooks, skills).',
    in: [], out: [], ac: ['a decision record'], scenarios: [],
  }),
]

// ── Added 2026-11-18: stack map, artifacts, safe updates, upstream ──────────
const M9 = 'v0.8 Stack map and artifacts'
labels.push(
  ['area:stack', '0e8a16', 'Stack map, catalog, stack.yaml'],
  ['area:artifacts', '0e8a16', 'Artifacts and the Pages site'],
  ['area:updates', '0e8a16', 'Versions, manifest, migrations, update'],
  ['upstream', 'fef2c0', 'Filed from a project through /upstream'],
  ['changelog:breaking', 'b60205', 'Release notes: breaking change'],
  ['changelog:new', '0e8a16', 'Release notes: new'],
  ['changelog:deprecation', 'fbca04', 'Release notes: deprecation'],
  ['changelog:legacy', 'c5def5', 'Release notes: moved to legacy'],
  ['changelog:removed', 'd73a4a', 'Release notes: removed'],
)
milestones.push([M9, 'Catalog overlays, stack.yaml and /stack (show, set, detect, drift, import), stack-driven labels and env proposals; /artifact, artifact build and verify, the Pages site and templates.'])

issues.push(
  i('yaml', 'Zero-dependency YAML subset parser', M1, ['type:feature', 'area:cli', 'priority:p0', 'size:m'], 'E1', {
    context: 'stack.yaml, the catalog and artifact.yaml are YAML for readability; the package has no runtime dependencies.',
    goal: 'A strict, documented YAML subset (maps, lists, inline {} and [], quoted and plain scalars, comments) with precise errors, and a matching emitter.',
    in: ['parser + emitter with round-trip tests on the catalog and examples', 'rejects anchors, tags, multi-docs and tabs with a clear message'],
    out: ['full YAML 1.2'],
    ac: ['parses every file in catalog/, examples/ and artifacts/', 'errors name file, line and column'],
    scenarios: ['Given a tab-indented file, then the error says tabs are not allowed and where'],
  }, ['cli']),

  e('E11', 'Versions and safe updates', M2,
    'Every teammate runs the same pinned version, every shipped item carries a lifecycle marker, and upgrades are reviewable PRs with migrations.',
    'Five people on five laptops cannot drift, and a new release must never break a working project.', `${D} §19; ${ADR('versions-and-safe-updates')}`),
  i('version-pin', 'Pinned version per project and mismatch warnings', M2, ['type:feature', 'area:updates', 'priority:p0', 'size:s'], 'E11', {
    context: 'npx caches differ between laptops.',
    goal: 'agent-os.json records an exact version; hooks and skills run it (devDependency or npx with the exact version); doctor and SessionStart warn on mismatch.',
    in: [], out: [], ac: ['no hook runs an unpinned version'], scenarios: ['Given a teammate on 0.4.1 and a pin of 0.4.2, then SessionStart warns once with the fix'],
  }, ['config', 'hooks']),
  i('manifest', 'Lifecycle manifest: new, stable, deprecated, legacy, removed', M2, ['type:feature', 'area:updates', 'priority:p0', 'size:m'], 'E11', {
    context: 'Users need warning long before anything disappears.',
    goal: 'manifest.json generated at release lists every file, skill, rule, command, config key, catalog entry and hook with its state; release CI rejects a removal without migration or a deprecation without replacement and removeIn.',
    in: ['doctor warns on deprecated items in use, with the replacement'], out: [],
    ac: ['nothing goes from stable to removed directly'], scenarios: ['Given a deprecated flag used in a hook, then doctor names the replacement and the removal version'],
  }, ['lock']),
  i('migrations', 'Versioned, idempotent migrations with fixture tests', M2, ['type:feature', 'area:updates', 'priority:p0', 'size:m'], 'E11', {
    context: 'Config, registry, journal, lessons and stack.yaml schemas will evolve.',
    goal: 'migrations/<version>.mjs run in order on update, each idempotent and tested against fixture projects.',
    in: [], out: [], ac: ['running a migration twice changes nothing'], scenarios: ['Given a project two minors behind, then both migrations run in order'],
  }, ['config']),
  i('update-flow', '`agent-os update --plan` and update as a PR', M2, ['type:feature', 'area:updates', 'priority:p0', 'size:l'], 'E11', {
    context: `${D} §19.`,
    goal: 'plan grouped as Breaking, New, Deprecated, Legacy, Removed, Fixes, Chore; preflight (clean tree, doctor, Node and Claude Code minimums); branch chore/agent-os-<version>; migrations; three-way merge; doctor, env and gate; PR with the plan, the migration log, conflicts and results; journal entry.',
    in: ['--channel next for pre-releases without changing the pin'], out: [],
    ac: ['rollback = closing the PR', 'update never touches the default branch directly'], scenarios: ['Given a local edit conflicting with the new version, then the PR lists the .rej file'],
  }, ['lock', 'manifest', 'migrations', 'version-pin']),
  i('legacy', 'Legacy opt-in and deprecation reporting', M2, ['type:feature', 'area:updates', 'priority:p1', 'size:s'], 'E11', {
    context: 'Some teams need an old behaviour for a while.',
    goal: '`legacy: [...]` in config re-enables items in the legacy state; doctor lists them as debt; skills show a deprecation note when a deprecated path runs.',
    in: [], out: [], ac: ['legacy items are absent unless enabled'], scenarios: ['Given legacy: ["old-flow"], then the old skill is installed and doctor reports it as debt'],
  }, ['manifest']),
  i('changelog', 'Grouped release notes from labels and the journal', M2, ['type:feature', 'area:updates', 'area:ci', 'priority:p1', 'size:s'], 'E11', {
    context: 'Users read release notes to decide when to upgrade.',
    goal: 'Release notes grouped by changelog:* labels and journal entries, with migration notes for breaking items.',
    in: [], out: [], ac: ['every breaking item links its migration'], scenarios: ['Given a PR labelled changelog:deprecation, then it appears under Deprecated with its replacement'],
  }, ['manifest']),

  i('upstream', '/upstream: propose improvements to agent-os from any project, privacy-filtered', M3, ['type:feature', 'area:loop', 'area:github', 'priority:p1', 'size:m'], 'E3', {
    context: `${D} §18; ${ADR('upstream-feedback')}. Projects find the package's gaps first.`,
    goal: 'Draft an issue for cosmin-sisman/agent-os from a user statement, a generic lesson, a doctor finding or a skill failure, using a whitelist of fields; search duplicates upstream; show the exact text; file it; record the URL in the journal and lesson card.',
    in: ['Improvement issue form upstream', 'upstream.enabled: false writes drafts to a file', 'update reports which upstream issues a new version closes'],
    out: [], ac: ['no project name, path, code, remote, person or secret ever leaves the project', 'the user approves the exact text'],
    scenarios: ['Given a lesson mentioning a private path, then the draft does not contain it', 'Given an existing upstream issue, then it proposes a reaction or comment instead'],
  }, ['lessons', 'tracker']),

  e('E9', 'Stack map: layers as the backbone', M9,
    'A shipped, bilingual catalog and one stack.yaml per project that drive labels, paths, the gate, the environment check, lessons and decisions.',
    'The stack is the most important project-specific knowledge and it was not structured anywhere.', `${D} §16; ${ADR('stack-map')}`),
  i('catalog', 'Catalog loading, project overlays and catalog CI', M9, ['type:feature', 'area:stack', 'priority:p0', 'size:m'], 'E9', {
    context: 'catalog/*.yaml exists (24 layers, 126 technologies, 20 languages, 39 providers, 10 runtimes, 10 blueprints).',
    goal: 'Load the catalog, merge project overlays from .agent-os/catalog/, and validate in CI: unique ids, valid references, both languages present, ASCII-only ro.',
    in: ['a contributing guide for catalog entries'], out: [], ac: ['a broken reference fails CI with the file and id'],
    scenarios: ['Given an overlay adding a technology, then stack show can use it'],
  }, ['yaml']),
  i('stack-file', 'stack.yaml schema, validation and `agent-os stack show`', M9, ['type:feature', 'area:stack', 'priority:p0', 'size:m'], 'E9', {
    context: 'examples/stack.yaml shows the format.',
    goal: 'Validate stack.yaml against the catalog; `stack show` renders the table and the summary (distinct languages and providers, average complexity, AI-friendliness and cost, steepest learning curve, EU check); `stack new --from <blueprint>`.',
    in: [], out: [], ac: ['unknown ids are reported with the closest match'], scenarios: ['Given compliance.euOnly and a provider marked verify, then show flags it'],
  }, ['catalog']),
  i('stack-areas', 'Stack-driven areas: labels, paths, area map, overlap and /next', M9, ['type:feature', 'area:stack', 'area:github', 'priority:p1', 'size:m'], 'E9', {
    context: 'area:* labels and the AGENTS.md area map were hand-made.',
    goal: 'Generate area:* labels (in the labels language) from layers in use; map paths to layers for overlap, /next familiarity, gate selection, lessons recall and the area map check.',
    in: ['optional CODEOWNERS block from layer owners'], out: [], ac: ['adding a layer adds its label through github setup'],
    scenarios: ['Given a file under a layer path, then /pr labels the PR with that area'],
  }, ['stack-file', 'gh-setup']),
  i('stack-set', '`stack set` and `stack status`: changes as decisions', M9, ['type:feature', 'area:stack', 'area:knowledge', 'priority:p1', 'size:s'], 'E9', {
    context: 'Changing a technology is an architecture decision.',
    goal: 'Changing a layer writes a decision record with the catalog comparison and proposes follow-up issues.',
    in: [], out: [], ac: ['the decision cites the old and new scores'], scenarios: ['Given set data-layer prisma-neon-postgres, then a decision record and a migration issue are proposed'],
  }, ['stack-file', 'decisions']),
  i('stack-detect', '`stack detect` and `stack drift`', M9, ['type:feature', 'area:stack', 'area:init', 'priority:p1', 'size:l'], 'E9', {
    context: 'Existing repositories already have a stack; the file must not lie about the code.',
    goal: 'Infer layers and paths from manifests and configs; report drift between stack.yaml and the code in doctor.',
    in: ['package.json, lockfiles, Dockerfiles, wrangler.toml, vercel.json, framework configs, migrations, workflows'], out: [],
    ac: ['each detection cites its evidence file'], scenarios: ['Given stack.yaml says drizzle and code imports prisma, then drift reports it'],
  }, ['stack-file']),
  i('stack-import', '`stack import` from a stack builder spreadsheet (xlsx, csv)', M9, ['type:feature', 'area:stack', 'priority:p2', 'size:m'], 'E9', {
    context: 'Teams plan stacks in spreadsheets; scripts/bootstrap shows the format.',
    goal: 'Read layer, technology, provider, status and notes from xlsx (zip + XML with node:zlib) or csv into stack.yaml, mapping names to catalog ids.',
    in: [], out: [], ac: ['unknown technologies become overlay suggestions'], scenarios: ['Given a builder sheet with 15 layers, then stack.yaml has 15 layers with statuses'],
  }, ['stack-file']),
  i('stack-env', 'Stack-driven requirements for /env', M9, ['type:feature', 'area:stack', 'area:env', 'priority:p2', 'size:s'], 'E9', {
    context: 'Providers with an MCP hint and technologies with CLIs imply requirements.',
    goal: 'Propose requires entries (MCP servers, CLIs) from the stack; the user accepts them into agent-os.json.',
    in: [], out: [], ac: ['never adds a requirement silently'], scenarios: ['Given a Sentry monitoring layer, then /env proposes checking for a Sentry MCP server'],
  }, ['stack-file', 'env']),
  i('stack-skill', '/stack skill and blueprint-based /kickoff', M9, ['type:feature', 'area:stack', 'area:skills', 'priority:p1', 'size:m'], 'E9', {
    context: 'The commands need a conversational front end.',
    goal: '/stack explains, compares and changes the stack; /kickoff proposes a blueprint by level and walks through each layer.',
    in: ['low aiFriendly layers add a "read the docs first" rule'], out: [], ac: ['every recommendation cites catalog scores'],
    scenarios: ['Given a level 2 product, then /kickoff proposes booking-app or membership-monolith and explains why'],
  }, ['stack-file', 'kickoff']),

  e('E10', 'Artifacts: versioned, verifiable, indexed', M9,
    'Visual outputs (discovery, analysis, stack map, comparisons, release reports) kept in the repository, published to Pages, verified against their sources and linked from issues and PRs.',
    'Pages kept in a personal workspace cannot be shared, have no history and cannot be checked.', `${D} §17; ${ADR('artifacts-in-repo')}`),
  i('artifact-format', 'artifact.yaml schema and `agent-os artifact new|list|log`', M9, ['type:feature', 'area:artifacts', 'priority:p0', 'size:m'], 'E10', {
    context: 'artifacts/2026-11-18-stack-map/ is the first example.',
    goal: 'Schema (id, title, type, kind, status, summary, languages, authors, refs, build, sources with sha256), scaffolding by type, listing and git history.',
    in: [], out: [], ac: ['id equals the folder name and starts with a date'], scenarios: ['Given new analysis "auth-options", then artifacts/<date>-auth-options/ is created'],
  }, ['yaml']),
  i('artifact-build', '`agent-os artifact build|verify`: hashes and staleness', M9, ['type:feature', 'area:artifacts', 'priority:p1', 'size:m'], 'E10', {
    context: 'scripts/bootstrap/build_artifact.py is the prototype.',
    goal: 'Build artifacts from templates and data, record source hashes, and mark artifacts stale when a source changes; living artifacts rebuild in CI.',
    in: [], out: [], ac: ['verify exits 1 on a stale snapshot only when --strict'], scenarios: ['Given a catalog change, then the stack map shows as stale until rebuilt'],
  }, ['artifact-format']),
  i('artifact-pages', 'Pages site as an installable workflow', M9, ['type:feature', 'area:artifacts', 'area:ci', 'priority:p1', 'size:s'], 'E10', {
    context: 'This repository already publishes artifacts with scripts/site/build.mjs and .github/workflows/pages.yml.',
    goal: 'Ship the site builder in the package and install the workflow; index by type, date, area and issue; private repositories documented.',
    in: [], out: [], ac: ['the index is never committed'], scenarios: ['Given two artifacts, then the index lists both with verification status'],
  }, ['artifact-format', 'gh-actions']),
  i('artifact-skill', '/artifact skill: create, link to issues and PRs, mirror', M9, ['type:feature', 'area:artifacts', 'area:skills', 'priority:p1', 'size:m'], 'E10', {
    context: 'Artifacts must be easy to make and to mention.',
    goal: '/artifact new <type>, build, verify, link <id> <#N> (comment with link and summary in the thread language), publish (optional mirror to an external host); PR template gets an Artifacts section.',
    in: [], out: [], ac: ['links always point to the repository copy first'], scenarios: ['Given link on a ro issue, then the comment is in ASCII ro'],
  }, ['artifact-format', 'comments']),
  i('artifact-templates', 'Artifact templates: discovery, analysis, comparison, release report, retro', M9, ['type:feature', 'area:artifacts', 'priority:p2', 'size:l'], 'E10', {
    context: 'Good defaults make artifacts consistent.',
    goal: 'Self-contained, theme-aware, bilingual templates per type, fed by JSON data.',
    in: [], out: [], ac: ['every template passes the doctor artifact checks'], scenarios: ['Given a release, then a release-report artifact can be built from the journal'],
  }, ['artifact-build']),
  i('artifact-doctor', 'Doctor checks for artifacts', M9, ['type:feature', 'area:artifacts', 'area:loop', 'priority:p2', 'size:s'], 'E10', {
    context: 'Artifacts must stay trustworthy.',
    goal: 'Check metadata, refs, size budget, that pages load nothing external, and staleness.',
    in: [], out: [], ac: ['an external script tag fails the check'], scenarios: ['Given a page loading a CDN script, then doctor fails naming the URL'],
  }, ['artifact-format', 'doctor']),
)

// ── Added 2026-11-18: GitHub and GitLab as first-class platforms ─────────────
labels.push(
  ['area:platform', '0e8a16', 'Platform adapters, capability probing, self-managed'],
  ['platform:github', '24292f', 'Specific to GitHub'],
  ['platform:gitlab', 'fc6d26', 'Specific to GitLab'],
)
issues.push(
  e('E12', 'Platforms: GitHub and GitLab, cloud or self-managed', M2,
    'Choose GitHub or GitLab at init (including GitHub Enterprise Server and GitLab self-managed or Dedicated); every command, template and skill follows that platform, driven by probed capabilities with fallbacks.',
    'Many teams run GitLab, often on-premise. A GitHub-only package excludes them.', `${D} §20; ${ADR('platforms-github-and-gitlab')}`),
  i('platform-config', 'Platform selection, remote detection and auth through gh or glab', M2, ['type:feature', 'area:platform', 'priority:p0', 'size:m'], 'E12', {
    context: 'Every command needs to know which platform and host it talks to.',
    goal: '`platform.type`, `host`, `project`, `caFile` in agent-os.json; init detects from the git remote (github.com, gitlab.com, or probes an unknown host) and confirms; auth is delegated to `gh auth` / `glab auth login --hostname`.',
    in: ['no token is ever stored by agent-os'], out: [], ac: ['an unknown host is identified or reported, never guessed'],
    scenarios: ['Given a remote on git.company.internal, then init probes /api/v4/version and proposes GitLab self-managed'],
  }, ['config']),
  i('capability-probe', 'Capability probing and documented fallbacks (`agent-os platform probe`)', M2, ['type:feature', 'area:platform', 'priority:p0', 'size:m'], 'E12', {
    context: 'GitLab features depend on tier and version; GitHub Enterprise Server lags github.com.',
    goal: 'Probe sub-items, dependencies, exclusive labels, multiple assignees, boards, pages, rulesets/push rules, MCP; cache the capability map; every capability has a fallback skills use automatically.',
    in: ['refresh in doctor and in CI'], out: [], ac: ['skills never branch on the platform name, only on capabilities'],
    scenarios: ['Given GitLab Free without blocking links, then /ticket uses relates-to + blocked label + Blocked by line'],
  }, ['platform-config']),
  i('gitlab-adapter', 'GitLab tracker adapter: issues, epics, child tasks, links, scoped labels, merge requests', M2, ['type:feature', 'area:platform', 'platform:gitlab', 'priority:p0', 'size:l'], 'E12', {
    context: 'The tracker interface has a GitHub implementation first.',
    goal: 'Implement the same interface on GitLab REST v4 + GraphQL via glab: issues, epics and child tasks, blocks / is blocked by links, scoped labels, milestones, iterations, assignees, merge requests (!N) and their closing patterns.',
    in: ['pagination and rate limits', 'reference syntax #N, !N, &N'], out: [], ac: ['the same skill scenarios pass on both adapters'],
    scenarios: ['Given /ticket with a parent epic, then the issue is attached to the epic on Premium and gets a Parent line on Free'],
  }, ['tracker', 'capability-probe']),
  i('gitlab-setup', 'Platform setup on GitLab: default branch, protected branches, push rules, scoped labels, templates', M2, ['type:feature', 'area:platform', 'platform:gitlab', 'priority:p0', 'size:m'], 'E12', {
    context: 'The GitHub setup has no GitLab counterpart yet.',
    goal: 'Create the integration branch and make it default, protect both branches, push rules and approval rules when available, scoped labels from the dictionaries, milestones, `.gitlab/issue_templates` and `.gitlab/merge_request_templates` in the configured languages.',
    in: ['dry-run plan', 'idempotent'], out: [], ac: ['a second run changes nothing'],
    scenarios: ['Given labels in ro, then scoped labels like tip::bug are created'],
  }, ['gitlab-adapter', 'templates']),
  i('platform-routes', 'Platform routes for templates and the lock; platform vocabulary', M2, ['type:feature', 'area:platform', 'area:cli', 'priority:p0', 'size:m'], 'E12', {
    context: 'A GitLab project must never receive a .github folder, and the other way round.',
    goal: 'templates/platform/{github,gitlab}; the lock records the platform; skills render the platform vocabulary (/mr and !N on GitLab, /pr and #N on GitHub) with aliases in the registry.',
    in: [], out: [], ac: ['update writes only the active route'], scenarios: ['Given platform gitlab, then /pr is an alias of /mr'],
  }, ['lock', 'templates']),
  i('self-managed', 'Self-managed and on-premise: private CA, proxies, air-gapped install, version gates, runner tags', M2, ['type:feature', 'area:platform', 'platform:gitlab', 'priority:p1', 'size:l'], 'E12', {
    context: 'Company GitLab instances run behind private CAs and proxies, sometimes without internet access.',
    goal: 'caFile passed to Node and glab; proxy support; install from an npm tarball or internal registry; features gated by the probed version; runner tags and internal images for generated CI; /upstream off by default.',
    in: ['GitHub Enterprise Server equivalents where they apply'], out: [], ac: ['works with no internet access after install'],
    scenarios: ['Given an air-gapped runner, then the gate job runs from the internal registry image'],
  }, ['capability-probe']),
  i('gitlab-ci', 'agent-os CI/CD components for GitLab: gate, loop check, retro, labels, pages', M6, ['type:feature', 'area:ci', 'platform:gitlab', 'priority:p1', 'size:m'], 'E12', {
    context: 'Generated CI exists as GitHub workflows only.',
    goal: 'Versioned CI/CD components included from .gitlab-ci.yml, following /ci best practices (rules, interruptible, timeouts, protected variables, id_tokens, pinned images, needs).',
    in: ['GitLab Pages job for artifacts with a CI-artifacts fallback'], out: [], ac: ['glab ci lint passes on every generated file'],
    scenarios: ['Given an MR with an empty Lessons section, then the loop job fails'],
  }, ['gate', 'loop-ci']),
  i('gitlab-matrix', 'Test matrix against gitlab.com and a self-managed GitLab', M6, ['type:chore', 'area:testing', 'platform:gitlab', 'priority:p1', 'size:m'], 'E12', {
    context: 'Two adapters need the same guarantees.',
    goal: 'Contract tests for the tracker interface run against GitHub, gitlab.com and a GitLab CE container in scheduled CI.',
    in: [], out: [], ac: ['a contract test failing on one platform blocks the release'],
    scenarios: ['Given a change to the adapter interface, then both implementations are tested'],
  }, ['gitlab-adapter', 'repo-ci']),
  i('platform-switch', '`agent-os platform switch`: move a project between GitHub and GitLab', M8, ['type:feature', 'area:platform', 'priority:p3', 'size:m'], 'E12', {
    context: 'Teams migrate between platforms.',
    goal: 'Re-render every platform route on a branch, like update; re-link journal refs after the platform importer moved issues.',
    in: [], out: ['moving issues (the platforms\' importers do that)'], ac: ['no file from the old route remains'],
    scenarios: ['Given a GitHub project switched to GitLab, then .github/ is removed and .gitlab-ci.yml is added in one MR'],
  }, ['platform-routes']),
)
const EPIC_AREAS = { E1: 'area:cli', E2: 'area:skills', E3: 'area:loop', E4: 'area:collab', E5: 'area:registry', E6: 'area:testing', E7: 'area:init', E8: 'area:distribution', E9: 'area:stack', E10: 'area:artifacts', E11: 'area:updates', E12: 'area:platform' }
for (const it of issues) if (it.epic && EPIC_AREAS[it.key]) it.labels = [...it.labels, EPIC_AREAS[it.key]]

// ── Added 2026-11-18: audit, coding standards, security, chat language ──────
const M10 = 'v0.9 Audit and security'
labels.push(
  ['area:audit', '0e8a16', 'The /audit skill and its lenses'],
  ['area:standards', '0e8a16', 'Coding standards'],
  ['area:security', '0e8a16', 'The /security skill: watch, check, prepare'],
  ['security', 'b60205', 'Hardening work that reveals nothing exploitable (vulnerabilities go to private advisories)'],
)
milestones.push([M10, '/audit for ideas, specs, projects, releases, problems and systems through lenses with evidence; /security: relevant advisories, layer checks in every change request, threat models, abuse cases, private reporting.'])
issues.push(
  i('chat-lang', 'Personal chat language at install and `init --me` for new teammates', M1, ['type:feature', 'area:i18n', 'area:init', 'priority:p0', 'size:s', 'good first issue'], 'E1', {
    context: 'The chat language is personal; team areas (issues, PRs, commits, code) are shared.',
    goal: 'init always asks first which language the agent should talk in (en or ro), stores it in .agent-os/local.json; `agent-os init --me` asks only the personal questions for someone joining later.',
    in: [], out: [], ac: ['init --me never modifies committed files'], scenarios: ['Given a team with issues in ro, when a teammate picks chat en, then the agent chats in English and still writes issues in ASCII ro'],
  }, ['config', 'i18n']),

  e('E14', 'Coding standards, always on', M6,
    'English code with headers and useful comments, clarity first, optimization with judgment, and a decision procedure when several solutions fit; active without being asked.',
    'Agents write most of the code; without an ever-present standard it drifts between sessions.', `${D} §22; ${ADR('coding-standards')}`),
  i('standards-rules', 'Core standards rule and stack-scoped language rules', M6, ['type:feature', 'area:standards', 'priority:p0', 'size:m'], 'E14', {
    context: 'The standard must be in every session and specific to the stack.',
    goal: '.claude/rules/standards.md (always loaded) plus per-language rules (TypeScript, Python, SQL, …) selected from stack.yaml and scoped by paths; low aiFriendly layers add read-the-docs-first.',
    in: [], out: [], ac: ['rules stay within the context budget'], scenarios: ['Given a Python layer in stack.yaml, then the Python rule is installed and scoped to its paths'],
  }, ['templates']),
  i('standards-skill', '/standards skill: review, explain, and choose between solutions', M6, ['type:feature', 'area:standards', 'area:skills', 'priority:p0', 'size:m'], 'E14', {
    context: 'Choosing between several valid implementations is where quality is won or lost.',
    goal: 'The decision procedure (candidates, criteria, choice with reason, record when hard to reverse); review of a file or diff; bound to the standards slot used by /pr and /mr before code-review.',
    in: [], out: [], ac: ['only the chosen solution is implemented'], scenarios: ['Given two caching approaches, then the skill names both, picks one and states why in one sentence'],
  }, ['slots']),
  i('standards-checks', 'Deterministic standards checks: on-edit reminder and doctor --ci', M6, ['type:feature', 'area:standards', 'area:hooks', 'priority:p1', 'size:m'], 'E14', {
    context: 'Some parts of the standard are mechanical and can be checked every time.',
    goal: 'PostToolUse handler on edits (header, English comments and identifiers or the allowed area language, TODO with #N, file-size budget), reminding once without blocking; the same checks in doctor --ci.',
    in: [], out: [], ac: ['never blocks an edit locally'], scenarios: ['Given a new TODO without an issue reference, then a reminder names the line'],
  }, ['hooks', 'doctor']),

  e('E13', 'Audit: any subject, several lenses, clean findings', M10,
    'One /audit skill for ideas, specs, projects, releases, problems and systems, run through separate lenses with evidence, producing an artifact, proposed issues, lessons and a journal entry.',
    'Assessments are needed at every stage; ad-hoc ones mix perspectives and are not tracked.', `${D} §21; ${ADR('audit')}`),
  i('audit-core', '/audit: subject detection, lens presets and the findings model', M10, ['type:feature', 'area:audit', 'area:skills', 'priority:p0', 'size:l'], 'E13', {
    context: 'Subjects range from a sentence to a whole system.',
    goal: 'Detect and confirm the subject; choose lenses by preset; run each lens in its own subagent; merge findings with evidence, severity, confidence and one recommendation each; report strengths.',
    in: ['product, architecture, stack, code quality, security and privacy, performance and cost, delivery, process, operations'], out: [],
    ac: ['a finding without evidence becomes a question'], scenarios: ['Given an idea, then the product, architecture, stack and cost lenses run', 'Given a problem in the data layer, then only the related lenses run'],
  }, ['stack-file', 'standards-skill']),
  i('audit-outputs', 'Audit outputs: artifact, proposed issues, lessons, comparison with the previous audit', M10, ['type:feature', 'area:audit', 'area:artifacts', 'priority:p1', 'size:m'], 'E13', {
    context: 'An audit is useful only if it turns into tracked work.',
    goal: 'An audit artifact verified against the audited commit; issues proposed through /ticket (or an epic) on confirmation; lessons and a journal entry; a diff against the previous audit of the same subject.',
    in: [], out: [], ac: ['nothing is filed without confirmation'], scenarios: ['Given a second audit, then fixed, new and worse findings are listed separately'],
  }, ['audit-core', 'artifact-format', 'ticket']),

  e('E15', 'Security: watch, check, prepare', M10,
    'Advisories relevant to this project, a layer-based security pass on every change request, threat models, abuse cases and exercises, and private reporting.',
    'Security must be continuous and specific, not a yearly scan.', `${D} §23; ${ADR('security')}`),
  i('sec-watch', 'Advisory watch: GHSA, GitLab advisories, OSV, NVD, CISA KEV, stack vendors → Security digest', M10, ['type:feature', 'area:security', 'priority:p0', 'size:l'], 'E15', {
    context: 'Only advisories that touch the project matter.',
    goal: 'Match advisories to lockfiles, an SBOM (`agent-os sbom`) and stack.yaml; prioritize by KEV, EPSS, severity and reachability; a scheduled job keeps one Security digest issue current; SessionStart warns on critical items.',
    in: ['internal mirror or visible disable on air-gapped installs'], out: [], ac: ['only package names and versions leave the project'],
    scenarios: ['Given a KEV entry for a direct dependency, then the digest lists it first and /release refuses to ship it'],
  }, ['stack-file', 'loop-ci']),
  i('sec-check', 'Layer-based security pass in /pr and /mr, with scanner results', M10, ['type:feature', 'area:security', 'priority:p0', 'size:l'], 'E15', {
    context: 'Every change request touches some layers; each layer has its own risks.',
    goal: 'OWASP ASVS checklists per layer touched by the diff, plus results from secret scanning, dependency audit, CodeQL / GitLab SAST / Semgrep and container and IaC scanners when present; bound to the security-review slot.',
    in: ['/env reports missing scanners'], out: [], ac: ['each finding has the fix and the reason'],
    scenarios: ['Given a new public endpoint without rate limiting, then the pass flags it with the layer checklist item'],
  }, ['slots', 'stack-areas']),
  i('sec-scenarios', 'Threat models, abuse cases, security regression tests and exercises', M10, ['type:feature', 'area:security', 'area:testing', 'priority:p1', 'size:l'], 'E15', {
    context: 'Teams rarely rehearse attacks before they happen.',
    goal: 'STRIDE threat model per layer as a living artifact; abuse cases added by /test plan for sensitive areas; a regression test per fixed vulnerability; tabletop exercises against runbooks on demand.',
    in: ['scenarios only against environments the project owns'], out: [], ac: ['the threat model refreshes when stack.yaml changes'],
    scenarios: ['Given an issue in the payments area, then the test plan includes Given-an-attacker scenarios'],
  }, ['test-skill', 'artifact-format']),
  i('sec-report', 'Private vulnerability reporting and the release gate', M10, ['type:feature', 'area:security', 'priority:p0', 'size:m'], 'E15', {
    context: 'Real vulnerabilities must never land in public issues.',
    goal: 'Draft security advisories on GitHub, confidential issues on GitLab; hardening uses the security label; /release refuses known-exploited vulnerabilities in shipped dependencies without a written risk acceptance.',
    in: [], out: [], ac: ['no code path files a vulnerability publicly'], scenarios: ['Given a confirmed injection bug, then a draft advisory is created, not an issue'],
  }, ['capability-probe', 'release']),
)
for (const it of issues) if (['E13', 'E14', 'E15'].includes(it.key)) it.labels = [...it.labels, { E13: 'area:audit', E14: 'area:standards', E15: 'area:security' }[it.key]]

// ── Added 2026-11-18: system map ────────────────────────────────────────────
labels.push(
  ['area:system', '0e8a16', 'System map: components, interfaces, exposure, contracts'],
  ['contract:breaking', 'b60205', 'Breaks an API or event contract; consumer owners must review'],
)
issues.push(
  e('E16', 'System map: repository shape, components, interfaces and exposure', M9,
    'One system.yaml and a /system skill that map components, edges, exposure and endpoints for single apps, monorepos and multi-repo microservices, check contracts and alert consumers to breaking changes.',
    'Architecture knowledge is implicit; contracts drift and breaking changes reach consumers unannounced.', `${D} §24; ${ADR('system-map')}`),
  i('system-file', 'system.yaml schema and `/system detect`', M9, ['type:feature', 'area:system', 'priority:p0', 'size:l'], 'E16', {
    context: 'Components, kinds, exposure and edges are not written down anywhere.',
    goal: 'Schema (kind, path or repo, layer, exposure, provides, consumes, owners); detect drafts it from workspaces, manifests, routes and platform configuration and asks where it cannot read.',
    in: ['pnpm/npm/yarn workspaces, Turborepo, Nx, Go workspaces, Cargo, Maven'], out: [], ac: ['every detected item cites its evidence file'],
    scenarios: ['Given a pnpm monorepo with apps/ and packages/, then detect lists each workspace package as a component with its dependencies'],
  }, ['yaml', 'stack-file']),
  i('endpoints', 'Endpoint inventory from code and specs, on demand', M9, ['type:feature', 'area:system', 'priority:p1', 'size:l'], 'E16', {
    context: 'Nobody has a complete list of routes and their auth.',
    goal: 'Extract routes from common frameworks and from OpenAPI/AsyncAPI/GraphQL specs; render method, path, component, auth and documented-or-not, cached and never committed.',
    in: ['Express, Hono, Fastify, Next/Astro routes, FastAPI, Django, Rails, Spring, ASP.NET, Go routers'], out: [],
    ac: ['unknown frameworks are reported, not silently skipped'], scenarios: ['Given a route missing from openapi.yaml, then it shows as undocumented'],
  }, ['system-file']),
  i('system-checks', 'System checks: spec drift, exposure, auth, webhooks, cycles, deep imports', M9, ['type:feature', 'area:system', 'area:security', 'priority:p1', 'size:l'], 'E16', {
    context: 'Most integration bugs are visible in the structure before they happen.',
    goal: 'Checks for spec drift, unauthenticated public endpoints, internal components reachable from the internet, unsigned incoming webhooks, module cycles, deep imports, shared databases between independent services, missing timeouts and retries; in doctor and in the security pass.',
    in: [], out: [], ac: ['each finding names the component, the file and the fix'],
    scenarios: ['Given a public webhook route without signature verification, then the check fails with the route'],
  }, ['endpoints']),
  i('contracts', 'Contract diffs in change requests and consumer alerts', M9, ['type:feature', 'area:system', 'area:github', 'priority:p0', 'size:m'], 'E16', {
    context: 'Consumers learn about breaking API changes in production.',
    goal: 'Diff OpenAPI/AsyncAPI/GraphQL contracts per change request; label contract:breaking and request reviews from consumer owners, including in other repositories through the platform adapter.',
    in: ['polyrepo: consumers fetched from pinned refs'], out: [], ac: ['a removed field is always breaking'],
    scenarios: ['Given a renamed endpoint consumed by web, then the PR is labelled contract:breaking and web owners are requested'],
  }, ['system-file', 'tracker']),
  i('affected', 'Monorepo affected graph for the gate and ownership', M9, ['type:feature', 'area:system', 'area:testing', 'priority:p1', 'size:m'], 'E16', {
    context: 'Running every suite on every change is slow in large monorepos.',
    goal: 'Compute affected components from the diff and the dependency graph; the gate runs their suites only; overlap and /next use components.',
    in: [], out: [], ac: ['local and CI compute the same affected set'], scenarios: ['Given a change in packages/db, then api and worker tests run and web tests do not'],
  }, ['system-file', 'gate']),
  i('api-docs', 'API docs and the system map artifact', M9, ['type:feature', 'area:system', 'area:artifacts', 'priority:p2', 'size:m'], 'E16', {
    context: 'Specs are hard to read raw, and the architecture lives in people\'s heads.',
    goal: 'Swagger UI or Redoc pages generated from the specs into the artifact site, and a system map diagram (components, edges, exposure) rebuilt when system.yaml or a spec changes; missing specs drafted from code on request.',
    in: [], out: [], ac: ['pages are self-contained (no external calls)'], scenarios: ['Given a new spec, then its docs page appears in the artifact index'],
  }, ['system-file', 'artifact-build']),
)
for (const it of issues) if (it.key === 'E16') it.labels = [...it.labels, 'area:system']
