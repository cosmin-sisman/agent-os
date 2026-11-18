// Tests for /ship: readiness (checks, review, behind, Before merge), Closes vs Refs after the merge, and clean-up.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isSync, readiness, ship, uncheckedBeforeMerge } from './ship.mjs'
import { vocabularyFor } from '../platform/vocabulary.mjs'

const CONFIG = { branches: { integration: 'development', production: 'main', requiredChecks: ['ci'], requiredApprovals: 0, mergeMethod: 'squash' } }
const CAPS = { board: { value: true } }
const BODY = '## Why\n\nCloses #4\nRefs #5\n\n## Lessons\n\nNone: routine.\n'
const status = (over = {}) => ({ number: 160, title: 'feat(x): y [#4, #5]', body: BODY, author: 'ana', base: 'development', branch: 'feat/4-y', fork: false, state: 'open', draft: false, mergeable: 'MERGEABLE', mergeState: 'CLEAN', review: null, head: 'abc1234def', checks: 'success', failing: [], pending: [], all: [{ name: 'ci', state: 'success' }], ...over })

function fakeTracker({ s = status(), states = { 4: 'open', 5: 'open' }, closeOnMerge = [] } = {}) {
  const calls = []
  const st = { ...states }
  return {
    calls,
    warnings: [],
    pullRequestStatus: () => s,
    get: (n) => ({ number: n, state: st[n], labels: [] }),
    mergePullRequest: (n, o) => { calls.push(['merge', n, o]); for (const c of closeOnMerge) st[c] = 'closed'; return { merged: true, sha: 'fff9999' } },
    update: (n, ch) => { calls.push(['update', n, ch]); if (ch.state) st[n] = ch.state },
    comment: (n, b) => calls.push(['comment', n, b]),
    commentChangeRequest: (n, b) => calls.push(['comment', n, b]),
    setStatus: (n, v) => calls.push(['status', n, v]),
    deleteBranch: (b) => { calls.push(['deleteBranch', b]); return { deleted: true } },
  }
}
function fakeGit({ current = 'development', local = true, worktree = null } = {}) {
  const calls = []
  const git = (args) => {
    calls.push(args)
    const k = args.join(' ')
    if (k === 'worktree list --porcelain') return { status: 0, stdout: `worktree /repo\nbranch refs/heads/${current}\n${worktree ? `\nworktree ${worktree}\nbranch refs/heads/feat/4-y\n` : ''}`, stderr: '' }
    if (args[0] === 'rev-parse' && args[1] === '--verify') return { status: local ? 0 : 1, stdout: '', stderr: '' }
    if (k === 'rev-parse --abbrev-ref HEAD') return { status: 0, stdout: `${current}\n`, stderr: '' }
    return { status: 0, stdout: '', stderr: '' }
  }
  git.calls = calls
  return git
}
const sleeps = []
const run = (t, opts = {}, git = fakeGit()) => ship({ config: CONFIG, tracker: t, caps: CAPS, git, vocab: vocabularyFor('github'), sleep: (ms) => sleeps.push(ms) }, { number: 160, ...opts })

test('given a PR with Refs #5, when shipped, #4 is closed and set to Done, and #5 stays open with a comment', () => {
  const t = fakeTracker()
  const r = run(t)
  assert.equal(r.shipped, true)
  assert.deepEqual(t.calls.slice(0, 5), [
    ['merge', 160, { method: 'squash', sha: 'abc1234def', title: 'feat(x): y [#4, #5]' }],
    ['update', 4, { state: 'closed' }],
    ['comment', 4, 'Shipped in PR #160.'],
    ['status', 4, 'Done'],
    ['comment', 5, 'PR #160 is merged and is part of this issue, which stays open.'],
  ])
  assert.equal(t.calls.some((c) => c[0] === 'update' && c[1] === 5), false)
  assert.deepEqual(r.issues, [{ number: 4, action: 'closed' }, { number: 5, action: 'commented, stays open' }])
})

test('an issue closed by mistake through a Refs PR is reopened, with a comment in the issues language', () => {
  const t = fakeTracker({ closeOnMerge: [5] })
  const r = run(t, { issuesLang: 'ro' })
  assert.deepEqual(t.calls.filter((c) => c[1] === 5), [['update', 5, { state: 'open' }], ['comment', 5, 'Redeschis: PR #160 doar face referire la acest issue (Refs), deci nu e gata inca.']])
  assert.deepEqual(r.issues[1], { number: 5, action: 'reopened' })
})

test('given a referenced issue the platform closes a moment after the merge, ship reopens it and says so', () => {
  const t = fakeTracker()
  let reads = 0
  const get = t.get
  // The linked branch closes #5 on the platform's side, after ship's first look.
  t.get = (n) => { const i = get(n); if (n === 5 && t.calls.some((c) => c[0] === 'merge') && ++reads >= 3) return { ...i, state: 'closed' }; return i }
  sleeps.length = 0
  const r = run(t)
  assert.deepEqual(r.issues[1], { number: 5, action: 'reopened' })
  assert.ok(t.calls.some((c) => c[0] === 'update' && c[1] === 5 && c[2].state === 'open'))
  assert.equal(t.calls.some((c) => c[0] === 'comment' && c[1] === 5 && /stays open/.test(c[2])), false, 'no "stays open" before it was closed')
  assert.ok(sleeps.length >= 1 && sleeps.length <= 3, 'a bounded wait')
  sleeps.length = 0
  run(fakeTracker())
  assert.equal(sleeps.length, 3, 'an issue that stays open is watched at most 4 times')
  sleeps.length = 0
  run(fakeTracker({ s: status({ body: 'Closes #4\n\n## Lessons\n\nNone: x.\n' }) }))
  assert.equal(sleeps.length, 0, 'no wait without referenced issues')
})

test('given a sync pull request and mergeMethod squash, ship merges it with a merge commit', () => {
  const body = '<!-- agent-os:sync -->\n## What\n\nBrings main back.\n\n## Lessons\n\nNone: the release sync.\n'
  for (const s of [status({ branch: 'main', base: 'development', body }), status({ branch: 'release/0.2.0', base: 'development', body: 'x\n\n## Lessons\n\nNone: sync.\n' }), status({ branch: 'chore/x', base: 'development', body })]) {
    const t = fakeTracker({ s })
    run(t)
    assert.equal(t.calls.find((c) => c[0] === 'merge')[2].method, 'merge', `${s.branch}: a sync is never squashed`)
  }
  const t = fakeTracker()
  run(t)
  assert.equal(t.calls.find((c) => c[0] === 'merge')[2].method, 'squash', 'a feature still follows mergeMethod')
  assert.equal(isSync(status({ branch: 'release/0.2.0', base: 'main' }), CONFIG), false, 'a release into production is not a sync')
})

test('given a sync pull request with head main, ship deletes nothing: no delete step, no deleteBranch, no local clean-up', () => {
  const body = '<!-- agent-os:sync -->\nBrings main back.\n\n## Lessons\n\nNone: the release sync.\n'
  for (const branch of ['main', 'development', 'release/0.2.0']) {
    const base = branch === 'development' ? 'main' : 'development'
    const s = status({ branch, base, body })
    const dry = run(fakeTracker({ s }), { dryRun: true })
    assert.equal(dry.steps.some((x) => /delete/.test(x)), false, `${branch}: ${dry.steps.join(' | ')}`)
    assert.ok(dry.steps.some((x) => x.startsWith(`keep the branch ${branch}: `)), branch)
    const t = fakeTracker({ s })
    const git = fakeGit({ current: branch })
    const r = run(t, {}, git)
    assert.equal(r.shipped, true)
    assert.equal(t.calls.some((c) => c[0] === 'deleteBranch'), false, `${branch}: deleteBranch is never called`)
    assert.equal(git.calls.some((c) => c[0] === 'branch' || c[0] === 'worktree' && c[1] === 'remove'), false, `${branch}: no local branch or worktree removed`)
    assert.match(r.cleanup[0], new RegExp(`^kept ${branch.replace('/', '\\/')}: `))
  }
  const t = fakeTracker()
  run(t)
  assert.ok(t.calls.some((c) => c[0] === 'deleteBranch' && c[1] === 'feat/4-y'), 'a feature branch is still cleaned up')
})

test('an issue the platform already closed is not closed twice, but still gets the comment', () => {
  const t = fakeTracker({ states: { 4: 'closed', 5: 'open' } })
  run(t)
  assert.equal(t.calls.some((c) => c[0] === 'update' && c[1] === 4), false)
  assert.ok(t.calls.some((c) => c[0] === 'comment' && c[1] === 4))
})

test('an unchecked "Before merge" item refuses the merge', () => {
  const body = `${BODY}\n## Before merge\n\n- [x] docs updated\n- [ ] migrate staging first\n`
  assert.deepEqual(uncheckedBeforeMerge(body), ['migrate staging first'])
  const t = fakeTracker({ s: status({ body }) })
  const r = run(t)
  assert.equal(r.shipped, false)
  assert.deepEqual(r.problems, [{ owner: 'body', problem: '"Before merge" item not done: migrate staging first' }])
  assert.deepEqual(t.calls, [])
  assert.deepEqual(uncheckedBeforeMerge('## Inainte de merge\n\n- [ ] x\n', 'ro'), ['x'])
})

test('a behind or conflicting PR goes back to its author with a comment; nothing is merged', () => {
  const t = fakeTracker({ s: status({ mergeState: 'BEHIND' }) })
  const r = run(t)
  assert.equal(r.backToAuthor, true)
  assert.equal(r.notified, true)
  assert.deepEqual(t.calls, [['comment', 160, '@ana, this cannot be merged yet: it is behind development. Please update it from development and push; /ship will merge it once it is green.']])
  const quiet = fakeTracker({ s: status({ mergeable: 'CONFLICTING', mergeState: 'DIRTY' }) })
  assert.equal(run(quiet, { notify: false }).problems[0].problem, 'it conflicts with development')
  assert.deepEqual(quiet.calls, [])
})

test('failing, pending or missing checks, requested changes, missing approvals and drafts refuse', () => {
  const p = (over, config = CONFIG) => readiness(status(over), config).map((x) => x.problem)
  assert.deepEqual(p({ checks: 'failure', failing: [{ name: 'ci' }], all: [{ name: 'ci', state: 'failure' }] }), ['failing checks: ci'])
  assert.deepEqual(p({ checks: 'pending', pending: ['ci'], all: [{ name: 'ci', state: 'pending' }] }), ['checks still running: ci'])
  assert.deepEqual(p({ checks: 'none', all: [] }), ['no checks reported on its last commit', 'the required check "ci" did not run'])
  assert.deepEqual(p({ review: 'CHANGES_REQUESTED' }), ['changes are requested'])
  assert.deepEqual(p({}, { branches: { ...CONFIG.branches, requiredApprovals: 1 } }), ['it needs 1 approving review(s)'])
  assert.deepEqual(p({ draft: true }), ['it is a draft'])
  assert.deepEqual(p({ base: 'feature-x' }), ['it targets feature-x, not development or main'])
  assert.deepEqual(p({}), [])
})

test('clean-up removes the worktree first, switches away from the branch, then deletes it locally and remotely', () => {
  const t = fakeTracker()
  const git = fakeGit({ current: 'feat/4-y', worktree: '/repo/.claude/worktrees/feat-4-y' })
  const r = run(t, {}, git)
  assert.deepEqual(t.calls.find((c) => c[0] === 'deleteBranch'), ['deleteBranch', 'feat/4-y'])
  const seq = git.calls.map((c) => c.join(' ')).filter((k) => /^(worktree remove|switch|branch -D)/.test(k))
  assert.deepEqual(seq, ['worktree remove /repo/.claude/worktrees/feat-4-y', 'switch development', 'branch -D feat/4-y'])
  assert.ok(r.cleanup.includes('deleted the local branch feat/4-y'))
})

test('--keep-branch and forks keep the branch; --dry-run merges nothing', () => {
  const t = fakeTracker()
  run(t, { keepBranch: true })
  assert.equal(t.calls.some((c) => c[0] === 'deleteBranch'), false)
  const f = fakeTracker({ s: status({ fork: true }) })
  run(f)
  assert.equal(f.calls.some((c) => c[0] === 'deleteBranch'), false)
  const d = fakeTracker()
  const r = run(d, { dryRun: true })
  assert.equal(r.dryRun, true)
  assert.deepEqual(d.calls, [])
  assert.match(r.steps[0], /^merge PR #160 into development \(squash, head abc1234\)$/)
})

test('a Refs issue that was already closed (a follow-up fix) gets a follow-up comment, not "stays open", and is not reopened', () => {
  const t = fakeTracker({ states: { 4: 'open', 5: 'closed' } })
  const r = run(t)
  assert.deepEqual(t.calls.filter((c) => c[1] === 5), [['comment', 5, 'PR #160 is merged; it follows up on this issue.']])
  assert.deepEqual(r.issues[1], { number: 5, action: 'commented, already closed' })
})
