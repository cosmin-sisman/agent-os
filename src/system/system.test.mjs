// Tests for the system map: detect lists workspace packages as components with their dependencies, each citing its
// evidence (pnpm, npm workspaces, Nx, Go, Cargo, Maven), reads exposure from platform files or asks, links layers from
// stack.yaml, writes a valid draft without overwriting; check validates system.yaml.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { detectSystem } from './detect.mjs'
import { validateSystem } from './system.mjs'
import { parse } from '../yaml/yaml.mjs'
import { run } from '../cli/main.mjs'

function repo(files) {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-system-'))
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(cwd, p)), { recursive: true }); writeFileSync(join(cwd, p), typeof c === 'string' ? c : JSON.stringify(c)) }
  return cwd
}
const PNPM = {
  'package.json': { name: 'acme', private: true },
  'pnpm-workspace.yaml': 'packages:\n  - "apps/*"\n  - "packages/*"\n',
  'turbo.json': '{}',
  'apps/web/package.json': { name: '@acme/web', dependencies: { '@acme/ui': 'workspace:*', '@acme/api-client': 'workspace:*', next: '15' } },
  'apps/web/vercel.json': '{}',
  'apps/api/package.json': { name: '@acme/api', dependencies: { '@acme/db': 'workspace:*', hono: '4' } },
  'packages/ui/package.json': { name: '@acme/ui', dependencies: { react: '19' } },
  'packages/db/package.json': { name: '@acme/db' },
  'packages/api-client/package.json': { name: '@acme/api-client', devDependencies: { '@acme/api': 'workspace:*' } },
  'stack.yaml': 'layers:\n  internal-api: { tech: hono-trpc, paths: ["apps/api/**"] }\n',
}
async function cli(cwd, argv) {
  let stdout = ''
  let stderr = ''
  const code = await run(argv, { stdout: (s) => { stdout += s }, stderr: (s) => { stderr += s }, cwd, env: {} })
  return { code, stdout, stderr }
}

test('given a pnpm monorepo with apps/ and packages/, detect lists each workspace package as a component with its dependencies', () => {
  const cwd = repo(PNPM)
  try {
    const d = detectSystem(cwd)
    assert.equal(d.shape, 'monorepo')
    assert.deepEqual(d.tools, ['pnpm', 'turborepo'])
    assert.deepEqual(Object.keys(d.components).sort(), ['api', 'api-client', 'db', 'ui', 'web'])
    assert.deepEqual(d.components.web.consumes, ['api-client', 'ui'])
    assert.deepEqual(d.components.api.consumes, ['db'])
    assert.deepEqual(d.components['api-client'].consumes, ['api'])
    assert.deepEqual([d.components.web.kind, d.components.api.kind, d.components.ui.kind], ['app', 'service', 'package'])
    assert.deepEqual(d.components.web.evidence, ['apps/web/package.json', 'pnpm-workspace.yaml', 'apps/web/vercel.json'])
    assert.equal(d.components.web.exposure, 'public')
    assert.equal(d.components.api.layer, 'internal-api')
    assert.ok(Object.values(d.components).every((c) => c.evidence.length), 'every item cites its evidence')
    assert.deepEqual(d.questions.map((q) => q.split(' ')[0]), ['api'], 'what cannot be read is asked')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('npm workspaces, Nx, Go workspaces, Cargo and Maven are read too', () => {
  const cases = [
    [{ 'package.json': { workspaces: ['services/*'] }, 'services/billing/package.json': { name: 'billing', dependencies: { shared: '1' } }, 'services/shared/package.json': { name: 'shared' } }, { billing: ['shared'], shared: [] }, 'npm'],
    [{ 'apps/shop/project.json': { name: 'shop', implicitDependencies: ['cart'] }, 'libs/cart/project.json': { name: 'cart' } }, { shop: ['cart'], cart: [] }, 'nx'],
    [{ 'go.work': 'go 1.22\n\nuse (\n  ./svc/orders\n  ./pkg/money\n)\n', 'svc/orders/go.mod': 'module example.com/orders\n\nrequire example.com/money v0.0.0\n', 'pkg/money/go.mod': 'module example.com/money\n' }, { orders: ['money'], money: [] }, 'go'],
    [{ 'Cargo.toml': '[workspace]\nmembers = ["crates/*"]\n', 'crates/core/Cargo.toml': '[package]\nname = "core"\n', 'crates/cli/Cargo.toml': '[package]\nname = "cli"\n[dependencies]\ncore = { path = "../core" }\n' }, { cli: ['core'], core: [] }, 'cargo'],
    [{ 'pom.xml': '<project><modules><module>api</module><module>model</module></modules></project>', 'api/pom.xml': '<project><artifactId>api</artifactId><dependencies><dependency><artifactId>model</artifactId></dependency></dependencies></project>', 'model/pom.xml': '<project><artifactId>model</artifactId></project>' }, { api: ['model'], model: [] }, 'maven'],
  ]
  for (const [files, edges, tool] of cases) {
    const cwd = repo(files)
    try {
      const d = detectSystem(cwd)
      assert.ok(d.tools.includes(tool), tool)
      assert.deepEqual(Object.fromEntries(Object.entries(d.components).map(([id, c]) => [id, c.consumes])), edges, tool)
    } finally { rmSync(cwd, { recursive: true, force: true }) }
  }
})

test('detect --write drafts a valid system.yaml with evidence and questions, and never overwrites it', async () => {
  const cwd = repo(PNPM)
  try {
    const r = await cli(cwd, ['system', 'detect', '--write'])
    assert.equal(r.code, 0, r.stderr)
    assert.match(r.stdout, /to answer[\s\S]*api \(apps\/api\): is it public, internal or private\?/)
    const text = readFileSync(join(cwd, 'system.yaml'), 'utf8')
    assert.match(text, /web:\n {4}# evidence: apps\/web\/package\.json, pnpm-workspace\.yaml, apps\/web\/vercel\.json\n {4}kind: app/)
    assert.match(text, /# exposure: public \| internal \| private {2}\(not detected: please fill in\)/)
    assert.deepEqual(validateSystem(parse(text)).problems, [])
    assert.equal((await cli(cwd, ['system', 'check'])).code, 0)
    assert.match((await cli(cwd, ['system', 'detect', '--write'])).stderr, /never overwrites/)
    assert.match((await cli(cwd, ['system', 'show'])).stdout, /web +app +apps\/web +public +→ api-client, ui/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('check: kinds, exposure, edges to unknown components, interfaces and repos, with the closest match', () => {
  const v = validateSystem({ components: { web: { kind: 'ap', path: 'apps/web', exposure: 'open', consumes: ['apii', 'web'] }, api: { kind: 'service', provides: [{ http: {} }, { rest: {} }] }, billing: { kind: 'service', repo: 'not a repo' }, stripe: { kind: 'external' } }, extra: 1 }, { layers: ['data-layer'] })
  const p = v.problems.join('\n')
  assert.match(p, /unknown key "extra"/)
  assert.match(p, /components\.web\.kind must be one of app, service, worker, package, external \(did you mean "app"\?\)/)
  assert.match(p, /components\.web\.exposure must be one of public, internal, private/)
  assert.match(p, /components\.web\.consumes "apii", which is not a component \(did you mean "api"\?\)/)
  assert.match(p, /components\.web consumes itself/)
  assert.match(p, /components\.api needs a path/)
  assert.match(p, /unknown interface "rest"/)
  assert.match(p, /components\.billing\.repo must be owner\/name/)
  assert.doesNotMatch(p, /stripe/, 'an external component needs no path')
})
