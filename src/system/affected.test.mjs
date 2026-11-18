// Tests for the affected graph: a change in packages/db runs the api and worker suites and not web's, the laptop and
// CI compute the same set (whatever the file order, and from system.yaml or the workspaces alike), --all runs every
// component, and overlap names the components two changes share.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { affectedBy, componentGraph, ownerOf } from './affected.mjs'
import { runGate } from '../gate/gate.mjs'

function monorepo(extra = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-affected-'))
  const files = {
    'package.json': { name: 'acme', private: true },
    'pnpm-workspace.yaml': 'packages:\n  - "apps/*"\n  - "packages/*"\n',
    'apps/web/package.json': { name: '@acme/web', dependencies: { '@acme/ui': 'workspace:*' } },
    'apps/api/package.json': { name: '@acme/api', dependencies: { '@acme/db': 'workspace:*', hono: '4' } },
    'apps/worker/package.json': { name: '@acme/worker', dependencies: { '@acme/db': 'workspace:*' } },
    'packages/db/package.json': { name: '@acme/db' },
    'packages/ui/package.json': { name: '@acme/ui' },
    ...extra,
  }
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(cwd, p)), { recursive: true }); writeFileSync(join(cwd, p), typeof c === 'string' ? c : JSON.stringify(c)) }
  return cwd
}
const gitFor = (changed) => (args) => (args[0] === 'diff' && args[2]?.startsWith('origin/') ? { status: 0, stdout: changed.join('\n') } : { status: 0, stdout: '' })
const CONFIG = { branches: { integration: 'development' }, gate: {}, gatePaths: {}, gateAffected: { command: 'pnpm --filter ./{path} test' } }

test('given a change in packages/db, the api and worker tests run and the web tests do not', () => {
  const cwd = monorepo()
  try {
    const r = runGate({ config: CONFIG, git: gitFor(['packages/db/src/schema.ts']), cwd }, { dryRun: true })
    assert.deepEqual(r.suites.sort(), ['affected:api', 'affected:db', 'affected:worker'])
    assert.deepEqual(r.affected.changed, ['db'])
    assert.deepEqual(r.reasons['affected:api'], ['depends on db'])
    assert.equal(r.suites.some((s) => /web|ui/.test(s)), false)
    const ran = []
    const real = runGate({ config: CONFIG, git: gitFor(['packages/db/src/schema.ts']), cwd, exec: (c) => { ran.push(c); return { status: 0, output: '', durationMs: 1 } } })
    assert.deepEqual(ran.sort(), ['pnpm --filter ./apps/api test', 'pnpm --filter ./apps/worker test', 'pnpm --filter ./packages/db test'])
    assert.equal(real.ok, true)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('local and CI compute the same affected set: order-independent, from system.yaml or the workspaces alike', () => {
  const cwd = monorepo()
  try {
    const files = ['packages/ui/Button.tsx', 'packages/db/x.ts', 'README.md']
    const fromWorkspaces = affectedBy(files, componentGraph(cwd))
    assert.deepEqual(affectedBy([...files].reverse(), componentGraph(cwd)), fromWorkspaces)
    assert.deepEqual(fromWorkspaces.affected, ['api', 'db', 'ui', 'web', 'worker'])
    assert.deepEqual(fromWorkspaces.outside, ['README.md'])
    writeFileSync(join(cwd, 'system.yaml'), 'components:\n  web: { kind: app, path: apps/web, consumes: [ui] }\n  api: { kind: service, path: apps/api, consumes: [db] }\n  worker: { kind: worker, path: apps/worker, consumes: [db] }\n  db: { kind: package, path: packages/db }\n  ui: { kind: package, path: packages/ui }\n')
    const g = componentGraph(cwd)
    assert.equal(g.source, 'system.yaml')
    assert.deepEqual(affectedBy(files, g).affected, fromWorkspaces.affected)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('--all runs every component; a single package or no command leaves the gate as it was', () => {
  const cwd = monorepo()
  try {
    assert.equal(runGate({ config: CONFIG, git: gitFor([]), cwd }, { all: true, dryRun: true }).suites.length, 5)
    assert.equal(runGate({ config: { ...CONFIG, gateAffected: {} }, git: gitFor(['packages/db/x.ts']), cwd }, { dryRun: true }).affected, undefined)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
  assert.equal(ownerOf('apps/web/a/b.ts', { web: { path: 'apps/web' }, root: { path: '.' } }), 'web', 'the longest path wins over the root')
})

test('a component id or path that is not a plain value is refused before anything runs (no shell injection)', async () => {
  const { run } = await import('../cli/main.mjs')
  for (const [path, label] of [['a; touch pwned', 'a semicolon'], ['$(touch pwned)', 'a substitution'], ['`touch pwned`', 'backticks'], ['apps/my app', 'a space'], ['../outside', 'a parent path'], ['-rf', 'a leading dash']]) {
    const cwd = monorepo({ 'system.yaml': `components:\n  api: { kind: service, path: ${JSON.stringify(path)}, consumes: [db] }\n  db: { kind: package, path: packages/db }\n` })
    try {
      const ran = []
      const exec = (c) => { ran.push(c); return { status: 0, output: '', durationMs: 1 } }
      assert.throws(() => runGate({ config: CONFIG, git: gitFor(['packages/db/x.ts']), cwd, exec }), (err) => /component "api": its path .* is not safe to put in gateAffected\.command/.test(err.message) && err.code === 2, label)
      assert.deepEqual(ran, [], `${label}: nothing ran`)
      writeFileSync(join(cwd, 'agent-os.json'), JSON.stringify({ gate: {}, gateAffected: CONFIG.gateAffected }))
      let stderr = ''
      const code = await run(['gate'], { stdout: () => {}, stderr: (s) => { stderr += s }, cwd, env: {}, git: gitFor(['packages/db/x.ts']), exec })
      assert.equal(code, 2, `${label}: exit 2`)
      assert.match(stderr, /not safe/)
      assert.deepEqual(ran, [], `${label}: nothing ran from the CLI either`)
    } finally { rmSync(cwd, { recursive: true, force: true }) }
  }
})
