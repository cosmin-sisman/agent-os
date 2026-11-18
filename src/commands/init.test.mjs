// Tests for `agent-os init --me`: chat language asked first, sessions and machine questions, flags and defaults,
// no committed file ever modified, and the personal chat language living beside the team's languages.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { run } from '../cli/main.mjs'
import { loadConfig } from '../config/config.mjs'
import { renderLanguageRule } from '../i18n/i18n.mjs'

async function cli(cwd, argv, answers) {
  let stdout = ''
  let stderr = ''
  const asked = []
  const io = { stdout: (s) => { stdout += s }, stderr: (s) => { stderr += s }, cwd, env: {} }
  if (answers) io.ask = async (q) => { asked.push(q); return answers.shift() ?? '' }
  const code = await run(argv, io)
  return { code, stdout, stderr, asked }
}

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' })

/** A git repository with a committed team file and .gitignore, like a project someone joins. */
function project({ gitignore = 'node_modules/\n', team = { languages: { issues: 'ro' } } } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'aos-init-'))
  git(dir, 'init', '-q')
  writeFileSync(join(dir, '.gitignore'), gitignore)
  writeFileSync(join(dir, 'agent-os.json'), JSON.stringify(team))
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', 'team setup')
  return dir
}
const readLocal = (dir) => JSON.parse(readFileSync(join(dir, '.agent-os/local.json'), 'utf8'))

test('the chat language is the first question, and one session skips the parallel-session questions', async () => {
  const dir = project()
  try {
    const r = await cli(dir, ['init', '--me'], ['ro', '1', '2048'])
    assert.equal(r.code, 0, r.stderr)
    assert.equal(r.asked.length, 3)
    assert.match(r.asked[0], /Which language should the agent talk to you in\?/)
    assert.match(r.asked[1], /How many agent sessions/)
    assert.deepEqual(readLocal(dir), { languages: { chat: 'ro' }, machine: { maxWorkers: 1, minFreeMb: 2048 }, orchestrator: false })
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('several sessions also ask about the orchestrator and the first dev port', async () => {
  const dir = project()
  try {
    const r = await cli(dir, ['init', '--me'], ['en', '3', 'y', '6000', ''])
    assert.equal(r.code, 0, r.stderr)
    assert.equal(r.asked.length, 5)
    assert.deepEqual(readLocal(dir), { languages: { chat: 'en' }, machine: { maxWorkers: 3, minFreeMb: 1500, devPortStart: 6000 }, orchestrator: true })
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('init --me never modifies a committed file; the personal files are excluded locally instead', async () => {
  const dir = project()
  try {
    const before = readFileSync(join(dir, '.gitignore'), 'utf8')
    const r = await cli(dir, ['init', '--me', '--yes'])
    assert.equal(r.code, 0, r.stderr)
    assert.equal(git(dir, 'status', '--porcelain', '--untracked-files=all'), '')
    assert.equal(readFileSync(join(dir, '.gitignore'), 'utf8'), before)
    assert.match(readFileSync(join(dir, '.git/info/exclude'), 'utf8'), /\.agent-os\/local\.json\n\.agent-os\/cache\/\n/)
    assert.match(r.stdout, /\.git\/info\/exclude \(local, never committed\); ask the team to add them to \.gitignore/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('when .gitignore already covers the personal files, nothing else is touched', async () => {
  const dir = project({ gitignore: '.agent-os/local.json\n.agent-os/cache/\n' })
  try {
    const exclude = join(dir, '.git/info/exclude')
    const before = existsSync(exclude) ? readFileSync(exclude, 'utf8') : ''
    assert.equal((await cli(dir, ['init', '--me', '--yes'])).code, 0)
    assert.equal(existsSync(exclude) ? readFileSync(exclude, 'utf8') : '', before)
    assert.equal(git(dir, 'status', '--porcelain', '--untracked-files=all'), '')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a teammate who picks chat en keeps the team issues in ASCII ro', async () => {
  const dir = project({ team: { languages: { issues: 'ro', prs: 'en' } } })
  try {
    await cli(dir, ['init', '--me', '--chat', 'en', '--yes'])
    const { merged } = loadConfig(dir)
    assert.equal(merged.languages.chat, 'en')
    assert.equal(merged.languages.issues, 'ro')
    const rule = renderLanguageRule(merged)
    assert.match(rule, /\| chat \(personal\) \| .* \| English \|/)
    assert.match(rule, /\| issues \| .* \| Romanian without diacritics/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('flags answer the questions; invalid flags exit 2', async () => {
  const dir = project()
  try {
    const r = await cli(dir, ['init', '--me', '--chat', 'ro', '--sessions', '2', '--orchestrator', '--dev-port', '5500', '--min-free-mb', '1000'], [])
    assert.equal(r.asked.length, 0)
    assert.deepEqual(readLocal(dir).machine, { maxWorkers: 2, minFreeMb: 1000, devPortStart: 5500 })
    const bad = await cli(dir, ['init', '--me', '--chat', 'fr', '--yes'])
    assert.equal(bad.code, 2)
    assert.match(bad.stderr, /--chat must be one of en, ro/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('--dry-run writes nothing', async () => {
  const dir = project()
  try {
    const r = await cli(dir, ['init', '--me', '--yes', '--dry-run'])
    assert.equal(r.code, 0)
    assert.match(r.stdout, /would write \.agent-os\/local\.json/)
    assert.equal(existsSync(join(dir, '.agent-os')), false)
    assert.equal(git(dir, 'status', '--porcelain', '--untracked-files=all'), '')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('outside a git repository it writes the personal file and warns', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aos-init-nogit-'))
  try {
    const r = await cli(dir, ['init', '--me', '--yes'])
    assert.equal(r.code, 0)
    assert.match(r.stdout, /not a git repository/)
    assert.match(r.stdout, /no agent-os\.json yet/)
    assert.equal(readLocal(dir).languages.chat, 'en')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
