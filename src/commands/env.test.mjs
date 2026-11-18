// Tests for `agent-os env` end to end: exit codes, modes, --json, and that no secret value ever reaches any output.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from '../cli/main.mjs'
import { runEvent } from '../hooks/runner.mjs'
import { loadConfig } from '../config/config.mjs'
import { fakeProbe } from '../env/__fixtures__/fake-probe.mjs'

const FAKE_TOKEN = 'ghp_ZZTESTTOKENZZTESTTOKENZZ9999'
const FAKE_ENV_VALUE = 'postgres://user:Sup3rSecretPw@db/prod'

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'aos-env-'))
  writeFileSync(join(dir, 'agent-os.json'), JSON.stringify({ requires: {
    mcp: [{ name: 'github', scope: 'project', transport: 'stdio', command: 'npx -y github-mcp' }, { name: 'figma', scope: 'user', optional: true }],
    env: ['DATABASE_URL', 'NOT_SET_VAR'], platformScopes: ['repo', 'project'], cli: { node: '>=22' },
  } }))
  writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { github: { command: 'npx', args: ['-y', 'github-mcp'], env: { GITHUB_TOKEN: FAKE_TOKEN } } } }))
  return dir
}

/** A machine whose gh output and environment contain real-looking secrets. */
const machine = () => fakeProbe({
  env: ['DATABASE_URL'],
  commands: {
    'gh auth status --hostname github.com': { stdout: `github.com\n  ✓ Logged in to github.com account dev\n  - Token: ${FAKE_TOKEN}\n  - Token scopes: 'repo'\n` },
    'node --version': { stdout: 'v22.11.0' },
    'claude mcp list': { stdout: `github: npx -y github-mcp (GITHUB_TOKEN=${FAKE_TOKEN}) - ✔ Connected\n` },
  },
})

async function cli(cwd, argv, probe) {
  let stdout = ''
  let stderr = ''
  const code = await run(argv, { stdout: (s) => { stdout += s }, stderr: (s) => { stderr += s }, cwd, env: { DATABASE_URL: FAKE_ENV_VALUE }, probe })
  return { code, stdout, stderr }
}

test('no token or secret value appears in stdout, stderr or --json, in any mode', async () => {
  const dir = repo()
  try {
    for (const argv of [['env'], ['env', '--json'], ['env', '--fast'], ['env', '--ci', '--json'], ['env', '--verbose']]) {
      const { stdout, stderr } = await cli(dir, argv, machine())
      for (const secret of [FAKE_TOKEN, 'ZZTESTTOKEN', FAKE_ENV_VALUE, 'Sup3rSecretPw']) {
        assert.ok(!stdout.includes(secret), `${argv.join(' ')}: stdout leaks ${secret}`)
        assert.ok(!stderr.includes(secret), `${argv.join(' ')}: stderr leaks ${secret}`)
      }
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('the SessionStart reminder does not leak secrets either', async () => {
  const dir = repo()
  try {
    const out = await runEvent('SessionStart', { session_id: 's' }, { config: loadConfig(dir).merged, cwd: dir, env: { DATABASE_URL: FAKE_ENV_VALUE } })
    const text = JSON.stringify(out)
    assert.match(text, /literal secret/)
    assert.ok(!text.includes(FAKE_TOKEN) && !text.includes(FAKE_ENV_VALUE))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('with a literal token in .mcp.json, the CI check fails and names the key, not the value', async () => {
  const dir = repo()
  try {
    const r = await cli(dir, ['env', '--ci', '--json'], machine())
    assert.equal(r.code, 1)
    const { result } = JSON.parse(r.stdout)
    assert.equal(result.mode, 'ci')
    assert.deepEqual(result.findings.map((f) => [f.level, f.message]), [
      ['ok', '.mcp.json declares "github" (stdio)'],
      ['fail', '.mcp.json: mcpServers.github.env.GITHUB_TOKEN holds a literal secret (value not shown)'],
    ])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('the full check reports the missing scope and variable with their fixes, and exits 1', async () => {
  const dir = repo()
  try {
    const r = await cli(dir, ['env'], machine())
    assert.equal(r.code, 1)
    assert.match(r.stdout, /FAIL {2}laptop {2}gh auth \(github\.com\): the token lacks project \(has: repo\)\n {16}fix: gh auth refresh -h github\.com -s project/)
    assert.match(r.stdout, /FAIL {2}laptop {2}NOT_SET_VAR is not set \(value never shown\)/)
    assert.match(r.stdout, /warn {2}laptop {2}MCP server "figma" is not installed/)
    assert.match(r.stdout, /full check: 3 failing, 1 warning\(s\), 4 ok/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a project without requirements has nothing to check and exits 0', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aos-env-empty-'))
  try {
    const r = await cli(dir, ['env', '--fast'], fakeProbe())
    assert.equal(r.code, 0)
    assert.match(r.stdout, /nothing to check/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('the fast check on the real machine takes well under a second', async () => {
  const dir = repo()
  try {
    const started = performance.now()
    await cli(dir, ['env', '--fast'])
    assert.ok(performance.now() - started < 1000)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
