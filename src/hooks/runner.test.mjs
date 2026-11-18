// Tests for the hooks runner: guard decisions, adoption mode, isolation of failing handlers, the hook JSON format,
// the settings block, and the real executable through bash, zsh and PowerShell where they exist.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runEvent, settingsHooks, inAdoption, CORE_HANDLERS } from './runner.mjs'
import { withDefaults } from '../config/config.mjs'
import { SCHEMA } from '../config/schema.mjs'
import { run } from '../cli/main.mjs'

const config = (over = {}) => withDefaults(SCHEMA, over)
const bash = (command, extra = {}) => ({ session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, ...extra })
const tmp = () => mkdtempSync(join(tmpdir(), 'aos-hooks-'))

test('a guard refusal becomes a PreToolUse deny with the reason', async () => {
  const dir = tmp()
  try {
    const out = await runEvent('PreToolUse', bash('git commit --no-verify'), { config: config(), cwd: dir })
    assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse')
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny')
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /agent-os guard "no-verify"/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('in adoption mode, a guard that would refuse warns and allows', async () => {
  const dir = tmp()
  try {
    const cfg = config({ adoption: { warnOnlyUntil: '2026-12-31' } })
    const out = await runEvent('PreToolUse', bash('git commit --no-verify'), { config: cfg, cwd: dir, now: new Date('2026-11-18') })
    assert.equal(out.hookSpecificOutput, undefined)
    assert.match(out.systemMessage, /no-verify[\s\S]*adoption mode until 2026-12-31: allowed this time/)
    const after = await runEvent('PreToolUse', bash('git commit --no-verify'), { config: cfg, cwd: dir, now: new Date('2027-01-01') })
    assert.equal(after.hookSpecificOutput.permissionDecision, 'deny')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('inAdoption compares dates by day', () => {
  assert.equal(inAdoption({ adoption: { warnOnlyUntil: '2026-11-19' } }, new Date('2026-11-18T23:00:00Z')), true)
  assert.equal(inAdoption({ adoption: { warnOnlyUntil: '2026-11-18' } }, new Date('2026-11-18T10:00:00Z')), false)
  assert.equal(inAdoption({}), false)
})

test('a crashing handler is reported once per session and skipped; the others still run', async () => {
  const dir = tmp()
  const handlers = [
    { name: 'broken', events: ['Stop'], kind: 'reminder', run() { throw new Error('boom') } },
    { name: 'ok', events: ['Stop'], kind: 'reminder', run: () => ({ message: 'remember the journal entry' }) },
  ]
  try {
    const first = await runEvent('Stop', { session_id: 'a' }, { config: config(), cwd: dir, handlers })
    assert.match(first.systemMessage, /"broken" hook failed and was skipped \(boom\)/)
    assert.match(first.systemMessage, /remember the journal entry/)
    const second = await runEvent('Stop', { session_id: 'a' }, { config: config(), cwd: dir, handlers })
    assert.doesNotMatch(second.systemMessage, /broken/)
    const otherSession = await runEvent('Stop', { session_id: 'b' }, { config: config(), cwd: dir, handlers })
    assert.match(otherSession.systemMessage, /broken/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a handler that hangs is cut off by its timeout', async () => {
  const dir = tmp()
  const handlers = [{ name: 'slow', events: ['Stop'], kind: 'reminder', timeoutMs: 50, run: () => new Promise(() => {}) }]
  try {
    const out = await runEvent('Stop', { session_id: 'x' }, { config: config(), cwd: dir, handlers })
    assert.match(out.systemMessage, /"slow" hook failed and was skipped \(timed out after 50 ms\)/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('only guards can refuse; anything else that says deny is a warning', async () => {
  const dir = tmp()
  const handlers = [{ name: 'reminder', events: ['PreToolUse'], kind: 'reminder', run: () => ({ decision: 'deny', message: 'just a reminder' }) }]
  try {
    const out = await runEvent('PreToolUse', bash('ls'), { config: config(), cwd: dir, handlers })
    assert.equal(out.hookSpecificOutput, undefined)
    assert.equal(out.systemMessage, 'just a reminder')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('SessionStart context is added; unknown events and other tools produce nothing', async () => {
  const dir = tmp()
  const handlers = [{ name: 'ctx', events: ['SessionStart'], kind: 'context', run: () => ({ context: 'You are on #8.' }) }]
  try {
    assert.deepEqual(await runEvent('SessionStart', {}, { config: config(), cwd: dir, handlers }), { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'You are on #8.' } })
    assert.equal(await runEvent('Notification', {}, { config: config(), cwd: dir }), null)
    assert.equal(await runEvent('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: 'x' } }, { config: config(), cwd: dir }), null)
    assert.ok(CORE_HANDLERS.every((h) => h.events.length))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('the settings block calls the runner per event with no shell syntax', () => {
  const hooks = settingsHooks('agent-os')
  assert.deepEqual(Object.keys(hooks), ['SessionStart', 'PreToolUse', 'PostToolUse', 'Stop'])
  assert.equal(hooks.PreToolUse[0].matcher, 'Bash|PowerShell|Edit|Write|MultiEdit|NotebookEdit', 'guards on commands, the branch reminder on edits')
  for (const [event, [entry]] of Object.entries(hooks)) {
    const { command } = entry.hooks[0]
    assert.equal(command, `agent-os hook ${event}`)
    assert.doesNotMatch(command, /[&|;$`<>[\]]/, 'no shell-specific syntax')
  }
})

test('the hook command always exits 0, also with bad stdin or an invalid configuration', async () => {
  const dir = tmp()
  const call = async (stdin) => {
    let stdout = ''
    const code = await run(['hook', 'PreToolUse'], { stdout: (s) => { stdout += s }, stderr() {}, cwd: dir, env: {}, readStdin: async () => stdin })
    return { code, stdout }
  }
  try {
    assert.deepEqual(await call('not json'), { code: 0, stdout: '' })
    assert.match((await call(JSON.stringify(bash('git commit --no-verify')))).stdout, /"permissionDecision":"deny"/)
    writeFileSync(join(dir, 'agent-os.json'), '{"languages":{"chat":"ro"}}')
    const bad = await call(JSON.stringify(bash('ls')))
    assert.equal(bad.code, 0)
    assert.match(JSON.parse(bad.stdout).systemMessage, /hooks skipped, the configuration is invalid/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

const bin = fileURLToPath(new URL('../../bin/agent-os.mjs', import.meta.url))
const shells = [
  ['bash', (cmd) => ['-c', cmd]],
  ['zsh', (cmd) => ['-c', cmd]],
  ['pwsh', (cmd) => ['-NoProfile', '-NonInteractive', '-Command', `$input | & ${cmd}`]],
]
const available = (shell) => spawnSync(shell, shell === 'pwsh' ? ['-NoProfile', '-Command', 'exit 0'] : ['-c', 'exit 0'], { stdio: 'ignore' }).status === 0

for (const [shell, args] of shells) {
  test(`the hook command works from ${shell}`, { skip: !available(shell) && `${shell} is not installed here` }, () => {
    const dir = tmp()
    try {
      const q = (p) => `'${p.replace(/'/g, "''")}'`
      const cmd = shell === 'pwsh' ? `${q(process.execPath)} ${q(bin)} hook PreToolUse --cwd ${q(dir)}` : `"${process.execPath}" "${bin}" hook PreToolUse --cwd "${dir}"`
      const r = spawnSync(shell, args(cmd), { input: JSON.stringify(bash('git commit --no-verify -m x')), encoding: 'utf8' })
      assert.equal(r.status, 0, r.stderr)
      assert.equal(JSON.parse(r.stdout.trim()).hookSpecificOutput.permissionDecision, 'deny')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
}

test('an edit on the integration or production branch gets a reminder to claim the issue, never a refusal', async () => {
  const cwd = tmp()
  try {
    spawnSync('git', ['init', '-q', '-b', 'development'], { cwd })
    const handlers = CORE_HANDLERS.filter((h) => h.name === 'branch-reminder')
    const edit = { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: join(cwd, 'a.md') } }
    const out = await runEvent('PreToolUse', edit, { config: config(), cwd, handlers })
    assert.equal(out.hookSpecificOutput.permissionDecision, undefined, 'never a deny')
    assert.match(out.hookSpecificOutput.additionalContext, /you are on development, the integration branch\. Claim the issue first \(agent-os start <n>\)/)
    assert.equal(await runEvent('PreToolUse', { ...edit, tool_name: 'Read' }, { config: config(), cwd, handlers }), null, 'only edits')
    spawnSync('git', ['checkout', '-q', '-b', 'feat/7-x'], { cwd })
    assert.equal(await runEvent('PreToolUse', edit, { config: config(), cwd, handlers }), null, 'silent on a work branch')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
