// Tests for the full init on fixture repositories: flags without prompts, existing agent files kept around managed
// blocks, 0 FAIL from doctor right after, the dry run, interactive answers, and the platform left alone without --setup.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from '../cli/main.mjs'
import { agentsBlock } from '../managed/install.mjs'

const noPrompt = async (q) => { throw new Error(`unexpected prompt: ${q}`) }
async function init(dir, argv, extra = {}) {
  let stdout = ''
  let stderr = ''
  const code = await run(['init', ...argv], { stdout: (s) => { stdout += s }, stderr: (s) => { stderr += s }, cwd: dir, env: {}, running: '0.0.0', git: () => ({ status: 128, stdout: '', stderr: '' }), gh: () => ({ status: 1, stdout: '', stderr: 'gh: not logged in' }), remote: null, ...extra })
  return { code, stdout, stderr }
}
const FLAGS = ['--platform', 'github', '--project', 'acme/app', '--lang', 'en', '--chat', 'ro', '--team', '--yes']
const read = (dir, f) => readFileSync(join(dir, f), 'utf8')

test('given --yes and flags, no prompt appears; init writes the configuration and files, and doctor reports 0 FAIL', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aos-init-'))
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node --test', lint: 'eslint .' } }))
    const r = await init(dir, [...FLAGS, '--area-lang', 'issues=ro'], { ask: noPrompt })
    assert.equal(r.code, 0, r.stdout + r.stderr)
    const team = JSON.parse(read(dir, 'agent-os.json'))
    assert.deepEqual([team.version, team.platform, team.branches.integration, team.branches.requiredApprovals, team.languages.issues, team.languages.prs], ['0.0.0', { type: 'github', project: 'acme/app' }, 'development', 1, 'ro', 'en'])
    assert.deepEqual(team.gate, { test: 'npm run test', lint: 'npm run lint' })
    assert.match(team.adoption.warnOnlyUntil, /^\d{4}-\d{2}-\d{2}$/)
    assert.equal(JSON.parse(read(dir, '.agent-os/local.json')).languages.chat, 'ro', 'the chat language is personal')
    assert.ok(!('chat' in team.languages))
    assert.match(read(dir, '.gitignore'), /\.agent-os\/local\.json\n\.agent-os\/cache\/\n\.claude\/settings\.local\.json\n\.claude\/worktrees\//)
    assert.ok(existsSync(join(dir, '.claude/skills/start/SKILL.md')))
    assert.match(r.stdout, /doctor: readiness \d+\/100, 0 fail/)
    assert.match(r.stdout, /next: agent-os setup --dry-run/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('existing CLAUDE.md and AGENTS.md are kept; agent-os adds its managed blocks around the team text', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aos-init-'))
  try {
    writeFileSync(join(dir, 'AGENTS.md'), '# Our agents guide\n\nUse pnpm, never npm.\n')
    writeFileSync(join(dir, 'CLAUDE.md'), 'Be brief.\n')
    assert.equal((await init(dir, FLAGS, { ask: noPrompt })).code, 0)
    const agents = read(dir, 'AGENTS.md')
    assert.ok(agents.startsWith('# Our agents guide\n\nUse pnpm, never npm.\n'), 'the team text is byte-identical')
    assert.match(agents, /<!-- agent-os:begin agent-os -->\n## agent-os\n\nThis repository follows agent-os 0\.0\.0/)
    assert.match(read(dir, 'CLAUDE.md'), /^Be brief\.\n\n<!-- agent-os:begin agent-os -->\n@AGENTS\.md\n<!-- agent-os:end agent-os -->\n$/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('--dry-run shows the whole plan and writes nothing; the platform plan is shown even when it cannot be read', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aos-init-'))
  try {
    const r = await init(dir, [...FLAGS, '--dry-run'], { ask: noPrompt })
    assert.equal(r.code, 0)
    assert.match(r.stdout, /profile: greenfield; team areas in en; chat in ro; development → main; team \(1 approval\)/)
    assert.match(r.stdout, /write agent-os\.json, \.agent-os\/local\.json, \.gitignore/)
    assert.match(r.stdout, /install \.claude\/skills\/start\/SKILL\.md/)
    assert.match(r.stdout, /platform plan unavailable: GitHub API/)
    assert.ok(!existsSync(join(dir, 'agent-os.json')))
    assert.ok(!existsSync(join(dir, '.claude')))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('interactively: chat first, then the profile, languages, branch and team; nothing is written without a yes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aos-init-'))
  try {
    const asked = []
    const answers = ['en', 'active', 'ro', 'develop', 'n', 'forward-only', 'n']
    const r = await init(dir, ['--platform', 'gitlab', '--project', 'team/app'], { ask: async (q) => { asked.push(q.split('?')[0]); return answers.shift() } })
    assert.equal(r.code, 0)
    assert.match(asked[0], /Which language should the agent talk to you in/)
    assert.match(asked[1], /This looks like a greenfield repository/)
    assert.match(asked[2], /Language of the team areas/)
    assert.match(asked[3], /Integration branch/)
    assert.match(asked[4], /Do several people work here/)
    assert.match(asked[5], /This repository has history/)
    assert.match(r.stdout, /nothing written/)
    assert.ok(!existsSync(join(dir, 'agent-os.json')))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('the platform is detected from the origin remote when not given', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aos-init-'))
  try {
    const r = await init(dir, ['--lang', 'en', '--chat', 'en', '--solo', '--yes', '--dry-run'], { ask: noPrompt, remote: 'git@github.com:acme/shop.git' })
    assert.match(r.stdout, /platform: github acme\/shop \(the remote is on github\.com\)/)
    assert.match(r.stdout, /solo/)
    const none = await init(dir, ['--lang', 'en', '--chat', 'en', '--yes'], { ask: noPrompt, remote: null })
    assert.equal(none.code, 2)
    assert.match(none.stderr, /pass --platform github\|gitlab --project/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('given old issues without milestones, doctor does not report them after a forward-only init; old docs are warnings, not failures', async () => {
  const { spawnSync } = await import('node:child_process')
  const { mkdirSync } = await import('node:fs')
  const { loadConfig } = await import('../config/config.mjs')
  const { runDoctor } = await import('../doctor/doctor.mjs')
  const { readJournal } = await import('../journal/journal.mjs')
  const dir = mkdtempSync(join(tmpdir(), 'aos-init-legacy-'))
  try {
    // A legacy repository: years of history, tags, docs with a link that broke long ago.
    const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(dir, '.gc'), GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@e.com', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@e.com', GIT_AUTHOR_DATE: '2024-01-10T10:00:00Z', GIT_COMMITTER_DATE: '2024-01-10T10:00:00Z' }
    writeFileSync(join(dir, '.gc'), '[commit]\n\tgpgsign = false\n')
    const g = (...a) => spawnSync('git', a, { cwd: dir, env, encoding: 'utf8' })
    g('init', '-q')
    mkdirSync(join(dir, 'src'), { recursive: true })
    for (let i = 0; i < 8; i++) { writeFileSync(join(dir, `src/m${i}.js`), `export const x${i} = ${i}\n`); g('add', '-A'); g('commit', '-qm', `m${i}`) }
    writeFileSync(join(dir, 'README.md'), '# Legacy\n\nSee [the old guide](docs/gone.md).\n'); g('add', '-A'); g('commit', '-qm', 'readme'); g('tag', 'v1.0.0')
    const git = (args) => { const r = spawnSync('git', args, { cwd: dir, env, encoding: 'utf8' }); return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' } }
    const r = await init(dir, [...FLAGS, '--methodology', 'forward-only', '--author', 'ana'], { ask: noPrompt, git })
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /profile: maintenance, forward-only from \d{4}-\d{2}-\d{2}/)
    const config = loadConfig(dir).merged
    assert.match(config.adoption.cutoff, /^\d{4}-\d{2}-\d{2}$/)
    const [baseline] = readJournal(dir)
    assert.equal(baseline.meta.type, 'note')
    assert.match(baseline.title, /^Baseline: agent-os adopted forward-only on /)
    assert.match(baseline.body, /- Commits: 9 \(0 in the last 90 days\), last on 2024-01-10T10:00:00Z; tags: 1/)
    // The platform: old issues without milestones are history; a new one is reported.
    const tracker = { openIssues: () => [{ number: 3, labels: [], milestone: null, createdAt: '2024-02-01T00:00:00Z' }, { number: 90, labels: [], milestone: null, createdAt: '2099-01-01T00:00:00Z' }], labels: () => [], pullRequests: () => [], blockers: () => [] }
    const d = runDoctor({ cwd: dir, config, running: '0.0.0', tracker, me: 'ana' }, {})
    const issueMsgs = d.checks.find((c) => c.id === 'issues').findings.map((f) => f.message)
    assert.ok(!issueMsgs.some((m) => m.startsWith('#3 ')), 'old issues are not reported')
    assert.ok(issueMsgs.some((m) => m.startsWith('#90 ')))
    const link = d.checks.find((c) => c.id === 'links').findings.find((f) => /README\.md/.test(f.message))
    assert.equal(link.level, 'warn')
    assert.match(link.message, /pre-existing; forward-only since/)
    assert.equal(runDoctor({ cwd: dir, config, running: '0.0.0' }, { offline: true }).summary.fail, 0, 'doctor passes on a legacy repo right after init')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('the AGENTS.md block tells other agents how to run a skill, in en and in ASCII ro', () => {
  const en = agentsBlock({ version: '0.1.2', branches: {} })
  assert.match(en, /In an agent other than Claude Code, a request for `\/<name>` means reading `\.claude\/skills\/<name>\/SKILL\.md` and following it; every step in it is an `agent-os` command\./)
  const ro = agentsBlock({ version: '0.1.2', branches: {}, languages: { docs: 'ro' } })
  assert.match(ro, /Alt agent decat Claude Code: o cerere pentru `\/<name>` inseamna sa citesti `\.claude\/skills\/<name>\/SKILL\.md`/)
  assert.match(ro, /^[\x00-\x7F]*$/, 'ro is ASCII')
  assert.equal(en.split('\n').length, ro.split('\n').length, 'the same lines in both languages')
  assert.match(en, /Where `agent-os` is not installed, run each command as `npx -y @cosmin-sisman\/agent-os@0\.1\.2 <command>` \(never an unscoped `agent-os` package\)/)
  assert.match(ro, /Daca `agent-os` nu e instalat, ruleaza fiecare comanda ca `npx -y @cosmin-sisman\/agent-os@0\.1\.2 <comanda>`/)
})
