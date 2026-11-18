// Tests for the system pages: a new spec gets its docs page in the artifact index, every page is self-contained,
// spec text is only ever escaped (a <script> or javascript: link in a description stays inert), the system map is an
// inline SVG of components and edges, and a spec can be drafted from the code.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { apiPage, draftSpec, systemMapPage } from './docs.mjs'
import { run } from '../cli/main.mjs'

function repo(files) {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-docs-'))
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(cwd, p)), { recursive: true }); writeFileSync(join(cwd, p), typeof c === 'string' ? c : JSON.stringify(c)) }
  return cwd
}
const SPEC = { openapi: '3.1.0', info: { title: 'Billing', version: '2.0.0' }, paths: { '/invoices/{id}': { get: { summary: 'One invoice', parameters: [{ in: 'path', name: 'id', required: true }], responses: { 200: { content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string' }, total: { type: 'number', description: 'In cents' } } } } } } } } } } }
const SYSTEM = 'components:\n  web: { kind: app, path: apps/web, exposure: public, consumes: [billing] }\n  billing:\n    kind: service\n    path: apps/billing\n    exposure: internal\n    consumes: [db]\n    provides:\n      - http: { spec: apps/billing/openapi.json }\n  db: { kind: package, path: packages/db }\n'
const selfContained = (html) => assert.doesNotMatch(html, /<script|<link |<iframe|https?:\/\/|url\((?!#)|@import/, 'no scripts, styles, fonts or calls from elsewhere (url(#…) is an in-page SVG reference)')

async function cli(cwd, argv) {
  let stdout = ''
  let stderr = ''
  const code = await run(argv, { stdout: (s) => { stdout += s }, stderr: (s) => { stderr += s }, cwd, env: {} })
  return { code, stdout, stderr }
}

test('given a new spec, its docs page appears in the artifact index, next to the system map', async () => {
  const cwd = repo({ 'system.yaml': SYSTEM, 'apps/billing/openapi.json': SPEC })
  try {
    const r = await cli(cwd, ['artifact', 'site', '_site'])
    assert.equal(r.code, 0, r.stderr)
    const index = readFileSync(join(cwd, '_site/index.html'), 'utf8')
    assert.match(index, /<h2>System <small>2<\/small><\/h2>[\s\S]*href="system-map\/">System map[\s\S]*href="api\/billing\/">billing API/)
    const api = readFileSync(join(cwd, '_site/api/billing/index.html'), 'utf8')
    assert.match(api, /<span class="m get">get<\/span> <span class="path">\/invoices\/\{id\}<\/span> <span class="muted">One invoice<\/span>/)
    assert.match(api, /<code>total<\/code><\/td><td>number<\/td><td>In cents/)
    selfContained(api)
    selfContained(index)
    const map = readFileSync(join(cwd, '_site/system-map/index.html'), 'utf8')
    selfContained(map.replace('xmlns="http://www.w3.org/2000/svg"', ''))
    assert.match(map, /<svg [^>]*role="img"/)
    for (const part of ['<title>web consumes billing</title>', '<title>billing consumes db</title>', 'font-weight="600" fill="#161a22">web</text>', '>service · internal</text>']) assert.ok(map.includes(part), part)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('spec text is only ever escaped: a <script> or a javascript: link in a description stays inert', () => {
  const evil = { openapi: '3.1.0', info: { title: '<img src=x onerror=alert(1)>' }, paths: { '/x"><script>alert(1)</script>': { get: { summary: '<script>alert(2)</script>', description: '[click](javascript:alert(3)) <a href="javascript:alert(4)">x</a>', parameters: [{ in: 'query', name: '<b onmouseover=alert(5)>' }], responses: {} } } } }
  const html = apiPage(JSON.stringify(evil), 'openapi.json')
  // Handlers can only run on a tag: the text may still read "onerror=" once escaped, but no tag from the spec survives.
  assert.doesNotMatch(html, /<script|<img|<a |<b /i, 'no tag from the spec survives')
  assert.doesNotMatch(html, /<[^>]*\son\w+=/i, 'no element carries an event handler')
  assert.doesNotMatch(html, /href="javascript:/i, 'no javascript: link')
  assert.match(html, /&lt;script&gt;alert\(2\)&lt;\/script&gt;/, 'shown as text')
  const svg = systemMapPage({ components: { '<svg/onload=alert(1)>': { kind: 'app', exposure: 'public' } } })
  assert.doesNotMatch(svg, /<svg\/onload/)
})

test('a spec is drafted from the routes the code declares, and never replaces one', async () => {
  const cwd = repo({ 'package.json': { name: 'acme', workspaces: ['apps/*'] }, 'apps/api/package.json': { name: 'api', dependencies: { hono: '4' } }, 'apps/api/src/app.ts': "app.get('/users/:id', h)\napp.post('/users', h)\n" })
  try {
    const d = draftSpec(cwd, 'api')
    assert.deepEqual(Object.keys(d.paths).sort(), ['/users', '/users/{id}'])
    assert.deepEqual(d.paths['/users/{id}'].get.parameters, [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }])
    assert.match(d.paths['/users'].post.summary, /from apps\/api\/src\/app\.ts:2/)
    assert.equal((await cli(cwd, ['system', 'spec', 'api', '--write-to', 'apps/api/openapi.json'])).code, 0)
    assert.ok(existsSync(join(cwd, 'apps/api/openapi.json')))
    assert.match((await cli(cwd, ['system', 'spec', 'api', '--write-to', 'apps/api/openapi.json'])).stderr, /never replaces a spec/)
    assert.match((await cli(cwd, ['system', 'spec', 'nope'])).stderr, /no routes found for nope/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('without system.yaml the site has no system section', async () => {
  const cwd = repo({ 'README.md': 'x' })
  try {
    await cli(cwd, ['artifact', 'site', '_site'])
    assert.doesNotMatch(readFileSync(join(cwd, '_site/index.html'), 'utf8'), /<h2>System/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
