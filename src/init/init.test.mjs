// Tests for the full init on fixture repositories: flags without prompts, existing agent files kept around managed
// blocks, 0 FAIL from doctor right after, the dry run, interactive answers, and the platform left alone without --setup.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from '../cli/main.mjs'

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
    const answers = ['en', 'active', 'ro', 'develop', 'n', 'n']
    const r = await init(dir, ['--platform', 'gitlab', '--project', 'team/app'], { ask: async (q) => { asked.push(q.split('?')[0]); return answers.shift() } })
    assert.equal(r.code, 0)
    assert.match(asked[0], /Which language should the agent talk to you in/)
    assert.match(asked[1], /This looks like a greenfield repository/)
    assert.match(asked[2], /Language of the team areas/)
    assert.match(asked[3], /Integration branch/)
    assert.match(asked[4], /Do several people work here/)
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
