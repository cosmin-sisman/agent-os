// Tests for `agent-os config`: get, set (choosing the right file), unset, validate exit codes, --dry-run and --json.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { run } from '../cli/main.mjs'

async function cli(cwd, ...argv) {
  let stdout = ''
  let stderr = ''
  const code = await run(argv, { stdout: (s) => { stdout += s }, stderr: (s) => { stderr += s }, cwd, env: {} })
  return { code, stdout, stderr }
}

function withRepo(fn) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aos-cfgcmd-'))
    try { await fn(dir) } finally { rmSync(dir, { recursive: true, force: true }) }
  }
}

const read = (dir, file) => JSON.parse(readFileSync(join(dir, file), 'utf8'))

test('set writes team keys to agent-os.json with $schema, and personal keys to local.json without touching .gitignore', withRepo(async (dir) => {
  execFileSync('git', ['init', '-q'], { cwd: dir })
  assert.equal((await cli(dir, 'config', 'set', 'languages.issues', 'ro')).code, 0)
  const r = await cli(dir, 'config', 'set', 'languages.chat', 'en')
  assert.equal(r.code, 0)
  const team = read(dir, 'agent-os.json')
  assert.equal(team.languages.issues, 'ro')
  assert.match(team.$schema, /agent-os\.schema\.json$/)
  assert.deepEqual(read(dir, '.agent-os/local.json'), { languages: { chat: 'en' } })
  assert.equal(existsSync(join(dir, '.gitignore')), false)
  assert.match(readFileSync(join(dir, '.git/info/exclude'), 'utf8'), /\.agent-os\/local\.json/)
  assert.match(r.stdout, /\.git\/info\/exclude/)
}))

test('set parses JSON values and rejects invalid ones without writing', withRepo(async (dir) => {
  await cli(dir, 'config', 'set', 'packs', '["stack-postgres"]')
  assert.deepEqual(read(dir, 'agent-os.json').packs, ['stack-postgres'])
  const bad = await cli(dir, 'config', 'set', 'languages.prs', 'de')
  assert.equal(bad.code, 2)
  assert.match(bad.stderr, /expected one of "en", "ro", got "de"/)
  assert.equal(read(dir, 'agent-os.json').languages, undefined)
}))

test('get returns merged values with defaults', withRepo(async (dir) => {
  await cli(dir, 'config', 'set', 'branches.integration', 'develop')
  assert.equal((await cli(dir, 'config', 'get', 'branches.integration')).stdout.trim(), 'develop')
  assert.equal((await cli(dir, 'config', 'get', 'branches.production')).stdout.trim(), 'main')
  const all = JSON.parse((await cli(dir, 'config', '--json')).stdout)
  assert.equal(all.result.languages.chat, 'en')
}))

test('unknown keys suggest the closest one', withRepo(async (dir) => {
  const r = await cli(dir, 'config', 'set', 'platform.hots', 'x')
  assert.equal(r.code, 2)
  assert.match(r.stderr, /did you mean "platform\.host"/)
}))

test('unset removes a key', withRepo(async (dir) => {
  await cli(dir, 'config', 'set', 'gate.unit', 'npm test')
  await cli(dir, 'config', 'unset', 'gate.unit')
  assert.deepEqual(read(dir, 'agent-os.json').gate, {})
}))

test('--dry-run reports the change and writes nothing', withRepo(async (dir) => {
  const r = await cli(dir, 'config', 'set', 'languages.docs', 'ro', '--dry-run')
  assert.equal(r.code, 0)
  assert.match(r.stdout, /would set languages\.docs in agent-os\.json/)
  assert.equal(existsSync(join(dir, 'agent-os.json')), false)
}))

test('validate exits 0 when valid and 1 with every problem listed', withRepo(async (dir) => {
  assert.equal((await cli(dir, 'config', 'validate')).code, 0)
  writeFileSync(join(dir, 'agent-os.json'), JSON.stringify({ languages: { chat: 'ro' }, profile: 'big' }))
  const r = await cli(dir, 'config', 'validate', '--json')
  assert.equal(r.code, 1)
  const out = JSON.parse(r.stdout)
  assert.equal(out.result.valid, false)
  assert.equal(out.result.problems.length, 2)
}))
