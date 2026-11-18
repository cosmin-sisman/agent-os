// Tests for the endpoint inventory: a route missing from openapi.yaml shows as undocumented, spec operations with no
// route are listed, routes are read from each supported framework as text (nothing is imported or run), auth markers
// are seen, test files are skipped, unknown frameworks are reported, and the result goes to the cache only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { inventory, normPath } from './endpoints.mjs'
import { run } from '../cli/main.mjs'

function repo(files) {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-endpoints-'))
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(cwd, p)), { recursive: true }); writeFileSync(join(cwd, p), typeof c === 'string' ? c : JSON.stringify(c)) }
  return cwd
}

test('given a route missing from openapi.yaml, it shows as undocumented; a spec operation with no route is listed', async () => {
  const cwd = repo({
    'package.json': { dependencies: { hono: '4' } },
    'src/app.ts': "import { Hono } from 'hono'\nconst app = new Hono()\napp.get('/users/:id', requireAuth, (c) => c.json({}))\napp.post('/users', (c) => c.json({}))\n// a mistake would be to run this file: it calls process.exit\nprocess.exit(1)\n",
    'openapi.yaml': 'openapi: "3.1.0"\npaths:\n  /users/{id}:\n    get:\n      responses: {}\n  /teams:\n    get:\n      responses: {}\n',
  })
  try {
    const inv = inventory(cwd)
    assert.deepEqual(inv.endpoints.map((e) => [e.method, e.path, e.documented, e.auth, e.line]), [['POST', '/users', false, 'unknown', 4], ['GET', '/users/:id', true, 'marked', 3]])
    assert.deepEqual(inv.specOnly.map((o) => `${o.method} ${o.path}`), ['GET /teams'])
    const r = await (async () => { let out = ''; const code = await run(['system', 'endpoints', '--undocumented'], { stdout: (s) => { out += s }, stderr: () => {}, cwd, env: {} }); return { code, out } })()
    assert.equal(r.code, 0)
    assert.match(r.out, /POST +\/users +\S+ +auth \? +UNDOCUMENTED {2}src\/app\.ts:4/)
    assert.match(r.out, /in a spec but declared by no code:\n {2}GET \/teams {2}\(openapi\.yaml\)/)
    assert.ok(existsSync(join(cwd, '.agent-os/cache/endpoints.json')), 'rendered into the cache')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('routes are read from each supported framework, as text', () => {
  const cwd = repo({
    'package.json': { dependencies: { express: '4', '@nestjs/core': '10', next: '15', astro: '4' } },
    'api/server.js': "router.delete('/items/:id', authenticate, handler)\napp.all('/health', h)\n",
    'nest/users.controller.ts': "@Controller('users')\n@UseGuards(AuthGuard)\nexport class C {\n  @Get(':id')\n  one() {}\n  @Post()\n  make() {}\n}\n",
    'web/app/(shop)/orders/[id]/route.ts': 'export async function GET() {}\nexport const PATCH = () => {}\n',
    'web/pages/api/ping.ts': 'export default function handler() {}\n',
    'site/src/pages/feed.xml.ts': 'export const GET = () => new Response()\n',
    'requirements.txt': 'fastapi\ndjango\n',
    'py/main.py': '@app.get("/items/{item_id}")\nasync def read(item_id: int, user = Depends(get_current_user)):\n    pass\n',
    'py/urls.py': 'urlpatterns = [path("accounts/<int:pk>/", view)]\n',
    'config/routes.rb': 'Rails.application.routes.draw do\n  get "/status", to: "s#show"\n  resources :posts\nend\n',
    'java/Users.java': '@RequestMapping("/api/users")\npublic class Users {\n  @GetMapping("/{id}")\n  @PreAuthorize("hasRole(\'X\')")\n  public U one() {}\n}\n',
    'cs/OrdersController.cs': '[Route("api/[controller]")]\n[Authorize]\npublic class OrdersController {\n  [HttpGet("{id}")]\n  public IActionResult Get() {}\n}\napp.MapPost("/webhooks/stripe", h);\n',
    'go/main.go': 'r.Get("/v1/things", list)\nmux.HandleFunc("POST /v1/things", create)\n',
    'api/server.test.js': "app.get('/only-in-tests', h)\n",
  })
  try {
    const got = inventory(cwd).endpoints.map((e) => `${e.method} ${e.path}${e.auth === 'marked' ? ' [auth]' : ''}`).sort()
    for (const want of ['DELETE /items/:id [auth]', 'ANY /health', 'GET /users/:id [auth]', 'POST /users [auth]', 'GET /orders/[id]', 'PATCH /orders/[id]', 'ANY /api/ping', 'GET /feed.xml', 'GET /items/{item_id} [auth]', 'ANY /accounts/<int:pk>/', 'GET /status', 'DELETE /posts/:id', 'GET /api/users/{id} [auth]', 'GET /api/orders/{id} [auth]', 'POST /webhooks/stripe', 'GET /v1/things', 'POST /v1/things']) assert.ok(got.includes(want), `missing ${want} in\n${got.join('\n')}`)
    assert.equal(got.some((x) => /only-in-tests/.test(x)), false, 'test files are skipped')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('unknown frameworks are reported, not silently skipped', () => {
  const cwd = repo({ 'package.json': { dependencies: { '@remix-run/node': '2', '@sveltejs/kit': '2' } }, 'artisan': '' })
  try { assert.deepEqual(inventory(cwd).unread.sort(), ['laravel', 'remix', 'sveltekit']) } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('paths normalize across frameworks for the comparison with specs', () => {
  for (const p of ['/users/:id', '/users/{id}', '/users/<int:id>', '/users/[id]', '/users/{id}/']) assert.equal(normPath(p), '/users/{}')
})
