// Tests for the gate: suite selection from path globs, running every selected suite, the saved result and the table.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { changedFiles, readResult, resultsTable, runGate, selectSuites } from './gate.mjs'

const CONFIG = {
  branches: { integration: 'development', production: 'main' },
  gate: { unit: 'npm test', docs: 'npm run docs:check', db: 'npm run db:test' },
  gatePaths: { 'src/**': ['unit'], 'docs/**': ['docs'], '**/*.md': ['docs'], 'db/**': ['db', 'unit'] },
}
function fakeGit({ committed = [], local = [], untracked = [], head = 'abc1234', dirty = false } = {}) {
  const calls = []
  const git = (args) => {
    calls.push(args)
    const k = args.join(' ')
    const ok = (lines) => ({ status: 0, stdout: lines.join('\n'), stderr: '' })
    if (k === 'diff --name-only origin/development...HEAD') return ok(committed)
    if (k === 'diff --name-only HEAD') return ok(local)
    if (k === 'ls-files --others --exclude-standard') return ok(untracked)
    if (k === 'rev-parse HEAD') return ok([head])
    if (k === 'status --porcelain') return ok(dirty ? [' M x'] : [])
    return { status: 1, stdout: '', stderr: `unexpected git ${k}` }
  }
  git.calls = calls
  return git
}
const exec = (results = {}) => {
  const ran = []
  const fn = (command) => { ran.push(command); return { status: results[command] ?? 0, output: results[command] ? 'line1\nAssertionError: boom' : 'ok', durationMs: 1200 } }
  fn.ran = ran
  return fn
}

test('given a diff touching only docs, only the docs suites run', () => {
  const sel = selectSuites(CONFIG, ['docs/reference/a.md', 'README.md'])
  assert.deepEqual(sel.suites, ['docs'])
  assert.deepEqual(sel.reasons.docs, ['docs/reference/a.md', 'README.md'])
})

test('selection follows the order suites are defined in, unions the globs, and lists unmatched files', () => {
  const sel = selectSuites(CONFIG, ['db/1.sql', 'src/a.mjs', 'package.json'])
  assert.deepEqual(sel.suites, ['unit', 'db'])
  assert.deepEqual(sel.unmatched, ['package.json'])
  assert.deepEqual(selectSuites({ ...CONFIG, gatePaths: {} }, ['x']).suites, ['unit', 'docs', 'db'], 'without gatePaths every suite runs')
  assert.deepEqual(selectSuites(CONFIG, [], { all: true }).suites, ['unit', 'docs', 'db'])
  assert.deepEqual(selectSuites(CONFIG, [], { only: ['db'] }).suites, ['db'])
  assert.throws(() => selectSuites({ ...CONFIG, gatePaths: { 'x/**': ['lint'] } }, []), /unknown suite\(s\): lint/)
})

test('changed files include committed, local and untracked changes, once each', () => {
  assert.deepEqual(changedFiles(fakeGit({ committed: ['b', 'a'], local: ['a', 'c'], untracked: ['d'] }), 'development'), ['a', 'b', 'c', 'd'])
  assert.throws(() => changedFiles(() => ({ status: 128, stdout: '', stderr: '' }), 'development'), { hint: 'git fetch origin development' })
})

test('runGate runs every selected suite even after a failure, saves the result for this commit, and fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aos-gate-'))
  try {
    const x = exec({ 'npm test': 1 })
    const r = runGate({ config: CONFIG, git: fakeGit({ committed: ['db/1.sql'] }), cwd: dir, exec: x })
    assert.deepEqual(x.ran, ['npm test', 'npm run db:test'])
    assert.equal(r.ok, false)
    assert.equal(r.suites[0].tail, 'line1\nAssertionError: boom')
    const saved = readResult(dir)
    assert.equal(saved.head, 'abc1234')
    assert.equal(saved.clean, true)
    assert.equal(saved.ok, false)
    assert.match(resultsTable(r), /\| unit \| `npm test` \| \*\*failed\*\* \(exit 1\) \| 1\.2 s \|/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('--dry-run selects without running or saving', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aos-gate-'))
  try {
    const x = exec()
    const r = runGate({ config: CONFIG, git: fakeGit({ committed: ['docs/a.md'] }), cwd: dir, exec: x }, { dryRun: true })
    assert.deepEqual(r.suites, ['docs'])
    assert.deepEqual(x.ran, [])
    assert.equal(readResult(dir), null)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('no suites configured is a warning, not a crash', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aos-gate-'))
  try {
    const r = runGate({ config: { branches: CONFIG.branches, gate: {}, gatePaths: {} }, git: fakeGit(), cwd: dir, exec: exec() })
    assert.equal(r.ok, true)
    assert.match(r.warnings[0], /no gate suites are configured/)
    assert.match(resultsTable(r), /No gate suites ran/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
