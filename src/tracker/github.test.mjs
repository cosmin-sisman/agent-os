// Tests for the GitHub tracker with a fake gh: creating complete issues, relationships, idempotency, the board and its
// missing-scope warning, dry runs, retries and reads.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GitHubTracker } from './github.mjs'
import { ghClient } from './gh.mjs'
import { createTracker } from './tracker.mjs'
import { fakeGh } from './__fixtures__/fake-gh.mjs'

const REPO = 'acme/app'
const issue = (number, extra = {}) => ({ number, id: 1000 + number, node_id: `I_${number}`, title: `issue ${number}`, state: 'open', html_url: `https://github.com/${REPO}/issues/${number}`, labels: [], assignees: [], milestone: null, ...extra })
const board = {
  repositoryOwner: { projectV2: { id: 'PVT_1', fields: { nodes: [{ id: 'F_status', name: 'Status', options: [{ id: 'O_todo', name: 'Todo' }, { id: 'O_done', name: 'Done' }] }, {}] } } },
}
const tracker = (routes, { withBoard = true } = {}) => {
  const gh = fakeGh(routes)
  return { gh, t: new GitHubTracker({ repo: REPO, board: withBoard ? { owner: 'acme', number: 3 } : undefined }, ghClient(gh, { backoffMs: 1 })) }
}

test('given an epic and a child, relate makes the child a sub-issue of the epic', () => {
  const { gh, t } = tracker({ [`GET repos/${REPO}/issues/12`]: issue(12), [`POST repos/${REPO}/issues/10/sub_issues`]: issue(12) })
  assert.deepEqual(t.setParent(12, 10), { relation: 'parent', child: 12, parent: 10, created: true })
  const post = gh.calls.find((c) => c.key === `POST repos/${REPO}/issues/10/sub_issues`)
  assert.deepEqual(post.body, { sub_issue_id: 1012 }, 'the REST id of the child, not its number')
})

test('relating twice is not an error', () => {
  const { t } = tracker({ [`GET repos/${REPO}/issues/12`]: issue(12), [`POST repos/${REPO}/issues/10/sub_issues`]: { status: 1, stderr: 'gh: Issue may not contain duplicate sub-issues (HTTP 422)' } })
  assert.equal(t.setParent(12, 10).created, false)
})

test('create sends one complete issue, then parent, blockers and board status', () => {
  const { gh, t } = tracker({
    [`GET repos/${REPO}/milestones?state=all&per_page=100`]: [{ number: 2, title: 'v0.2 Core workflow', state: 'open', open_issues: 3, closed_issues: 1 }],
    [`POST repos/${REPO}/issues`]: issue(50),
    [`POST repos/${REPO}/issues/10/sub_issues`]: {},
    [`GET repos/${REPO}/issues/3`]: issue(3),
    [`POST repos/${REPO}/issues/50/dependencies/blocked_by`]: {},
    'graphql:repositoryOwner': () => board,
    'graphql:addProjectV2ItemById': { addProjectV2ItemById: { item: { id: 'PVTI_50' } } },
    'graphql:updateProjectV2ItemFieldValue': { updateProjectV2ItemFieldValue: { clientMutationId: null } },
  })
  const r = t.create({ title: 'Login fails', body: 'b', labels: ['type:bug', 'priority:p1', 'area:auth'], milestone: 'v0.2 Core workflow', assignees: ['ana', 'dan'], parent: 10, blockedBy: [3], status: 'todo' })
  assert.equal(r.number, 50)
  assert.deepEqual(gh.calls.find((c) => c.key === `POST repos/${REPO}/issues`).body, { title: 'Login fails', body: 'b', labels: ['type:bug', 'priority:p1', 'area:auth'], assignees: ['ana', 'dan'], milestone: 2 })
  assert.deepEqual(gh.calls.find((c) => c.key.endsWith('/blocked_by')).body, { issue_id: 1003 })
  assert.deepEqual(gh.calls.find((c) => c.key === 'graphql:updateProjectV2ItemFieldValue').body.variables, { p: 'PVT_1', i: 'PVTI_50', f: 'F_status', o: 'O_todo' })
  assert.deepEqual(r.board, { number: 50, status: 'Todo' })
})

test('a missing project scope skips the board with a warning; the issue is still created and related', () => {
  const { t } = tracker({
    [`POST repos/${REPO}/issues`]: issue(51),
    'graphql:repositoryOwner': { status: 1, stderr: "gh: Your token has not been granted the required scopes to execute this query. The 'id' field requires one of the following scopes: ['read:project']" },
  })
  const r = t.create({ title: 'x', status: 'Todo' })
  assert.equal(r.number, 51)
  assert.equal(r.board.skipped, true)
  assert.match(t.warnings[0], /lacks the "project" scope \(fix: gh auth refresh -s project\)/)
})

test('without a configured board, status is skipped quietly', () => {
  const { gh, t } = tracker({ [`POST repos/${REPO}/issues`]: issue(52) }, { withBoard: false })
  assert.equal(t.create({ title: 'x', status: 'Todo' }).board.skipped, true)
  assert.equal(gh.calls.filter((c) => c.key.startsWith('graphql')).length, 0)
})

test('an unknown status value names the board options', () => {
  const { t } = tracker({ [`GET repos/${REPO}/issues/5`]: issue(5), 'graphql:repositoryOwner': board })
  assert.throws(() => t.setStatus(5, 'Blocked'), /the board has no Status "Blocked"[\s\S]*/)
})

test('dry runs describe every request and send nothing', () => {
  const { gh, t } = tracker({})
  const r = t.create({ title: 'x', labels: ['type:bug'], milestone: 'v0.2', parent: 10, blockedBy: [3, 4], status: 'Todo' }, { dryRun: true })
  assert.equal(r.dryRun, true)
  assert.deepEqual(r.requests.map((q) => q.path ?? q.graphql), [`repos/${REPO}/issues`, `repos/${REPO}/issues/10/sub_issues`, `repos/${REPO}/issues/<new>/dependencies/blocked_by`, `repos/${REPO}/issues/<new>/dependencies/blocked_by`, 'updateProjectV2ItemFieldValue'])
  for (const op of [() => t.update(1, { title: 't', addLabels: ['a'], removeLabels: ['b c'] }, { dryRun: true }), () => t.setParent(2, 1, { dryRun: true }), () => t.addBlocker(2, 1, { dryRun: true }), () => t.assign(2, ['ana'], { dryRun: true }), () => t.linkBranch(2, { branch: 'feat/2-x', base: 'development' }, { dryRun: true }), () => t.setStatus(2, 'Done', { dryRun: true })]) {
    assert.equal(op().dryRun, true)
  }
  assert.equal(gh.calls.length, 0)
})

test('update patches fields and changes labels one by one', () => {
  const { gh, t } = tracker({ [`PATCH repos/${REPO}/issues/7`]: {}, [`POST repos/${REPO}/issues/7/labels`]: [], [`DELETE repos/${REPO}/issues/7/labels/needs%20decision`]: [] })
  t.update(7, { state: 'closed', addLabels: ['blocked'], removeLabels: ['needs decision'] })
  assert.deepEqual(gh.calls.map((c) => c.key), [`PATCH repos/${REPO}/issues/7`, `POST repos/${REPO}/issues/7/labels`, `DELETE repos/${REPO}/issues/7/labels/needs%20decision`])
})

test('linkBranch uses gh issue develop with the base, and the host for Enterprise', () => {
  const gh = fakeGh({ 'issue develop': { status: 0, stdout: 'feat/9-x' } })
  new GitHubTracker({ repo: REPO, host: 'ghe.corp' }, ghClient(gh)).linkBranch(9, { branch: 'feat/9-x', base: 'development' })
  assert.deepEqual(gh.calls[0].args, ['issue', 'develop', '9', '--repo', 'ghe.corp/acme/app', '--name', 'feat/9-x', '--base', 'development'])
})

test('rate limits and temporary conflicts are retried', () => {
  const gh = fakeGh({ [`GET repos/${REPO}/issues/1`]: (_, n) => (n < 3 ? { status: 1, stderr: 'API rate limit exceeded' } : issue(1)) })
  const t = new GitHubTracker({ repo: REPO }, ghClient(gh, { backoffMs: 1 }))
  assert.equal(t.get(1).number, 1)
  assert.equal(gh.calls.length, 3)
})

test('reads: children, blockers and milestone progress', () => {
  const { t } = tracker({
    [`GET repos/${REPO}/issues/10/sub_issues?per_page=100`]: [issue(11), issue(12, { state: 'closed' })],
    [`GET repos/${REPO}/issues/13/dependencies/blocked_by?per_page=100`]: [issue(12)],
    [`GET repos/${REPO}/milestones?state=all&per_page=100`]: [{ title: 'v0.1', state: 'open', open_issues: 1, closed_issues: 12 }],
  })
  assert.deepEqual(t.children(10).map((c) => [c.number, c.state]), [[11, 'open'], [12, 'closed']])
  assert.deepEqual(t.blockers(13).map((c) => c.number), [12])
  assert.deepEqual(t.progress('v0.1'), [{ title: 'v0.1', state: 'open', open: 1, closed: 12, total: 13 }])
  assert.throws(() => t.progress('v9'), /milestone "v9" does not exist/)
})

test('the factory returns the adapter of the configured platform and needs a project', () => {
  assert.equal(createTracker({ platform: { type: 'gitlab', project: 'g/p' } }).constructor.name, 'GitLabTracker')
  assert.equal(createTracker({ platform: { type: 'github', project: 'o/r' } }).constructor.name, 'GitHubTracker')
  assert.throws(() => createTracker({ platform: { type: 'gitlab' } }), /platform\.project is not set/)
  assert.throws(() => createTracker({ platform: { type: 'github' } }), /platform\.project is not set/)
})

test('checks: the latest run of each check wins, even when the platform rollup still says FAILURE', async () => {
  const { checksOf } = await import('./github.mjs')
  const run = (name, conclusion, startedAt) => ({ __typename: 'CheckRun', name, status: 'COMPLETED', conclusion, startedAt })
  const r = checksOf({ state: 'FAILURE', contexts: { nodes: [run('ci', 'FAILURE', '2026-11-18T02:44:52Z'), run('pr-title', 'FAILURE', '2026-11-18T02:44:22Z'), run('ci', 'SUCCESS', '2026-11-18T02:46:07Z'), run('pr-title', 'SUCCESS', '2026-11-18T02:45:38Z')] } })
  assert.equal(r.overall, 'success')
  assert.deepEqual(r.all.map((c) => `${c.name}=${c.state}`), ['ci=success', 'pr-title=success'])
  assert.equal(checksOf({ state: 'FAILURE', contexts: { nodes: [run('ci', 'SUCCESS', '1'), run('ci', 'FAILURE', '2')] } }).overall, 'failure', 'a later failure still fails')
  assert.equal(checksOf(null).overall, 'none')
})
