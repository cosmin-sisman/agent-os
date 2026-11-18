// Tests for the CLI runner: routing, help, exit codes, --json output, flag parsing and the executable.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { run, route } from './main.mjs'
import { COMMANDS } from './registry.mjs'
import { EXIT } from './errors.mjs'

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))

/** Runs the CLI in memory and captures what it prints. */
async function cli(...argv) {
  let stdout = ''
  let stderr = ''
  const code = await run(argv, { stdout: (s) => { stdout += s }, stderr: (s) => { stderr += s }, cwd: tmpdir(), env: {} })
  return { code, stdout, stderr }
}

test('--help lists every registered command and exits 0', async () => {
  const { code, stdout } = await cli('--help')
  assert.equal(code, EXIT.OK)
  for (const c of COMMANDS) assert.match(stdout, new RegExp(`\\b${c.name}\\b`), c.name)
  assert.match(stdout, /Exit codes: 0 ok, 1 a check failed, 2 could not run/)
})

test('no arguments shows the same help', async () => {
  const { code, stdout } = await cli()
  assert.equal(code, EXIT.OK)
  assert.match(stdout, /Usage: agent-os <command>/)
})

test('an unknown command exits 2 with a did-you-mean hint', async () => {
  const { code, stderr, stdout } = await cli('doctr')
  assert.equal(code, EXIT.CANNOT_RUN)
  assert.equal(stdout, '')
  assert.match(stderr, /unknown command "doctr"/)
  assert.match(stderr, /did you mean "agent-os doctor"/)
})

test('an unknown command with no close match points to --help', async () => {
  const { code, stderr } = await cli('zzzzzzzz')
  assert.equal(code, EXIT.CANNOT_RUN)
  assert.match(stderr, /run "agent-os --help"/)
})

test('a planned command exits 2 and names its issue', async () => {
  const { code, stderr } = await cli('lessons')
  assert.equal(code, EXIT.CANNOT_RUN)
  assert.match(stderr, /"lessons" is planned/)
  assert.match(stderr, /issues\/24/)
})

test('with --json, a failing command prints one JSON object with an error field and exits 2', async () => {
  const { code, stdout, stderr } = await cli('lessons', '--json')
  assert.equal(code, EXIT.CANNOT_RUN)
  assert.equal(stderr, '')
  const out = JSON.parse(stdout)
  assert.equal(out.ok, false)
  assert.equal(out.exitCode, 2)
  assert.equal(typeof out.error.message, 'string')
  assert.match(out.error.hint, /#24/)
})

test('with --json, a successful command prints one JSON object with its result', async () => {
  const { code, stdout } = await cli('version', '--json')
  assert.equal(code, EXIT.OK)
  assert.deepEqual(JSON.parse(stdout), { ok: true, command: 'version', exitCode: 0, result: { name: pkg.name, version: pkg.version } })
})

test('--version and -v print the package version', async () => {
  for (const flag of ['--version', '-v']) {
    const { code, stdout } = await cli(flag)
    assert.equal(code, EXIT.OK)
    assert.equal(stdout.trim(), pkg.version)
  }
})

test('an unknown option exits 2 with a short message and a hint', async () => {
  const { code, stderr } = await cli('version', '--nope')
  assert.equal(code, EXIT.CANNOT_RUN)
  assert.match(stderr, /unknown option '--nope'\n/)
  assert.match(stderr, /agent-os version --help/)
})

test('<command> --help explains that command, including planned ones', async () => {
  const { code, stdout } = await cli('lessons', '--help')
  assert.equal(code, EXIT.OK)
  assert.match(stdout, /agent-os lessons: /)
  assert.match(stdout, /Status: planned \(follow #24/)
})

test('--cwd must be an existing directory', async () => {
  const { code, stderr } = await cli('version', '--cwd', 'does/not/exist')
  assert.equal(code, EXIT.CANNOT_RUN)
  assert.match(stderr, /--cwd "does\/not\/exist" is not a directory/)
})

test('--verbose writes to stderr only, so --json output stays parseable', async () => {
  const { stdout, stderr } = await cli('version', '--json', '--verbose')
  assert.doesNotThrow(() => JSON.parse(stdout))
  assert.match(stderr, /command=version/)
})

test('routing keeps global flags in any position and sends <command> --help to help', () => {
  assert.deepEqual(route(['--cwd', 'x', 'version', '--json']), { command: 'version', args: ['--cwd', 'x', '--json'] })
  assert.deepEqual(route(['stack', '--help']), { command: 'help', args: ['stack'] })
  assert.deepEqual(route([]), { command: 'help', args: [] })
})

test('the registry has unique names, and every planned command names its issue', () => {
  const names = COMMANDS.map((c) => c.name)
  assert.equal(new Set(names).size, names.length)
  for (const c of COMMANDS) {
    assert.ok(['planned', 'new', 'stable', 'deprecated'].includes(c.status), `${c.name}: status`)
    if (!c.load) assert.ok(Number.isInteger(c.issue), `${c.name}: planned without an issue`)
  }
})

test('every implemented command is its own module with a run function', async () => {
  for (const c of COMMANDS.filter((x) => x.load)) {
    const mod = await c.load()
    assert.equal(typeof mod.run, 'function', c.name)
  }
})

test('the executable runs on this OS and returns the exit code', () => {
  const bin = fileURLToPath(new URL('../../bin/agent-os.mjs', import.meta.url))
  const ok = spawnSync(process.execPath, [bin, '--version'], { encoding: 'utf8' })
  assert.equal(ok.status, 0)
  assert.equal(ok.stdout.trim(), pkg.version)
  const bad = spawnSync(process.execPath, [bin, 'nope-command'], { encoding: 'utf8' })
  assert.equal(bad.status, 2)
})
