// Tests for the system checks: a public webhook route without signature verification fails with the route, and each
// other check (spec drift, public routes without auth, an internal component deployed publicly, component and module
// cycles, deep imports, a shared database, calls without a timeout) names the component, the file and the fix.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { cycles, systemChecks } from './checks.mjs'
import { run } from '../cli/main.mjs'
import { runDoctor } from '../doctor/doctor.mjs'
import { loadConfig } from '../config/config.mjs'

function repo(files) {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-syschecks-'))
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(cwd, p)), { recursive: true }); writeFileSync(join(cwd, p), typeof c === 'string' ? c : JSON.stringify(c)) }
  return cwd
}
const BASE = {
  'package.json': { name: 'acme', private: true, workspaces: ['apps/*', 'packages/*'] },
  'apps/api/package.json': { name: 'api', dependencies: { hono: '4', db: '1' } },
  'apps/worker/package.json': { name: 'worker', dependencies: { db: '1' } },
  'packages/db/package.json': { name: 'db' },
  'apps/admin/package.json': { name: 'admin', dependencies: { next: '15' } },
}
const SYSTEM = `components:
  api:
    kind: service
    path: apps/api
    exposure: public
    consumes: [db]
    provides:
      - http: { spec: apps/api/openapi.yaml }
  worker:
    kind: worker
    path: apps/worker
    consumes: [db]
  db:
    kind: package
    path: packages/db
    provides:
      - db: { engine: postgres }
  admin:
    kind: app
    path: apps/admin
    exposure: internal
`

test('given a public webhook route without signature verification, the check fails with the route', async () => {
  const cwd = repo({ ...BASE, 'system.yaml': SYSTEM, 'apps/api/src/hooks.ts': "app.post('/webhooks/stripe', async (c) => { const event = await c.req.json(); return handle(event) })\n", 'apps/api/openapi.yaml': 'openapi: "3.1.0"\npaths:\n  /webhooks/stripe:\n    post:\n      responses: {}\n' })
  try {
    const f = systemChecks(cwd).find((x) => x.check === 'webhook-signature')
    assert.deepEqual([f.level, f.component, f.file], ['fail', 'api', 'apps/api/src/hooks.ts:1'])
    assert.match(f.message, /POST \/webhooks\/stripe accepts webhooks without verifying their signature/)
    assert.match(f.fix, /constructEvent/)
    let out = ''
    assert.equal(await run(['system', 'checks'], { stdout: (s) => { out += s }, stderr: () => {}, cwd, env: {} }), 1)
    assert.match(out, /FAIL {2}webhook-signature +api {2}apps\/api\/src\/hooks\.ts:1/)
    writeFileSync(join(cwd, 'apps/api/src/hooks.ts'), "app.post('/webhooks/stripe', async (c) => { const event = stripe.webhooks.constructEvent(await c.req.text(), c.req.header('stripe-signature'), secret); return handle(event) })\n")
    assert.equal(systemChecks(cwd).some((x) => x.check === 'webhook-signature'), false, 'a verified webhook passes')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('each other check names the component, the file and the fix', () => {
  const cwd = repo({
    ...BASE,
    'system.yaml': SYSTEM,
    'apps/api/openapi.yaml': 'openapi: "3.1.0"\npaths:\n  /users:\n    get:\n      responses: {}\n  /gone:\n    get:\n      responses: {}\n',
    'apps/api/src/routes.ts': "import { a } from './a'\napp.get('/users', requireAuth, h)\napp.get('/orders', h)\napp.get('/health', h)\nconst r = await fetch('https://pay.example/charge');\nconst ok = await fetch('https://x', { signal: AbortSignal.timeout(2000) });\n",
    'apps/api/src/a.ts': "import { b } from './b'\nexport const a = 1\n",
    'apps/api/src/b.ts': "import { a } from './a'\nimport { x } from '../../../packages/db/src/internal'\nimport { y } from 'db/src/schema'\nexport const b = 2\n",
    'packages/db/src/internal.ts': 'export const x = 1\n',
    'apps/admin/vercel.json': '{}',
    'apps/api/src/lazy.ts': "const m = () => import('./routes')\n",
  })
  try {
    const f = systemChecks(cwd)
    const by = (check) => f.filter((x) => x.check === check)
    assert.ok(f.every((x) => x.component !== undefined && x.file && x.fix), 'component, file and fix on every finding')
    assert.deepEqual(by('spec-drift').map((x) => x.message).sort(), ['GET /gone is in apps/api/openapi.yaml but no code declares it', 'GET /health is not in the spec (apps/api/openapi.yaml)', 'GET /orders is not in the spec (apps/api/openapi.yaml)'])
    assert.deepEqual(by('public-auth').map((x) => [x.component, x.message]), [['api', 'GET /orders on the public component api shows no authentication']])
    assert.deepEqual(by('exposure').map((x) => [x.level, x.component, x.file]), [['fail', 'admin', 'apps/admin/vercel.json']])
    assert.deepEqual(by('cycles').map((x) => x.message), ['modules import each other in a cycle: apps/api/src/a.ts → apps/api/src/b.ts'], 'a static cycle; the lazy import() is not one')
    assert.deepEqual(by('deep-imports').map((x) => [x.component, x.file]).sort(), [['api', 'apps/api/src/b.ts'], ['api', 'apps/api/src/b.ts']])
    assert.deepEqual(by('shared-db').map((x) => [x.component, x.message]), [['db', 'api, worker share the database db without depending on each other']])
    assert.deepEqual(by('timeouts').map((x) => [x.component, x.file, x.message]), [['api', 'apps/api/src/routes.ts:5', '1 outgoing call(s) without a timeout (fetch)']])
    const doctor = runDoctor({ cwd, config: loadConfig(cwd).merged, running: '0.0.0' }, { offline: true, only: ['system'] }).checks[0].findings
    assert.ok(doctor.some((x) => x.level === 'fail' && /admin: admin is internal/.test(x.message)), 'doctor reports them')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('component cycles fail; cycles are reported once each', () => {
  assert.deepEqual(cycles(new Map([['a', ['b']], ['b', ['c']], ['c', ['a']], ['d', []]])), ['a → b → c'])
  const cwd = repo({ 'system.yaml': 'components:\n  a: { kind: package, path: a, consumes: [b] }\n  b: { kind: package, path: b, consumes: [a] }\n' })
  try { assert.deepEqual(systemChecks(cwd).filter((x) => x.check === 'cycles').map((x) => [x.level, x.message]), [['fail', 'components depend on each other in a cycle: a → b → a']]) } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('the security pass in pr preflight warns about findings in the files the change touches', async () => {
  const { preflight } = await import('../workflow/pr.mjs')
  const { saveResult } = await import('../gate/gate.mjs')
  const cwd = repo({ ...BASE, 'system.yaml': SYSTEM, 'apps/api/src/hooks.ts': "app.post('/webhooks/stripe', h)\n" })
  try {
    saveResult(cwd, { head: 'abc1234', clean: true, ok: true, suites: [] })
    const git = (args) => {
      const k = args.join(' ')
      if (k === 'rev-parse --abbrev-ref HEAD') return { status: 0, stdout: 'feat/3-x\n', stderr: '' }
      if (k === 'rev-parse HEAD') return { status: 0, stdout: 'abc1234\n', stderr: '' }
      if (k.startsWith('diff --name-only --diff-filter=A')) return { status: 0, stdout: '.agent-os/journal/2026/11/2026-11-18T10-00-a-x.md', stderr: '' }
      if (k.startsWith('diff --name-only')) return { status: 0, stdout: 'apps/api/src/hooks.ts\n.agent-os/journal/2026/11/2026-11-18T10-00-a-x.md', stderr: '' }
      return { status: 1, stdout: '', stderr: '' }
    }
    const config = { branches: { integration: 'development', production: 'main' }, conventions: { types: ['feat'], maxTitleLength: 72, exempt: [] } }
    const r = preflight({ config, git, cwd }, { title: 'feat(api): stripe webhooks [#3]', body: '## What\n\nX.\n\n## Why\n\nCloses #3\n\n## How it was tested\n\nt\n\n## Lessons\n\nNone: x.\n' })
    assert.ok(r.warnings.some((w) => /^system webhook-signature: api: POST \/webhooks\/stripe accepts webhooks without verifying their signature \(apps\/api\/src\/hooks\.ts:1\)/.test(w)), r.warnings.join('\n'))
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
