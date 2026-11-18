// Tests for migrations: version order, idempotency, dry runs, failures, the lock record, and the harness that runs
// every real migration in migrations/ twice against its fixture project.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync, cpSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { compareVersions, listMigrations, pendingMigrations, runMigrations, projectApi, MIGRATIONS_DIR } from './runner.mjs'
import { readLock } from '../managed/managed.mjs'

const FIX = fileURLToPath(new URL('./__fixtures__/migrations', import.meta.url))
function project() {
  const dir = mkdtempSync(join(tmpdir(), 'aos-mig-'))
  mkdirSync(join(dir, '.agent-os'))
  writeFileSync(join(dir, '.agent-os/local.json'), JSON.stringify({ machine: { workers: 2 } }))
  writeFileSync(join(dir, 'agent-os.json'), JSON.stringify({ version: '0.1.0' }))
  return dir
}

test('versions compare numerically, pre-releases before their release', () => {
  assert.deepEqual(['0.10.0', '0.9.0', '0.2.0', '1.0.0-beta.1', '1.0.0'].sort(compareVersions), ['0.2.0', '0.9.0', '0.10.0', '1.0.0-beta.1', '1.0.0'])
  assert.deepEqual(listMigrations(FIX), ['0.2.0', '0.3.0', '0.9.0', '0.10.0'])
  assert.deepEqual(pendingMigrations('0.2.0', '0.9.0', listMigrations(FIX)), ['0.3.0', '0.9.0'])
})

test('given a project two minors behind, both migrations run in order and later ones do not', async () => {
  const dir = project()
  try {
    const r = await runMigrations(dir, { from: '0.1.0', to: '0.3.0', dir: FIX })
    assert.deepEqual(r.map((x) => x.version), ['0.2.0', '0.3.0'])
    assert.deepEqual(JSON.parse(readFileSync(join(dir, '.agent-os/local.json'), 'utf8')), { machine: { maxWorkers: 2 } })
    assert.match(readFileSync(join(dir, 'agent-os.json'), 'utf8'), /\$schema/)
    assert.equal(readFileSync(join(dir, '.order'), 'utf8'), '0.3.0\n')
    assert.deepEqual(readLock(dir).migrations, ['0.2.0', '0.3.0'])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('running a migration twice changes nothing', async () => {
  const dir = project()
  try {
    for (const v of listMigrations(FIX)) {
      const mod = await import(pathToFileURL(join(FIX, `${v}.mjs`)).href)
      await mod.migrate(projectApi(dir))
      const second = projectApi(dir)
      await mod.migrate(second)
      assert.deepEqual(second.changes, [], `${v} changed something on its second run`)
    }
    const again = await runMigrations(dir, { from: '0.1.0', to: '0.10.0', dir: FIX })
    assert.ok(again.every((r) => r.changes.length === 0))
    assert.deepEqual(await runMigrations(dir, { from: '0.1.0', to: '0.10.0', dir: FIX }), [], 'recorded in the lock, so skipped')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('versions run in numeric order: 0.9.0 before 0.10.0', async () => {
  const dir = project()
  try {
    await runMigrations(dir, { from: '0.1.0', to: '0.10.0', dir: FIX })
    assert.equal(readFileSync(join(dir, '.order'), 'utf8'), '0.3.0\n0.9.0\n0.10.0\n')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a dry run reports the changes and writes nothing', async () => {
  const dir = project()
  try {
    const r = await runMigrations(dir, { from: '0.1.0', to: '0.3.0', dir: FIX, dryRun: true })
    assert.deepEqual(r.map((x) => x.changes), [['update .agent-os/local.json'], ['update agent-os.json', 'create .order']])
    assert.equal(existsSync(join(dir, '.order')), false)
    assert.deepEqual(readLock(dir).migrations, [])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a failing migration stops the chain; the earlier ones stay recorded and a rerun continues', async () => {
  const dir = project()
  try {
    writeFileSync(join(dir, '.fail-0.9.0'), '')
    await assert.rejects(runMigrations(dir, { from: '0.1.0', to: '0.10.0', dir: FIX }), (err) => /migration 0\.9\.0 failed: the marker asked me to fail/.test(err.message) && /continues from 0\.9\.0/.test(err.hint))
    assert.deepEqual(readLock(dir).migrations, ['0.2.0', '0.3.0'])
    rmSync(join(dir, '.fail-0.9.0'))
    assert.deepEqual((await runMigrations(dir, { from: '0.1.0', to: '0.10.0', dir: FIX })).map((r) => r.version), ['0.9.0', '0.10.0'])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('every real migration has a fixture project and is idempotent on it', async () => {
  for (const v of listMigrations(MIGRATIONS_DIR)) {
    const fixture = join(MIGRATIONS_DIR, '__fixtures__', v)
    assert.ok(existsSync(fixture), `migrations/__fixtures__/${v}/ is missing: add a project from before ${v}`)
    const dir = mkdtempSync(join(tmpdir(), `aos-real-${v}-`))
    try {
      cpSync(fixture, dir, { recursive: true })
      const mod = await import(pathToFileURL(join(MIGRATIONS_DIR, `${v}.mjs`)).href)
      assert.equal(typeof mod.description, 'string', `${v}: export a one-line description`)
      await mod.migrate(projectApi(dir))
      const second = projectApi(dir)
      await mod.migrate(second)
      assert.deepEqual(second.changes, [], `${v} is not idempotent`)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }
  assert.ok(readdirSync(MIGRATIONS_DIR).includes('README.md'))
})
