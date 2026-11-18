// Tests for overlap: open change requests and pushed branches touching your files, the cache keyed by head commit,
// folders, your own change request left out, and the /pr warning.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findOverlap, overlapLines, touches } from './overlap.mjs'
import { saveResult } from '../gate/gate.mjs'
import { preflight } from '../workflow/pr.mjs'
import { vocabularyFor } from '../platform/vocabulary.mjs'

const CONFIG = { branches: { integration: 'development', production: 'main' }, conventions: { types: ['feat', 'fix'], maxTitleLength: 72, exempt: [] } }
const pr = (number, branch, head = `sha${number}`, extra = {}) => ({ number, title: `change ${number}`, body: `Closes #${number + 100}`, author: `dev${number}`, branch, head, url: `u/${number}`, ...extra })
function fakeTracker(prs, files) {
  const calls = []
  return { calls, openPullRequests: () => { calls.push('list'); return prs }, pullRequestFiles: (n) => { calls.push(`files ${n}`); return files[n] ?? [] } }
}
const noBranches = () => ({ status: 0, stdout: '', stderr: '' })
const tmp = () => mkdtempSync(join(tmpdir(), 'aos-overlap-'))

test('paths overlap when equal or when one is a folder holding the other', () => {
  assert.ok(touches('src/a.ts', 'src/a.ts'))
  assert.ok(touches('src/db/', 'src/db/x.ts'))
  assert.ok(touches('src/db/x.ts', 'src/db/'))
  assert.ok(!touches('src/a.ts', 'src/ab.ts'))
  assert.ok(!touches('src/db', 'src/db/x.ts'), 'a folder is written with its trailing slash')
})

test('given another open PR touching src/a.ts, when I change src/a.ts, /pr warns and names it', () => {
  const cwd = tmp()
  try {
    saveResult(cwd, { head: 'abc', clean: true, ok: true, suites: [] })
    const tracker = fakeTracker([pr(40, 'feat/40-other'), pr(41, 'feat/41-mine')], { 40: ['src/a.ts', 'README.md'] })
    const git = (args) => {
      const k = args.join(' ')
      if (k === 'rev-parse --abbrev-ref HEAD') return { status: 0, stdout: 'feat/41-mine\n', stderr: '' }
      if (k === 'rev-parse HEAD') return { status: 0, stdout: 'abc\n', stderr: '' }
      if (k === 'diff --name-only --diff-filter=A origin/development...HEAD') return { status: 0, stdout: '.agent-os/journal/2026/11/x.md', stderr: '' }
      if (k === 'diff --name-only origin/development...HEAD') return { status: 0, stdout: 'src/a.ts\nsrc/b.ts', stderr: '' }
      return { status: 0, stdout: '', stderr: '' }
    }
    const r = preflight({ config: CONFIG, git, cwd, tracker }, { title: 'feat(a): b [#141]', body: '## Why\n\nCloses #141\n\n## How it was tested\n\nx\n\n## Lessons\n\nNone: x' })
    assert.deepEqual(r.overlaps.map((o) => [o.number, o.files]), [[40, ['src/a.ts']]])
    assert.ok(!tracker.calls.includes('files 41'), 'my own change request is left out')
    assert.equal(overlapLines(r.overlaps, vocabularyFor('github'))[0], '  #40 change 40 by @dev40 (#140): src/a.ts')
    assert.equal(r.ok, true, 'overlap warns; it never blocks')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('the files of a change request are cached by its head commit; a new push is fetched again', () => {
  const cwd = tmp()
  try {
    const prs = [pr(40, 'a'), pr(42, 'b')]
    const t = fakeTracker(prs, { 40: ['src/a.ts'], 42: ['docs/x.md'] })
    const deps = { tracker: t, git: noBranches, cwd, config: CONFIG }
    findOverlap(deps, { files: ['src/a.ts'], now: 0 })
    assert.deepEqual(t.calls, ['list', 'files 40', 'files 42'])
    t.calls.length = 0
    findOverlap(deps, { files: ['src/a.ts'], now: 60e3 })
    assert.deepEqual(t.calls, [], 'within the TTL: nothing is asked')
    prs[0] = pr(40, 'a', 'sha40-new')
    findOverlap(deps, { files: ['src/a.ts'], now: 11 * 60e3 })
    assert.deepEqual(t.calls, ['list', 'files 40'], 'after the TTL: the list again, and only the PR whose head moved')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('30 open change requests: the cached run is well under 3 seconds and makes no file calls', () => {
  const cwd = tmp()
  try {
    const prs = Array.from({ length: 30 }, (_, i) => pr(i + 1, `feat/${i + 1}-x`))
    const files = Object.fromEntries(prs.map((p) => [p.number, Array.from({ length: 40 }, (_, k) => `src/m${p.number}/f${k}.ts`)]))
    const t = fakeTracker(prs, files)
    const deps = { tracker: t, git: noBranches, cwd, config: CONFIG }
    findOverlap(deps, { files: ['src/m7/f3.ts'], now: 0 })
    t.calls.length = 0
    const start = performance.now()
    const r = findOverlap(deps, { files: ['src/m7/f3.ts', 'src/m9/'], now: 1000 })
    assert.ok(performance.now() - start < 3000)
    assert.deepEqual(t.calls, [])
    assert.deepEqual(r.overlaps.map((o) => [o.number, o.files.length]), [[9, 40], [7, 1]])
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('pushed branches without a change request are compared locally; long-lived and own branches are skipped', () => {
  const cwd = tmp()
  try {
    const git = (args) => {
      const k = args.join(' ')
      if (k.startsWith('for-each-ref')) return { status: 0, stdout: 'origin\norigin/development\norigin/main\norigin/feat/7-x\norigin/fix/8-y\norigin/feat/9-mine\norigin/feat/40-pr', stderr: '' }
      if (k === 'diff --name-only origin/development...origin/feat/7-x') return { status: 0, stdout: 'src/db/a.ts', stderr: '' }
      if (k === 'diff --name-only origin/development...origin/fix/8-y') return { status: 0, stdout: 'docs/z.md', stderr: '' }
      if (k === 'log -1 --format=%an origin/feat/7-x') return { status: 0, stdout: 'Ana', stderr: '' }
      if (k.startsWith('diff')) throw new Error(`unexpected ${k}`)
      return { status: 0, stdout: '', stderr: '' }
    }
    const r = findOverlap({ tracker: fakeTracker([pr(40, 'feat/40-pr')], { 40: [] }), git, cwd, config: CONFIG }, { files: ['src/db/'], branch: 'feat/9-mine' })
    assert.deepEqual(r.overlaps, [{ kind: 'branch', branch: 'feat/7-x', author: 'Ana', issues: [7], files: ['src/db/a.ts'] }])
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('without a platform (offline) only branches are checked; a failing list is a warning', () => {
  const cwd = tmp()
  try {
    assert.deepEqual(findOverlap({ tracker: null, git: noBranches, cwd, config: CONFIG }, { files: ['a'] }).overlaps, [])
    const broken = { openPullRequests: () => { throw new Error('HTTP 401') } }
    assert.match(findOverlap({ tracker: broken, git: noBranches, cwd, config: CONFIG }, { files: ['a'] }).warnings[0], /could not be listed: HTTP 401/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
