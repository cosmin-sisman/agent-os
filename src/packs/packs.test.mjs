// Tests for packs: given a pack requiring an MCP server, env reports it after add; adding fills only what
// agent-os.json does not set; removing a pack removes everything it installed and nothing else; a file edited by hand
// stops the removal (eject keeps it); install and update keep a pack's files; the ro rule is ASCII.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from '../cli/main.mjs'
import { readLock } from '../managed/managed.mjs'
import { planInstall } from '../managed/install.mjs'
import { withDefaults } from '../config/config.mjs'
import { SCHEMA } from '../config/schema.mjs'
import { findDiacritics } from '../i18n/i18n.mjs'
import { fakeProbe } from '../env/__fixtures__/fake-probe.mjs'
import { packItems } from './packs.mjs'

const TEAM = { platform: { type: 'github' }, gate: { unit: 'npm test', 'db-migrations': 'make db-check' }, requires: { cli: { node: '>=22' } } }
function project(team = TEAM) {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-pack-'))
  writeFileSync(join(cwd, 'agent-os.json'), `${JSON.stringify(team, null, 2)}\n`)
  return cwd
}
async function cli(cwd, argv, extra = {}) {
  let stdout = ''
  let stderr = ''
  const code = await run(argv, { stdout: (s) => { stdout += s }, stderr: (s) => { stderr += s }, cwd, env: {}, ...extra })
  return { code, stdout, stderr }
}
const team = (cwd) => JSON.parse(readFileSync(join(cwd, 'agent-os.json'), 'utf8'))

test('given a pack requiring an MCP server, env reports it after add', async () => {
  const cwd = project()
  try {
    const r = await cli(cwd, ['add', 'stack-postgres'])
    assert.equal(r.code, 0, r.stderr)
    const env = await cli(cwd, ['env'], { probe: fakeProbe({ commands: { 'claude mcp list': { stdout: 'No MCP servers configured.' } } }) })
    assert.match(env.stdout, /postgres/, 'the pack MCP server is checked')
    assert.match(env.stdout, /psql/, 'and its CLI')
    assert.match(env.stdout, /DATABASE_URL/, 'and its variable (never its value)')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('add installs the files and fills only what agent-os.json does not set; the lock records exactly that', async () => {
  const cwd = project()
  try {
    assert.match((await cli(cwd, ['pack', 'add', 'stack-postgres', '--dry-run'])).stdout, /would add stack-postgres/)
    assert.equal(existsSync(join(cwd, '.claude')), false, 'a dry run writes nothing')
    await cli(cwd, ['pack', 'add', 'stack-postgres'])
    assert.ok(existsSync(join(cwd, '.claude/rules/packs/stack-postgres/postgres.md')))
    assert.match(readFileSync(join(cwd, '.claude/agents/postgres-reviewer.md'), 'utf8'), /^---\nname: postgres-reviewer/)
    const t = team(cwd)
    assert.deepEqual(t.packs, ['stack-postgres'])
    assert.equal(t.gate['db-migrations'], 'make db-check', 'the team setting wins')
    assert.deepEqual(t.gatePaths, { '**/migrations/**': ['db-migrations'], '**/*.sql': ['db-migrations'] })
    assert.deepEqual(t.requires.cli, { node: '>=22', psql: '>=14' })
    const rec = readLock(cwd).packs['stack-postgres']
    assert.deepEqual(rec.added, { gate: [], gatePaths: ['**/migrations/**', '**/*.sql'], cli: ['psql'], mcp: ['postgres'], env: ['DATABASE_URL'], slots: [] })
    assert.match((await cli(cwd, ['pack', 'add', 'stack-postgres'])).stdout, /already added/)
    assert.ok(planInstall(withDefaults(SCHEMA, t), { cwd }).items.some((i) => i.key === '.claude/agents/postgres-reviewer.md'), 'install and update keep its files')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('removing a pack removes everything it installed, and nothing else', async () => {
  const cwd = project()
  try {
    writeFileSync(join(cwd, 'notes.md'), 'mine')
    await cli(cwd, ['pack', 'add', 'stack-postgres'])
    const r = await cli(cwd, ['pack', 'remove', 'stack-postgres'])
    assert.equal(r.code, 0, r.stderr)
    assert.equal(existsSync(join(cwd, '.claude/rules/packs/stack-postgres/postgres.md')), false)
    assert.equal(existsSync(join(cwd, '.claude/agents/postgres-reviewer.md')), false)
    assert.deepEqual(team(cwd), TEAM, 'agent-os.json is exactly as before')
    const lock = readLock(cwd)
    assert.equal(lock.packs['stack-postgres'], undefined)
    assert.equal(Object.keys(lock.items).some((k) => /postgres/.test(k)), false)
    assert.equal(readFileSync(join(cwd, 'notes.md'), 'utf8'), 'mine')
    assert.match((await cli(cwd, ['pack', 'remove', 'stack-postgres'])).stderr, /the lock has no record of it/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('a file edited by hand stops the removal and nothing changes; after eject the pack is removed and the file kept', async () => {
  const cwd = project()
  try {
    await cli(cwd, ['pack', 'add', 'stack-postgres'])
    const agent = join(cwd, '.claude/agents/postgres-reviewer.md')
    writeFileSync(agent, `${readFileSync(agent, 'utf8')}\nOur own extra step.\n`)
    const before = team(cwd)
    const r = await cli(cwd, ['pack', 'remove', 'stack-postgres'])
    assert.equal(r.code, 2)
    assert.match(r.stderr, /not removed: \.claude\/agents\/postgres-reviewer\.md was edited by hand[\s\S]*agent-os eject/)
    assert.ok(existsSync(join(cwd, '.claude/rules/packs/stack-postgres/postgres.md')), 'nothing was removed')
    assert.deepEqual(team(cwd), before)
    assert.equal((await cli(cwd, ['eject', '.claude/agents/postgres-reviewer.md'])).code, 0)
    assert.equal((await cli(cwd, ['pack', 'remove', 'stack-postgres'])).code, 0)
    assert.match(readFileSync(agent, 'utf8'), /Our own extra step/, 'the ejected file is kept')
    assert.equal(existsSync(join(cwd, '.claude/rules/packs/stack-postgres/postgres.md')), false)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('the pack rule follows the docs language, ro in ASCII; unknown packs name the closest', async () => {
  const ro = packItems('stack-postgres', withDefaults(SCHEMA, { languages: { docs: 'ro' } }))
  const rule = ro.find((i) => i.key.endsWith('postgres.md')).content
  assert.match(rule, /^# Postgres \(pachetul stack-postgres\)/)
  assert.deepEqual(findDiacritics(rule), [])
  const cwd = project()
  try { assert.match((await cli(cwd, ['add', 'stack-postgress'])).stderr, /did you mean "stack-postgres"/) } finally { rmSync(cwd, { recursive: true, force: true }) }
})
