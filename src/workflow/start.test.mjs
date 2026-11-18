// Tests for /start: who may start an issue, the branch name and its base, the steps in order, dry runs and fallbacks.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { branchFor, slugFor, startIssue, typeOf } from './start.mjs'

const CONFIG = { branches: { integration: 'development', production: 'main' } }
const CAPS = { linkedBranches: { value: true }, board: { value: true } }

function fakeTracker({ issue = {}, me = 'me', children = [] } = {}) {
  const calls = []
  const t = {
    calls,
    warnings: [],
    get: (n) => ({ number: n, title: 'Workflow: /start claims an issue', state: 'open', labels: ['type:feature'], assignees: [], isPullRequest: false, ...issue }),
    whoami: () => me,
    children: () => children,
    assign: (n, logins) => calls.push(['assign', n, logins]),
    linkBranch: (n, opts) => calls.push(['linkBranch', n, opts]),
    setStatus: (n, v) => calls.push(['setStatus', n, v]),
  }
  return t
}
function fakeGit() {
  const calls = []
  const git = (args) => { calls.push(args); return { status: 0, stdout: '', stderr: '' } }
  git.calls = calls
  return git
}
const start = (tracker, options, { caps = CAPS, git = fakeGit() } = {}) => ({ r: startIssue({ tracker, caps, config: CONFIG, git, cwd: '.' }, { number: 14, ...options }), git })

test('branch names come from the type label, in either language, and a short ASCII slug', () => {
  assert.equal(typeOf(['area:skills', 'tip:bug']), 'bug')
  assert.equal(slugFor('Workflow: /start claims an issue and branches'), 'start-claims-issue-branches')
  assert.equal(slugFor('Sesiune: pornire rapida si sigura'), 'pornire-rapida-si-sigura')
  assert.equal(branchFor({ number: 7, title: 'Login fails', labels: ['type:bug'] }), 'fix/7-login-fails')
  assert.equal(branchFor({ number: 7, title: 'Login fails', labels: [] }), 'chore/7-login-fails')
  assert.equal(branchFor({ number: 7, title: 'Login fails', labels: ['type:bug'] }, { hotfix: true }), 'hotfix/7-login-fails')
  assert.throws(() => branchFor({ number: 1, title: 'Epic', labels: ['type:epic'] }), /is an epic; start one of its sub-issues/)
})

test('given an unassigned issue, start assigns me, links the branch from development, checks it out and moves it to In Progress', () => {
  const t = fakeTracker()
  const { r, git } = start(t, {})
  assert.equal(r.started, true)
  assert.equal(r.branch, 'feat/14-start-claims-issue')
  assert.equal(r.base, 'development')
  assert.deepEqual(t.calls, [['assign', 14, ['me']], ['linkBranch', 14, { branch: 'feat/14-start-claims-issue', base: 'development' }], ['setStatus', 14, 'In Progress']])
  assert.deepEqual(git.calls, [['fetch', 'origin', 'feat/14-start-claims-issue'], ['switch', 'feat/14-start-claims-issue']], 'no worktree by default')
  assert.equal(r.worktree, null)
})

test('given an issue assigned to someone else, start stops and suggests a comment, and changes nothing', () => {
  const t = fakeTracker({ issue: { assignees: ['ana'] } })
  const { r, git } = start(t, {})
  assert.equal(r.started, false)
  assert.equal(r.reason, 'assigned')
  assert.match(r.message, /assigned to @ana\. Ask in its comments/)
  assert.deepEqual(t.calls, [])
  assert.deepEqual(git.calls, [])
})

test('--force takes over an issue assigned to someone else, adding me', () => {
  const t = fakeTracker({ issue: { assignees: ['ana'] } })
  const { r } = start(t, { force: true })
  assert.equal(r.started, true)
  assert.deepEqual(t.calls[0], ['assign', 14, ['me']])
})

test('an issue already assigned to me is not assigned again', () => {
  const t = fakeTracker({ issue: { assignees: ['me'] } })
  start(t, {})
  assert.equal(t.calls.some((c) => c[0] === 'assign'), false)
})

test('--hotfix cuts a hotfix branch from production', () => {
  const t = fakeTracker({ issue: { labels: ['type:bug'] } })
  const { r } = start(t, { hotfix: true })
  assert.equal(r.base, 'main')
  assert.match(r.branch, /^hotfix\/14-/)
  assert.deepEqual(t.calls[1], ['linkBranch', 14, { branch: r.branch, base: 'main' }])
})

test('an issue with open sub-issues is done in parts: start points at them', () => {
  const t = fakeTracker({ children: [{ number: 20, state: 'open' }, { number: 21, state: 'closed' }] })
  const { r } = start(t, {})
  assert.equal(r.reason, 'parts')
  assert.match(r.message, /#20\)/)
  assert.deepEqual(t.calls, [])
})

test('pull requests and closed issues are refused', () => {
  assert.throws(() => start(fakeTracker({ issue: { isPullRequest: true } }), {}), /is a pull request/)
  assert.throws(() => start(fakeTracker({ issue: { state: 'closed' } }), {}), /is closed/)
})

test('--dry-run lists the steps and calls nothing that writes', () => {
  const t = fakeTracker()
  const { r, git } = start(t, { dryRun: true })
  assert.equal(r.dryRun, true)
  assert.equal(r.started, false)
  assert.equal(r.steps.length, 5, "assign, link, fetch, switch, status")
  assert.deepEqual(t.calls, [])
  assert.deepEqual(git.calls, [])
})

test('--worktree checks the branch out in .claude/worktrees instead of switching', () => {
  const { r, git } = start(fakeTracker(), { worktree: true })
  assert.match(r.worktree, /^\.claude[\\/]worktrees[\\/]feat-14-start-claims-issue$/)
  assert.deepEqual(git.calls.at(-1), ['worktree', 'add', r.worktree, 'feat/14-start-claims-issue'])
  assert.equal(git.calls.some((c) => c[0] === 'switch'), false)
})

test('without linked branches or a board, the branch is created locally and the board step is skipped', () => {
  const t = fakeTracker()
  const { r, git } = start(t, {}, { caps: { linkedBranches: { value: false } } })
  assert.equal(r.started, true)
  assert.deepEqual(t.calls, [['assign', 14, ['me']]])
  assert.deepEqual(git.calls, [['fetch', 'origin', 'development'], ['branch', 'feat/14-start-claims-issue', 'origin/development'], ['switch', 'feat/14-start-claims-issue']])
  assert.match(r.steps[1], /Closes #14/)
})

test('a failing git step stops with the first line of its error', () => {
  const git = () => ({ status: 128, stdout: '', stderr: "fatal: couldn't find remote ref feat/14\nmore" })
  assert.throws(() => start(fakeTracker(), {}, { git }), /git fetch origin feat\/14-start-claims-issue failed: fatal: couldn't find remote ref feat\/14$/)
})
