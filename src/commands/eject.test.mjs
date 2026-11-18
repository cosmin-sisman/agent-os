// Tests for `agent-os eject` and `agent-os update --relock` from the command line.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from '../cli/main.mjs'
import { applyManaged, readLock, LOCK_FILE } from '../managed/managed.mjs'

async function cli(cwd, ...argv) {
  let stdout = ''
  let stderr = ''
  const code = await run(argv, { stdout: (s) => { stdout += s }, stderr: (s) => { stderr += s }, cwd, env: {} })
  return { code, stdout, stderr }
}

test('eject removes a path from management, with --dry-run first', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aos-eject-'))
  try {
    applyManaged(dir, [{ key: 'a.md', content: 'a\n' }], { version: '0.1.0' })
    const dry = await cli(dir, 'eject', 'a.md', '--dry-run')
    assert.match(dry.stdout, /would eject: a\.md/)
    assert.ok(readLock(dir).items['a.md'])
    assert.equal((await cli(dir, 'eject', 'a.md')).code, 0)
    assert.equal(readLock(dir).items['a.md'], undefined)
    assert.equal(readFileSync(join(dir, 'a.md'), 'utf8'), 'a\n')
    const missing = await cli(dir, 'eject', 'a.md')
    assert.equal(missing.code, 2)
    assert.match(missing.stderr, /a\.md is not managed by agent-os/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('update --relock rebuilds a broken lock; update alone points to #68', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aos-relock-'))
  try {
    applyManaged(dir, [{ key: 'a.md', content: 'a\n' }], { version: '0.1.0' })
    writeFileSync(join(dir, LOCK_FILE), '<<<<<<< ours\n')
    const r = await cli(dir, 'update', '--relock')
    assert.equal(r.code, 0)
    assert.match(r.stdout, /rebuilt \.agent-os\/lock\.json: 1 managed item/)
    assert.ok(readLock(dir).items['a.md'])
    const planned = await cli(dir, 'update')
    assert.equal(planned.code, 2)
    assert.match(planned.stderr, /issues\/68/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('update --migrate needs a pinned version and reports when nothing is pending', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aos-migrate-'))
  try {
    const none = await cli(dir, 'update', '--migrate')
    assert.equal(none.code, 2)
    assert.match(none.stderr, /does not pin a version/)
    const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
    writeFileSync(join(dir, 'agent-os.json'), JSON.stringify({ version }))
    const r = await cli(dir, 'update', '--migrate', '--dry-run')
    assert.equal(r.code, 0)
    assert.match(r.stdout, new RegExp(`no migrations between ${version.replace(/\./g, '\\.')} and`))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
