// Tests for the requirements the stack suggests: MCP servers for providers with an mcpHint and well-known CLIs,
// proposed and never added silently; accepted ones land in agent-os.json and agent-os env then checks them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from '../cli/main.mjs'
import { proposeRequirements } from './stack-requires.mjs'
import { fakeProbe } from './__fixtures__/fake-probe.mjs'

const STACK = 'layers:\n  monitoring: { tech: sentry }\n  payments: { tech: stripe, status: evaluating }\n  data-layer: { tech: drizzle-supabase-postgres }\n  auth: { tech: supabase-auth }\n'
function project(team = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-stackreq-'))
  writeFileSync(join(cwd, 'stack.yaml'), STACK)
  writeFileSync(join(cwd, 'agent-os.json'), `${JSON.stringify(team, null, 2)}\n`)
  return cwd
}
async function cli(cwd, argv, extra = {}) {
  let stdout = ''
  let stderr = ''
  const code = await run(argv, { stdout: (s) => { stdout += s }, stderr: (s) => { stderr += s }, cwd, env: {}, ...extra })
  return { code, stdout, stderr }
}

test('given a Sentry monitoring layer, /env proposes checking for a Sentry MCP server', () => {
  const cwd = project()
  try {
    const p = proposeRequirements(cwd, { requires: {} })
    const sentry = p.find((x) => x.id === 'mcp:sentry')
    assert.deepEqual(sentry.entry, { name: 'sentry', scope: 'user', optional: true, why: 'monitoring uses Sentry' })
    assert.match(sentry.why, /never assumes it/)
    assert.ok(p.some((x) => x.id === 'cli:sentry-cli'))
    assert.equal(p.filter((x) => x.id === 'mcp:supabase').length, 1, 'one proposal per provider')
    assert.match(p.find((x) => x.id === 'mcp:supabase').why, /^data-layer, auth use Supabase/)
    assert.equal(p.some((x) => /stripe/.test(x.id)), false, 'an evaluating layer suggests nothing yet')
    assert.equal(proposeRequirements(cwd, { requires: { mcp: [{ name: 'sentry', scope: 'project' }], cli: { 'sentry-cli': '>=2' } } }).some((x) => /sentry/.test(x.id)), false, 'what is required already is not proposed')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('never adds a requirement silently: propose only lists; --accept, --accept-all or a yes adds', async () => {
  const cwd = project({ platform: { type: 'github' } })
  try {
    const listed = await cli(cwd, ['env', 'propose'])
    assert.equal(listed.code, 0)
    assert.match(listed.stdout, /proposed {2}mcp:sentry/)
    assert.match(listed.stdout, /nothing was added/)
    assert.deepEqual(JSON.parse(readFileSync(join(cwd, 'agent-os.json'), 'utf8')), { platform: { type: 'github' } })
    const declined = await cli(cwd, ['env', 'propose'], { ask: async () => 'n' })
    assert.equal(declined.code, 0)
    assert.equal(JSON.parse(readFileSync(join(cwd, 'agent-os.json'), 'utf8')).requires, undefined)
    assert.equal((await cli(cwd, ['env', 'propose', '--accept', 'mcp:sentry', '--dry-run'])).code, 0)
    assert.equal(JSON.parse(readFileSync(join(cwd, 'agent-os.json'), 'utf8')).requires, undefined, 'dry run')
    const r = await cli(cwd, ['env', 'propose', '--accept', 'mcp:sentry', '--accept', 'cli:supabase'])
    assert.match(r.stdout, /added +mcp:sentry/)
    const team = JSON.parse(readFileSync(join(cwd, 'agent-os.json'), 'utf8'))
    assert.deepEqual(team.platform, { type: 'github' }, 'the rest is kept')
    assert.deepEqual(team.requires, { mcp: [{ name: 'sentry', scope: 'user', optional: true, why: 'monitoring uses Sentry' }], cli: { supabase: '*' } })
    assert.match((await cli(cwd, ['env', 'propose', '--accept', 'mcp:nope'])).stderr, /no proposal "mcp:nope"/)
    const env = await cli(cwd, ['env'], { probe: fakeProbe({ commands: { 'claude mcp list': { stdout: 'No MCP servers configured.' } } }) })
    assert.match(env.stdout, /sentry/, `agent-os env now checks the accepted MCP server: ${env.stdout}${env.stderr}`)
    assert.match(env.stdout, /supabase/, 'and the accepted CLI')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
