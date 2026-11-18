// Tests for `agent-os platform`: detect with and without --write, confirmation, --dry-run, show, and that a token
// inside the remote URL never reaches agent-os.json.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from '../cli/main.mjs'
import { fakeFetch } from '../platform/__fixtures__/fake-fetch.mjs'
import { fakeProbe } from '../env/__fixtures__/fake-probe.mjs'

const gitlab = () => fakeFetch({ 'https://git.company.internal/api/v3/meta': { status: 404 }, 'https://git.company.internal/api/v4/version': { status: 200, body: { version: '17.5.1' } } })

async function cli(cwd, argv, { answers, fetch = gitlab(), probe } = {}) {
  let stdout = ''
  let stderr = ''
  const io = { stdout: (s) => { stdout += s }, stderr: (s) => { stderr += s }, cwd, env: {}, fetch, probe }
  if (answers) io.ask = async () => answers.shift() ?? ''
  const code = await run(argv, io)
  return { code, stdout, stderr }
}
const tmp = () => mkdtempSync(join(tmpdir(), 'aos-platform-'))

test('detect proposes the platform and explains why, without writing', async () => {
  const dir = tmp()
  try {
    const r = await cli(dir, ['platform', 'detect', '--remote', 'git@git.company.internal:team/app.git'])
    assert.equal(r.code, 0)
    assert.match(r.stdout, /detected: gitlab \(self-managed 17\.5\.1\) at https:\/\/git\.company\.internal, project team\/app/)
    assert.match(r.stdout, /log in with: glab auth login --hostname git\.company\.internal/)
    assert.equal(existsSync(join(dir, 'agent-os.json')), false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('--write asks first; yes saves to agent-os.json, no leaves it', async () => {
  const dir = tmp()
  try {
    const no = await cli(dir, ['platform', 'detect', '--remote', 'git@git.company.internal:team/app.git', '--write'], { answers: ['n'] })
    assert.match(no.stdout, /not saved/)
    assert.equal(existsSync(join(dir, 'agent-os.json')), false)
    await cli(dir, ['platform', 'detect', '--remote', 'git@git.company.internal:team/app.git', '--write'], { answers: ['y'] })
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'agent-os.json'), 'utf8')).platform, { type: 'gitlab', host: 'https://git.company.internal', project: 'team/app' })
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a token inside the remote URL never reaches agent-os.json or the output', async () => {
  const dir = tmp()
  try {
    const remote = 'https://oauth2:glpat-ZZFAKETOKENZZFAKE@git.company.internal/team/app.git'
    const r = await cli(dir, ['platform', 'detect', '--remote', remote, '--write', '--yes', '--json'])
    const saved = readFileSync(join(dir, 'agent-os.json'), 'utf8')
    for (const text of [saved, r.stdout, r.stderr]) assert.ok(!text.includes('ZZFAKETOKEN') && !text.includes('oauth2'), text)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('an unidentified host exits 1 and suggests setting it by hand', async () => {
  const dir = tmp()
  try {
    const r = await cli(dir, ['platform', 'detect', '--remote', 'https://unknown.example/a/b'], { fetch: fakeFetch({}) })
    assert.equal(r.code, 1)
    assert.match(r.stdout, /not identified: unknown\.example is neither GitHub nor GitLab/)
    assert.match(r.stdout, /agent-os config set platform\.type/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('--dry-run with --write writes nothing', async () => {
  const dir = tmp()
  try {
    const r = await cli(dir, ['platform', 'detect', '--remote', 'git@github.com:o/r.git', '--write', '--dry-run'])
    assert.match(r.stdout, /would save platform to agent-os\.json/)
    assert.equal(existsSync(join(dir, 'agent-os.json')), false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('show reports the platform and the login state from gh or glab', async () => {
  const dir = tmp()
  try {
    const probe = fakeProbe({ files: {}, commands: { 'gh auth status --hostname github.com': { status: 1, stderr: 'not logged in' } } })
    const r = await cli(dir, ['platform'], { probe })
    assert.equal(r.code, 1)
    assert.match(r.stdout, /^github at https:\/\/github\.com \(no project set\)/)
    assert.match(r.stdout, /fix: gh auth login --hostname github\.com/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
