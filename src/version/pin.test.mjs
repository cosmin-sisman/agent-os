// Tests for the pinned version: hook commands are always pinned, mismatches are reported with their fix, and the
// SessionStart reminder warns once.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hookCommand, versionStatus, runningVersion, PACKAGE } from './pin.mjs'
import { planInstall } from '../managed/install.mjs'
import { runEvent } from '../hooks/runner.mjs'
import { withDefaults } from '../config/config.mjs'
import { SCHEMA } from '../config/schema.mjs'
import { run } from '../cli/main.mjs'

const config = (over = {}) => withDefaults(SCHEMA, over)
function project({ spec, installed } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'aos-pin-'))
  if (spec) writeFileSync(join(dir, 'package.json'), JSON.stringify({ devDependencies: { [PACKAGE]: spec } }))
  if (installed) {
    mkdirSync(join(dir, 'node_modules', PACKAGE), { recursive: true })
    writeFileSync(join(dir, 'node_modules', PACKAGE, 'package.json'), JSON.stringify({ version: installed }))
  }
  return dir
}

test('without a devDependency, hooks call npx with the exact pinned version', () => {
  assert.equal(hookCommand(config({ version: '0.4.2' })), `npx -y ${PACKAGE}@0.4.2`)
  assert.equal(hookCommand(config({})), `npx -y ${PACKAGE}@${runningVersion()}`, 'no pin yet: the running version, still exact')
})

test('with an exact devDependency, hooks use the project install; a range falls back to npx with the pin', () => {
  const exact = project({ spec: '0.4.2' })
  const range = project({ spec: '^0.4.0' })
  try {
    assert.equal(hookCommand(config({ version: '0.4.2' }), { cwd: exact }), 'npx --no-install agent-os')
    assert.equal(hookCommand(config({ version: '0.4.2' }), { cwd: range }), `npx -y ${PACKAGE}@0.4.2`)
  } finally { rmSync(exact, { recursive: true, force: true }); rmSync(range, { recursive: true, force: true }) }
})

test('no hook the installer writes runs an unpinned version', () => {
  const dir = project()
  try {
    for (const cfg of [config({ version: '0.4.2' }), config({})]) {
      const item = planInstall(cfg, { cwd: dir }).items.find((i) => i.key === '.claude/settings.json#hooks')
      const commands = Object.values(JSON.parse(item.content)).flatMap((groups) => groups.flatMap((g) => g.hooks.map((h) => h.command)))
      assert.equal(commands.length, 4)
      for (const c of commands) assert.match(c, new RegExp(`^npx -y ${PACKAGE.replace('/', '\\/')}@\\d+\\.\\d+\\.\\d+ hook \\w+$`), c)
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('given a teammate on 0.4.1 and a pin of 0.4.2, the status names both and the fix', () => {
  const s = versionStatus(config({ version: '0.4.2' }), { cwd: project(), running: '0.4.1' })
  assert.equal(s.ok, false)
  assert.deepEqual(s.problems.map((p) => p.message), ['agent-os 0.4.1 is running, the project pins 0.4.2'])
  assert.match(s.problems[0].fix, /npx -y @cosmin-sisman\/agent-os@0\.4\.2/)
  const dev = project({ spec: '0.4.2' })
  try { assert.equal(versionStatus(config({ version: '0.4.2' }), { cwd: dev, running: '0.4.1' }).problems[0].fix, `npm install -D ${PACKAGE}@0.4.2`) } finally { rmSync(dev, { recursive: true, force: true }) }
})

test('ranges, a stale node_modules and a missing pin are reported', () => {
  const range = project({ spec: '^0.4.0' })
  const stale = project({ spec: '0.4.2', installed: '0.4.0' })
  try {
    assert.match(versionStatus(config({ version: '0.4.2' }), { cwd: range, running: '0.4.2' }).problems[0].fix, /npm install -D -E/)
    assert.deepEqual(versionStatus(config({ version: '0.4.2' }), { cwd: stale, running: '0.4.2' }).problems.map((p) => p.fix), ['npm ci'])
    assert.match(versionStatus(config({}), { cwd: project(), running: '0.4.2' }).problems[0].fix, /agent-os config set version 0\.4\.2/)
    assert.equal(versionStatus(config({ version: '0.4.2' }), { cwd: project({ spec: '0.4.2', installed: '0.4.2' }), running: '0.4.2' }).ok, true)
  } finally { rmSync(range, { recursive: true, force: true }); rmSync(stale, { recursive: true, force: true }) }
})

test('SessionStart warns once about a version mismatch, with the fix', async () => {
  const dir = project()
  try {
    const out = await runEvent('SessionStart', { session_id: 's' }, { config: config({ version: '9.9.9' }), cwd: dir })
    const matches = out.systemMessage.match(/is running, the project pins 9\.9\.9/g) ?? []
    assert.equal(matches.length, 1)
    assert.match(out.systemMessage, /fix: run agent-os as npx -y @cosmin-sisman\/agent-os@9\.9\.9/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('version --check exits 1 on a mismatch and 0 when it matches', async () => {
  const dir = project()
  const cli = async () => {
    let stdout = ''
    const code = await run(['version', '--check'], { stdout: (s) => { stdout += s }, stderr() {}, cwd: dir, env: {} })
    return { code, stdout }
  }
  try {
    writeFileSync(join(dir, 'agent-os.json'), JSON.stringify({ version: '9.9.9' }))
    const bad = await cli()
    assert.equal(bad.code, 1)
    assert.match(bad.stdout, /pins 9\.9\.9\n {2}fix:/)
    writeFileSync(join(dir, 'agent-os.json'), JSON.stringify({ version: runningVersion() }))
    assert.equal((await cli()).code, 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
