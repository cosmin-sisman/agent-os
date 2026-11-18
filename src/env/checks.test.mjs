// Tests for the environment checks, with a fake machine: repo-side declarations and secrets, variables, MCP servers,
// tool versions, platform scopes, and the fix commands.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { checkEnvironment, checkRepo, literalSecrets, isLiteralSecret, parseMcpList, parseScopes, addCommand } from './checks.mjs'
import { withDefaults } from '../config/config.mjs'
import { SCHEMA } from '../config/schema.mjs'
import { fakeProbe } from './__fixtures__/fake-probe.mjs'

const config = (requires, extra = {}) => withDefaults(SCHEMA, { requires, ...extra })

const fails = (r) => r.findings.filter((f) => f.level === 'fail')

test('a missing project server is a failure with the exact claude mcp add command', () => {
  const req = { name: 'postgres', scope: 'project', transport: 'http', url: 'https://mcp.example.com/pg' }
  const [f] = checkRepo(config({ mcp: [req] }), { cwd: '/repo', probe: fakeProbe() })
  assert.equal(f.level, 'fail')
  assert.equal(f.fix, 'claude mcp add --scope project --transport http postgres https://mcp.example.com/pg')
  assert.equal(addCommand({ name: 'fs', scope: 'user', command: 'npx -y @mcp/fs' }), 'claude mcp add --scope user fs -- npx -y @mcp/fs')
})

test('a declared server with the wrong transport fails; the right one is ok', () => {
  const files = { '.mcp.json': JSON.stringify({ mcpServers: { pg: { command: 'npx', args: ['pg-mcp'] }, docs: { type: 'http', url: 'https://x' } } }) }
  const r = checkRepo(config({ mcp: [{ name: 'pg', scope: 'project', transport: 'http' }, { name: 'docs', scope: 'project', transport: 'http' }] }), { cwd: '/repo', probe: fakeProbe({ files }) })
  assert.match(r[0].message, /"pg" uses stdio, the project expects http/)
  assert.equal(r[1].level, 'ok')
})

test('an optional server that is missing is a warning, not a failure', () => {
  const r = checkEnvironment(config({ mcp: [{ name: 'figma', scope: 'user', optional: true }] }), { cwd: '/repo', probe: fakeProbe({ commands: { 'claude mcp list': { stdout: 'other: https://x - ✔ Connected' } } }) })
  assert.deepEqual(r.findings.filter((f) => f.message.includes('figma')).map((f) => f.level), ['warn'])
  assert.ok(!fails(r).some((f) => f.message.includes('figma')))
})

test('literal secrets in .mcp.json fail and name the key, never the value', () => {
  const token = 'ghp_FAKEFAKEFAKEFAKEFAKEFAKE1234'
  const mcp = { mcpServers: {
    github: { command: 'npx', env: { GITHUB_TOKEN: token, OK_TOKEN: '${GITHUB_TOKEN}', LOG_LEVEL: 'debug' } },
    api: { type: 'http', url: 'https://api', headers: { Authorization: 'Bearer abc123secret', 'X-Ok': 'Bearer ${API_TOKEN}' } },
    args: { command: 'tool', args: ['--key', 'sk-ant-FAKEFAKEFAKEFAKEFAKE00'] },
  } }
  assert.deepEqual(literalSecrets(mcp), ['mcpServers.github.env.GITHUB_TOKEN', 'mcpServers.api.headers.Authorization', 'mcpServers.args.args[1]'])
  const r = checkRepo(config({}), { cwd: '/repo', probe: fakeProbe({ files: { '.mcp.json': JSON.stringify(mcp) } }) })
  assert.equal(r.length, 3)
  for (const f of r) {
    assert.equal(f.level, 'fail')
    assert.match(f.message, /holds a literal secret \(value not shown\)/)
    assert.doesNotMatch(JSON.stringify(f), /FAKE|abc123secret/)
  }
  assert.match(r[0].fix, /"\$\{GITHUB_TOKEN\}"[\s\S]*rotate/)
})

test('placeholders and ordinary values are not secrets', () => {
  for (const [k, v] of [['GITHUB_TOKEN', '${GITHUB_TOKEN}'], ['Authorization', 'Bearer ${X}'], ['TOKEN', '$TOKEN'], ['TOKEN', '${T:-}'], ['LOG_LEVEL', 'info'], ['author', ''], ['url', 'https://example.com']]) assert.equal(isLiteralSecret(k, v), false, `${k}=${v}`)
  for (const [k, v] of [['API_KEY', 'abc'], ['x', 'glpat-ABCDEFGHIJKLMNOPQRSTUV'], ['x', 'AKIAABCDEFGHIJKLMNOP']]) assert.equal(isLiteralSecret(k, v), true, k)
})

test('variables are reported present or missing by name only', () => {
  const r = checkEnvironment(config({ env: ['DATABASE_URL', 'MISSING_ONE'] }), { cwd: '/repo', probe: fakeProbe({ env: ['DATABASE_URL'] }), mode: 'fast' })
  assert.deepEqual(r.findings.map((f) => [f.level, f.message]), [['ok', 'DATABASE_URL is set'], ['fail', 'MISSING_ONE is not set (value never shown)']])
})

test('a missing project scope fails with gh auth refresh -s project', () => {
  const status = { stdout: 'github.com\n  ✓ Logged in to github.com account dev\n  - Token: gho_************\n  - Token scopes: \'gist\', \'read:org\', \'repo\'\n' }
  const r = checkEnvironment(config({ platformScopes: ['repo', 'project'] }), { cwd: '/repo', probe: fakeProbe({ commands: { 'gh auth status --hostname github.com': status } }) })
  const f = fails(r)[0]
  assert.match(f.message, /gh auth \(github\.com\): the token lacks project \(has: gist, read:org, repo\)/)
  assert.equal(f.fix, 'gh auth refresh -h github.com -s project')
})

test('platform login, GitLab self-managed hosts, and unreadable scopes', () => {
  const notLogged = checkEnvironment(config({}), { cwd: '/repo', probe: fakeProbe({ commands: { gh: { status: 1, stderr: 'You are not logged into any GitHub hosts.' } } }) })
  assert.equal(fails(notLogged)[0].fix, 'gh auth login --hostname github.com')
  const gl = config({ platformScopes: ['api'] }, { platform: { type: 'gitlab', host: 'https://git.company.internal' } })
  const probe = fakeProbe({ commands: { 'glab auth status --hostname git.company.internal': { stdout: '✓ Logged in to git.company.internal as dev' } } })
  const r = checkEnvironment(gl, { cwd: '/repo', probe })
  assert.ok(probe.calls.includes('glab auth status --hostname git.company.internal'))
  assert.match(r.findings[0].message, /glab auth \(git\.company\.internal\): logged in, but its token scopes cannot be read/)
  assert.equal(r.findings[0].level, 'warn')
})

test('tool versions are checked against their ranges', () => {
  const probe = fakeProbe({ commands: { 'node --version': { stdout: 'v22.11.0' }, 'gh --version': { stdout: 'gh version 2.46.0 (2024-03-26)' } } })
  const r = checkEnvironment(config({ cli: { node: '>=22', gh: '>=2.60', docker: '*' } }), { cwd: '/repo', probe })
  const by = Object.fromEntries(r.findings.filter((f) => f.side === 'laptop' && !f.message.startsWith('gh auth')).map((f) => [f.message.split(' ')[0], f]))
  assert.equal(by.node.level, 'ok')
  assert.equal(by.gh.level, 'fail')
  assert.match(by.gh.message, /gh 2\.46\.0 is installed, the project needs >=2\.60/)
  assert.match(by.docker.message, /docker is not installed/)
})

test('MCP list parsing understands connected, needs-auth and failed servers, names with spaces included', () => {
  const list = 'Checking MCP server health…\n\nclaude.ai Docs: https://x/mcp - ✔ Connected\npg: npx pg-mcp - ✗ Failed to connect\nlinear: https://mcp.linear.app/sse - ! Needs authentication\n'
  assert.deepEqual(parseMcpList(list), { 'claude.ai Docs': 'connected', pg: 'failed', linear: 'needs-auth' })
  assert.deepEqual(parseScopes("  - Token scopes: 'repo', 'workflow'"), ['repo', 'workflow'])
  assert.equal(parseScopes('no scopes line'), null)
})

test('modes: ci checks only the repository, fast runs no command, full runs everything', () => {
  const cfg = config({ mcp: [{ name: 'x', scope: 'user' }], cli: { node: '*' }, env: ['A'] })
  const fast = fakeProbe()
  assert.deepEqual(checkEnvironment(cfg, { cwd: '/r', probe: fast, mode: 'fast' }).findings.map((f) => f.side), ['laptop'])
  assert.equal(fast.calls.length, 0)
  assert.deepEqual(checkEnvironment(cfg, { cwd: '/r', probe: fakeProbe(), mode: 'ci' }).findings, [])
  const full = fakeProbe()
  checkEnvironment(cfg, { cwd: '/r', probe: full, mode: 'full' })
  assert.deepEqual(full.calls, ['gh auth status --hostname github.com', 'node --version', 'claude mcp list'])
})
