// Tests for doctor: a fresh install has no failures, every finding names its fix, the registry/skills consistency
// rule, links, commands, budgets, hooks, ro areas, the journal cutoff, --fix, platform checks and the score.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { loadConfig } from '../config/config.mjs'
import { installRoutes } from '../managed/install.mjs'
import { report, runDoctor } from './doctor.mjs'
import { COMMANDS } from '../cli/registry.mjs'

// A planned command for the "calls a planned command" check: a real one while any is left, else one for this process.
const PLANNED = COMMANDS.find((c) => c.status === 'planned') ?? (COMMANDS.push({ name: 'planned-fixture', summary: 'A planned command (test fixture)', status: 'planned', issue: 999 }), COMMANDS.at(-1))

const write = (root, files) => { for (const [p, c] of Object.entries(files)) { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), c) } }

/** What init produces: the team config, .gitignore and the managed files for the platform. */
function freshInstall(config = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-doctor-'))
  write(cwd, { 'agent-os.json': JSON.stringify({ version: '0.0.0', platform: { type: 'github', project: 'acme/app' }, ...config }), '.gitignore': '.agent-os/local.json\n.agent-os/cache/\n' })
  installRoutes(cwd, loadConfig(cwd).merged, { version: '0.0.0' })
  return cwd
}
const doctor = (cwd, deps = {}, options = { offline: true }) => runDoctor({ cwd, config: loadConfig(cwd).merged, running: '0.0.0', ...deps }, options)
const findings = (r, id) => r.checks.find((c) => c.id === id).findings.filter((f) => f.level === 'warn' || f.level === 'fail')

test('a fresh install has 0 FAIL, on GitHub and on GitLab, in en and ro', () => {
  for (const config of [{}, { platform: { type: 'gitlab', project: 'team/app' } }, { languages: { issues: 'ro', prs: 'ro', journal: 'ro' } }]) {
    const cwd = freshInstall(config)
    try {
      const r = doctor(cwd)
      assert.equal(r.summary.fail, 0, report(r))
    } finally { rmSync(cwd, { recursive: true, force: true }) }
  }
})

test('given a skill folder without a registry entry, doctor fails naming it; an entry without a folder fails too', () => {
  const cwd = freshInstall()
  try {
    write(cwd, { '.claude/skills/deploy/SKILL.md': '---\nname: deploy\ndescription: Deploy it.\n---\n', '.agent-os/registry/gone.json': '{"name":"gone","origin":"external","source":"github:acme/gone@v1"}', '.agent-os/registry/code-review.json': '{"name":"code-review","origin":"builtin"}' })
    const r = doctor(cwd)
    const f = findings(r, 'skills')
    assert.deepEqual(f.map((x) => x.message), ['the skill folder .claude/skills/deploy has no registry entry', '.agent-os/registry/gone.json registers "gone", which has no folder in .claude/skills/'])
    assert.match(f[0].fix, /agent-os skill register deploy --origin local/)
    assert.equal(r.summary.fail > 0, true)
    write(cwd, { '.agent-os/registry/deploy.json': '{"name":"deploy","origin":"local"}' })
    rmSync(join(cwd, '.agent-os/registry/gone.json'))
    assert.deepEqual(findings(doctor(cwd), 'skills'), [])
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('every finding names its fix', () => {
  const cwd = freshInstall({ slots: { review: 'missing-skill' }, contextBudgets: { 'big.md': '1KB' } })
  try {
    write(cwd, {
      'AGENTS.md': `# A\n\nSee [the guide](docs/nope.md) and run \`x\`. Use \`agent-os frobnicate\` and \`agent-os ${PLANNED.name}\`.\n`,
      'big.md': 'x'.repeat(2000),
      '.claude/skills/broken/SKILL.md': 'no front matter',
      'x.md.rej': 'conflict',
      'src/a.mjs': '',
    })
    writeFileSync(join(cwd, '.gitignore'), 'node_modules\n')
    const r = doctor(cwd)
    const all = r.checks.flatMap((c) => c.findings.filter((f) => f.level === 'warn' || f.level === 'fail'))
    assert.ok(all.length >= 8, report(r))
    for (const f of all) assert.ok(f.fix && f.fix.length > 5, `no fix for: ${f.message}`)
    const msgs = all.map((f) => f.message).join('\n')
    assert.match(msgs, /AGENTS\.md: the link to docs\/nope\.md is broken/)
    assert.match(msgs, /calls "agent-os frobnicate", which is not a command/)
    assert.ok(msgs.includes(`calls "agent-os ${PLANNED.name}", which is planned (#${PLANNED.issue})`), msgs)
    assert.match(msgs, /big\.md is 2\.0 KB, over its 1KB budget/)
    assert.match(msgs, /x\.md\.rej holds an unresolved update conflict/)
    assert.match(msgs, /slot "review" is bound to "missing-skill"/)
    assert.match(msgs, /does not mention src\//)
    assert.match(msgs, /\.gitignore does not ignore/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('--fix repairs what is mechanical (.gitignore, diacritics in ro areas) and checks again', () => {
  const cwd = freshInstall({ languages: { prs: 'ro' } })
  try {
    writeFileSync(join(cwd, '.gitignore'), 'node_modules')
    writeFileSync(join(cwd, '.github/pull_request_template.md'), '## Lecții\n\nȘtiu.\n')
    const before = doctor(cwd)
    assert.match(findings(before, 'language')[0].message, /pull_request_template\.md:1:7: "ț" in a ro area \(prs\); 2 diacritic/)
    const r = doctor(cwd, {}, { offline: true, fix: true })
    assert.deepEqual(r.fixed.sort(), ['added .agent-os/local.json, .agent-os/cache/ to .gitignore', 'replaced 2 diacritic(s) in .github/pull_request_template.md'])
    assert.equal(readFileSync(join(cwd, '.github/pull_request_template.md'), 'utf8'), '## Lectii\n\nStiu.\n')
    assert.equal(readFileSync(join(cwd, '.gitignore'), 'utf8'), 'node_modules\n.agent-os/local.json\n.agent-os/cache/\n')
    assert.equal(r.summary.fail, 0, report(r))
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('hooks that do not run the pinned version fail', () => {
  const cwd = freshInstall()
  try {
    write(cwd, { '.claude/settings.json': JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'npx -y @cosmin-sisman/agent-os hook SessionStart' }] }] } }) })
    assert.match(findings(doctor(cwd), 'hooks')[0].message, /do not run the pinned version 0\.0\.0/)
    write(cwd, { '.claude/settings.json': '{ nope' })
    assert.match(findings(doctor(cwd), 'hooks')[0].message, /not valid JSON/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('journal entries before the adoption cutoff are left alone (forward-only)', () => {
  const cwd = freshInstall({ adoption: { cutoff: '2026-11-01' } })
  try {
    write(cwd, { '.agent-os/journal/2026/10/2026-10-05T10-00-ana-old.md': 'no front matter', '.agent-os/journal/2026/11/2026-11-05T10-00-ana-new.md': 'no front matter' })
    const f = findings(doctor(cwd), 'journal')
    assert.equal(f.length, 1)
    assert.match(f[0].message, /2026-11-05T10-00-ana-new\.md: no front matter/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('platform checks: issues without type, priority or milestone, a blocked label without a blocker, missing labels, PR titles', () => {
  const cwd = freshInstall({ adoption: { cutoff: '2026-11-01' } })
  try {
    const tracker = {
      openIssues: () => [
        { number: 1, labels: ['type:bug', 'priority:p1'], milestone: { title: 'v1' }, createdAt: '2026-11-10T00:00:00Z' },
        { number: 2, labels: [], milestone: null, createdAt: '2026-11-10T00:00:00Z' },
        { number: 3, labels: ['type:bug', 'priority:p1', 'blocked'], milestone: { title: 'v1' }, createdAt: '2026-11-10T00:00:00Z' },
        { number: 4, labels: [], milestone: null, createdAt: '2026-01-10T00:00:00Z' },
        { number: 5, labels: ['type:epic'], milestone: { title: 'v1' }, createdAt: '2026-11-10T00:00:00Z' },
      ],
      blockers: () => [{ number: 9, state: 'closed' }],
      labels: () => ['type:bug'],
      pullRequests: () => [{ number: 40, title: 'Fix it.' }],
      pullRequestStatus: () => ({ title: 'Fix it.', body: '' }),
    }
    const r = doctor(cwd, { tracker, caps: { dependencies: { value: true } }, me: 'ana' }, {})
    assert.equal(r.mode, 'full')
    assert.deepEqual(findings(r, 'issues').map((f) => f.message), ['#2 is missing a type label, a priority label and a milestone', '#3 has the blocked label but no open blocker'])
    assert.match(findings(r, 'labels')[0].message, /convention label\(s\) are missing/)
    assert.match(findings(r, 'titles')[0].message, /^Fix it\.: /)
    const offline = doctor(cwd, { tracker }, { ci: true })
    assert.deepEqual(offline.checks.filter((c) => c.skipped).map((c) => c.id), ['issues', 'labels', 'titles', 'protection'])
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('the score counts ok as 1 and warn as half; a failing check that throws becomes a warning, not a crash', () => {
  const cwd = freshInstall()
  try {
    const r = doctor(cwd, { tracker: { openIssues: () => { throw Object.assign(new Error('HTTP 401'), { hint: 'gh auth login' }) }, pullRequests: () => [] }, me: 'ana' }, {})
    const issues = r.checks.find((c) => c.id === 'issues')
    assert.equal(issues.level, 'warn')
    assert.match(issues.findings[0].message, /could not run: HTTP 401/)
    const n = r.summary.ok + r.summary.warn + r.summary.fail
    assert.equal(r.score, Math.round((100 * (r.summary.ok + r.summary.warn / 2)) / n))
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('given .agent-os/local.json committed by mistake, doctor fails, names it and suggests git rm --cached; --fix leaves the index alone', () => {
  const cwd = freshInstall()
  try {
    const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(cwd, '.gitconfig-test'), GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com' }
    writeFileSync(join(cwd, '.gitconfig-test'), '')
    const g = (...args) => spawnSync('git', args, { cwd, env, encoding: 'utf8' })
    g('init', '-q')
    write(cwd, { '.agent-os/local.json': '{"languages":{"chat":"ro"}}', '.claude/worktrees/feat-1/x.txt': 'x' })
    g('add', '-A'); g('add', '-f', '.agent-os/local.json', '.claude/worktrees/feat-1/x.txt'); g('commit', '-qm', 'oops')
    const git = (args) => g(...args)
    const r = doctor(cwd, { git })
    const f = findings(r, 'personal')
    assert.equal(f[0].level, 'fail')
    assert.match(f[0].message, /git tracks personal file\(s\): \.agent-os\/local\.json, \.claude\/worktrees\/feat-1\/x\.txt/)
    assert.match(f[0].fix, /git rm --cached -r -- \.agent-os\/local\.json \.claude\/worktrees/)
    assert.equal(f[0].fixable, false)
    doctor(cwd, { git }, { offline: true, fix: true })
    assert.match(g('ls-files').stdout, /\.agent-os\/local\.json/, '--fix never removes tracked files')
    g('rm', '-q', '--cached', '-r', '--', '.agent-os/local.json', '.claude/worktrees'); g('commit', '-qm', 'untrack')
    assert.deepEqual(findings(doctor(cwd, { git }), 'personal'), [])
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('doctor names the Claude Code-only parts as an info note: never a warning, the score and exit code unchanged', () => {
  const cwd = freshInstall()
  try {
    const r = doctor(cwd)
    const agents = r.checks.find((c) => c.id === 'agents')
    assert.equal(agents.level, 'ok', 'info counts as ok')
    assert.deepEqual(agents.findings.map((f) => f.level), ['info'])
    assert.match(agents.findings[0].message, /only Claude Code runs the hooks .* and the subagent fan-out/)
    assert.equal(r.summary.fail, 0)
    const without = runDoctor({ cwd, config: loadConfig(cwd).merged, running: '0.0.0' }, { offline: true, only: r.checks.filter((c) => !c.skipped && c.id !== 'agents').map((c) => c.id) })
    assert.equal(r.score, Math.round((100 * (without.summary.ok + 1 + without.summary.warn / 2)) / (without.summary.ok + without.summary.warn + without.summary.fail + 1)))
    assert.match(report(r), /^info {2}\[agents\] only Claude Code runs the hooks/m)
    assert.ok(report(r).indexOf('info  [agents]') > report(r).lastIndexOf('warn  ['), 'info notes come after the warnings')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('missing branch protection is a warning with its reason, never a failure (#274)', () => {
  const cwd = freshInstall()
  try {
    const tracker = { openIssues: () => [], pullRequests: () => [], labels: () => [] }
    const check = (steps) => doctor(cwd, { tracker, me: 'ana', platformPlan: () => steps }, {}).checks.find((c) => c.id === 'protection')
    const free = check([{ area: 'ruleset', action: 'keep', unavailable: true, description: 'branch protection is not available here (a private repository on GitHub Free …)' }])
    assert.equal(free.level, 'warn')
    assert.match(free.findings[0].message, /branch protection is not available here/)
    assert.match(free.findings[0].fix, /GitHub Pro or Team[\s\S]*review every change request/)
    const missing = check([{ area: 'ruleset', action: 'create', description: 'protect main and development: no direct push' }])
    assert.equal(missing.level, 'warn')
    assert.match(missing.findings[0].fix, /agent-os setup --only ruleset/)
    assert.equal(check([]).level, 'ok')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
