// Tests for the SessionStart context: local facts offline, platform facts when available, the budget, priorities,
// never blocking, and nothing personal in it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { budgetBytes, fitBudget, localContext, remoteContext } from './session.mjs'
import { runEvent } from './runner.mjs'

const CONFIG = { branches: { integration: 'development', production: 'main' }, contextBudgets: {}, platform: { type: 'github', project: 'acme/app' } }
const git = (branch = 'feat/30-session-context', changed = ['src/db/a.ts']) => (args) => {
  const k = args.join(' ')
  if (k === 'rev-parse --abbrev-ref HEAD') return { status: 0, stdout: `${branch}\n`, stderr: '' }
  if (k === 'diff --name-only origin/development...HEAD') return { status: 0, stdout: changed.join('\n'), stderr: '' }
  return { status: 0, stdout: '', stderr: '' }
}
function project() {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-session-'))
  mkdirSync(join(cwd, '.agent-os/lessons/active'), { recursive: true })
  mkdirSync(join(cwd, '.agent-os/lessons/inbox'), { recursive: true })
  mkdirSync(join(cwd, '.claude/skills/next'), { recursive: true })
  mkdirSync(join(cwd, '.claude/skills/start'), { recursive: true })
  writeFileSync(join(cwd, '.agent-os/lessons/active/down.md'), '---\nareas: [db]\npaths: ["src/db/**"]\nsource: "#12"\n---\n\nWrite a down migration for every up migration. Why. Example.\n')
  writeFileSync(join(cwd, '.agent-os/lessons/inbox/2026-11-18T10-00-ana-x.md'), '---\nareas: [ci]\nkeywords: [x]\nsource: "#1"\n---\n\nX.\n')
  writeFileSync(join(cwd, '.agent-os/local.json'), JSON.stringify({ languages: { chat: 'ro' }, machine: { maxWorkers: 9 }, note: 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' }))
  return cwd
}
const tracker = { whoami: () => 'ana', get: () => ({ title: 'SessionStart context', state: 'open' }), assignedIssues: () => [{ number: 30, title: 'SessionStart context' }, { number: 25, title: 'Chronicle' }], pullRequests: () => [{ number: 160, title: 'fix(setup): x' }] }

test('given no network, it injects local information only, and never blocks', async () => {
  const cwd = project()
  try {
    const handlers = [
      { name: 'session', events: ['SessionStart'], run: () => ({ lines: localContext({ config: CONFIG, cwd, git: git() }).lines }) },
      { name: 'session-remote', events: ['SessionStart'], run: () => ({ lines: remoteContext({ tracker: { whoami: () => { throw new Error('getaddrinfo ENOTFOUND api.github.com') } }, branch: 'feat/30-x' }).lines }) },
    ]
    const out = await runEvent('SessionStart', { session_id: 's1' }, { config: CONFIG, cwd, handlers })
    const text = out.hookSpecificOutput.additionalContext
    assert.equal(text, [
      'agent-os: you are on feat/30-session-context (issue #30).',
      'Lessons for the files you changed: down: Write a down migration for every up migration.',
      '1 lesson(s) wait in the inbox (/lessons review).',
      'Skills: local /next /start (agent-os skills for what each does).',
    ].join('\n'))
    assert.equal(out.systemMessage, undefined, 'an unreachable platform is not an error')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('with the platform: the issue, assignments and reviews, ahead of the local extras', async () => {
  const cwd = project()
  try {
    const lines = [...localContext({ config: CONFIG, cwd, git: git() }).lines, ...remoteContext({ tracker, branch: 'feat/30-session-context' }).lines]
    const fit = fitBudget(lines, 1536)
    assert.match(fit.text, /^agent-os: you are on feat\/30-session-context \(issue #30\)\.\n/)
    assert.match(fit.text, /Issue #30: SessionStart context \(open\)\./)
    assert.match(fit.text, /Assigned to you: #30 SessionStart context; #25 Chronicle\./)
    assert.match(fit.text, /Reviews requested from you: #160 fix\(setup\): x\./)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('never exceeds the budget: the least important lines go first', async () => {
  const lines = [{ p: 0, text: 'branch line' }, { p: 40, text: `skills ${'x'.repeat(300)}` }, { p: 10, text: `assigned ${'y'.repeat(300)}` }, { p: 30, text: 'inbox line' }]
  const fit = fitBudget(lines, 400)
  assert.ok(fit.bytes <= 400)
  assert.equal(fit.text, `branch line\nassigned ${'y'.repeat(300)}\ninbox line`)
  assert.equal(budgetBytes('1.5KB'), 1536)
  assert.equal(budgetBytes(undefined), 1536)
  const cwd = project()
  try {
    const huge = Array.from({ length: 200 }, (_, i) => ({ p: i, text: `line ${i} ${'z'.repeat(50)}` }))
    const out = await runEvent('SessionStart', {}, { config: { ...CONFIG, contextBudgets: { SessionStart: '1KB' } }, cwd, handlers: [{ name: 'big', events: ['SessionStart'], run: () => ({ lines: huge }) }] })
    assert.ok(Buffer.byteLength(out.hookSpecificOutput.additionalContext) <= 1024)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('nothing personal or secret: no values from local.json, no environment', async () => {
  const cwd = project()
  try {
    const lines = localContext({ config: CONFIG, cwd, git: git() }).lines.map((l) => l.text).join('\n')
    assert.doesNotMatch(lines, /ghp_|maxWorkers|chat|\bro\b/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('on the integration branch it points to /start and /next; outside git it says nothing about a branch', () => {
  const cwd = project()
  try {
    assert.match(localContext({ config: CONFIG, cwd, git: git('development') }).lines[0].text, /start work with \/start <issue> or ask \/next/)
    assert.ok(!localContext({ config: CONFIG, cwd, git: () => ({ status: 128, stdout: '' }) }).lines.some((l) => /you are on/.test(l.text)))
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('a context handler that times out is left out silently; the local context still arrives', async () => {
  const cwd = project()
  try {
    const handlers = [
      { name: 'session', kind: 'context', events: ['SessionStart'], run: () => ({ lines: [{ p: 0, text: 'local' }] }) },
      { name: 'session-remote', kind: 'context', events: ['SessionStart'], timeoutMs: 20, run: () => new Promise((r) => setTimeout(r, 200)) },
    ]
    const out = await runEvent('SessionStart', { session_id: 's2' }, { config: CONFIG, cwd, handlers })
    assert.equal(out.hookSpecificOutput.additionalContext, 'local')
    assert.equal(out.systemMessage, undefined)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
