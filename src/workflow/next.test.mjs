// Tests for /next: the tier order of design §9, ordering inside a tier, exclusions with a note, the areas bonus and
// determinism.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { labelId, milestoneOrder, recommend, versionOf } from './next.mjs'

const CAPS = { dependencies: { value: true } }
const MILESTONES = [
  { title: 'v0.3 Knowledge', state: 'open', due_on: null },
  { title: 'v0.2 Core workflow', state: 'open', due_on: null },
  { title: 'v0.1 Foundations', state: 'closed', due_on: null },
]
const issue = (number, extra = {}) => ({ number, title: `issue ${number}`, state: 'open', url: `u/${number}`, labels: [], milestone: { title: 'v0.2 Core workflow' }, assignees: [], ...extra })

function fakeTracker({ mine = [], reviews = [], issues = [], blockers = {}, blocking = {}, closed = [], milestones = MILESTONES } = {}) {
  const t = {
    calls: [],
    warnings: [],
    whoami: () => 'me',
    pullRequests: (q) => (q.startsWith('author:') ? mine : reviews),
    openIssues: () => issues,
    milestones: () => milestones,
    blockers: (n) => { t.calls.push(['blockers', n]); return blockers[n] ?? [] },
    blocking: (n) => blocking[n] ?? [],
    recentlyClosed: () => closed,
  }
  return t
}
const noBranches = () => ({ status: 0, stdout: '', stderr: '' })
const branches = (...names) => () => ({ status: 0, stdout: names.map((n) => `origin/${n}`).join('\n'), stderr: '' })
const ranked = (r) => r.recommendations.map((p) => `${p.kind}#${p.number}`)

test('milestones are ordered by due date, then version; labels resolve in any language', () => {
  assert.deepEqual(milestoneOrder(MILESTONES).map((m) => m.title), ['v0.2 Core workflow', 'v0.3 Knowledge'])
  assert.deepEqual(milestoneOrder([{ title: 'v0.9', state: 'open', due_on: '2026-12-01T00:00:00Z' }, { title: 'v0.2', state: 'open', due_on: null }]).map((m) => m.title), ['v0.9', 'v0.2'])
  assert.deepEqual(versionOf('v1.10 Later'), [1, 10, 0])
  assert.equal(labelId('prioritate:p1'), 'priority:p1')
  assert.equal(labelId('blocat'), 'blocked')
})

test('given a PR of mine with requested changes, it comes first', () => {
  const t = fakeTracker({
    mine: [{ number: 40, title: 'ok PR', review: 'APPROVED', checks: 'SUCCESS' }, { number: 41, title: 'my PR', review: 'CHANGES_REQUESTED', checks: 'SUCCESS' }],
    reviews: [{ number: 50, title: 'their PR' }],
    issues: [issue(7, { assignees: ['me'], labels: ['priority:p0'] })],
  })
  const r = recommend({ tracker: t, caps: CAPS, git: noBranches })
  assert.deepEqual(ranked(r), ['pr#41', 'review#50', 'issue#7'])
  assert.equal(r.recommendations[0].reason, 'your PR has requested changes')
})

test('failing checks on my PR count like requested changes', () => {
  const r = recommend({ tracker: fakeTracker({ mine: [{ number: 42, title: 'x', review: null, checks: 'FAILURE' }] }), caps: CAPS, git: noBranches })
  assert.equal(r.recommendations[0].reason, 'your PR has failing checks')
})

test('my issues: in progress first, then milestone, priority and how many they unblock', () => {
  const issues = [
    issue(1, { assignees: ['me'], labels: ['priority:p2'] }),
    issue(2, { assignees: ['me'], labels: ['priority:p0'], milestone: { title: 'v0.3 Knowledge' } }),
    issue(3, { assignees: ['me'], labels: ['priority:p2'] }),
    issue(4, { assignees: ['me'], labels: ['priority:p3'] }),
  ]
  const t = fakeTracker({ issues, blocking: { 3: [{ number: 9, state: 'open' }] } })
  const r = recommend({ tracker: t, caps: CAPS, git: branches('feat/4-thing', 'chore/x') }, { limit: 4 })
  assert.deepEqual(ranked(r), ['issue#4', 'issue#3', 'issue#1', 'issue#2'])
  assert.match(r.recommendations[0].reason, /in progress \(a branch exists\)/)
  assert.equal(r.recommendations[1].reason, 'assigned to you, in v0.2 Core workflow, p2, unblocks 1')
})

test('blocked issues and issues assigned to others are left out with a note', () => {
  const issues = [
    issue(5, { assignees: ['me'] }),
    issue(6, { assignees: ['ana'] }),
    issue(8, { labels: ['blocat'] }),
    issue(10),
  ]
  const t = fakeTracker({ issues, blockers: { 5: [{ number: 2, state: 'open' }, { number: 1, state: 'closed' }] } })
  const r = recommend({ tracker: t, caps: CAPS, git: noBranches })
  assert.deepEqual(ranked(r), ['issue#10'])
  assert.deepEqual(r.excluded.map((e) => [e.number, e.reason]), [[5, 'blocked by #2'], [6, 'assigned to @ana'], [8, 'has the blocked label']])
})

test('unassigned issues come from the current milestone only, by priority, with a bonus for my recent areas', () => {
  const issues = [
    issue(20, { labels: ['priority:p1', 'area:docs'] }),
    issue(21, { labels: ['priority:p1', 'area:cli'] }),
    issue(22, { labels: ['priority:p0'] }),
    issue(23, { labels: ['priority:p0'], milestone: { title: 'v0.3 Knowledge' } }),
    issue(24, { labels: ['type:epic', 'priority:p0'] }),
  ]
  const t = fakeTracker({ issues, closed: [issue(3, { labels: ['area:cli'] })] })
  const r = recommend({ tracker: t, caps: CAPS, git: noBranches })
  assert.equal(r.currentMilestone, 'v0.2 Core workflow')
  assert.deepEqual(ranked(r), ['issue#22', 'issue#21', 'issue#20'])
  assert.equal(r.recommendations[1].reason, 'unassigned in v0.2 Core workflow, p1, in your recent areas (area:cli)')
  assert.equal(r.recommendations[0].action, 'agent-os start 22')
})

test('only as many unassigned candidates are checked for blockers as are needed', () => {
  const issues = Array.from({ length: 30 }, (_, k) => issue(100 + k))
  const t = fakeTracker({ issues })
  recommend({ tracker: t, caps: CAPS, git: noBranches })
  assert.equal(t.calls.length, 3)
})

test('without dependency links, only the blocked label excludes, with a warning', () => {
  const t = fakeTracker({ issues: [issue(30), issue(31, { labels: ['blocked'] })] })
  const r = recommend({ tracker: t, caps: {}, git: noBranches })
  assert.deepEqual(ranked(r), ['issue#30'])
  assert.equal(t.calls.length, 0)
  assert.match(r.warnings[0], /only the blocked label/)
})

test('the same state gives the same answer', () => {
  const make = () => fakeTracker({ issues: [issue(3, { labels: ['priority:p1'] }), issue(1, { labels: ['priority:p1'] }), issue(2, { labels: ['priority:p1'] })] })
  const a = recommend({ tracker: make(), caps: CAPS, git: noBranches })
  const b = recommend({ tracker: make(), caps: CAPS, git: noBranches })
  assert.deepEqual(a, b)
  assert.deepEqual(ranked(a), ['issue#1', 'issue#2', 'issue#3'])
})
