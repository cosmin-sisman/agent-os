// Tests for the GitLab tracker with a fake glab: issues, epics (Premium) vs the Parent line (Free), links, scoped
// status labels, milestones, merge requests (!N), their pipeline as checks, discussions, merging and pagination.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GitLabTracker } from './gitlab.mjs'
import { glabClient } from '../platform/glab.mjs'
import { fakeGlab } from './__fixtures__/fake-glab.mjs'
import { applyActions, relationshipPlan } from './ticket.mjs'
import { ship } from '../workflow/ship.mjs'
import { vocabularyFor } from '../platform/vocabulary.mjs'

const P = 'team/app'
const ID = encodeURIComponent(P)
const G = encodeURIComponent('team')
const issue = (iid, extra = {}) => ({ id: 9000 + iid, iid, title: `issue ${iid}`, state: 'opened', web_url: `https://gitlab.example.com/${P}/-/issues/${iid}`, labels: [], assignees: [], milestone: null, description: '', ...extra })
const tracker = (routes) => {
  const glab = fakeGlab(routes)
  return { glab, t: new GitLabTracker({ project: P, host: 'gitlab.example.com' }, glabClient(glab, { host: 'gitlab.example.com', backoffMs: 1 })) }
}
/** What `issue new` does: create, then the relationship plan for the platform's capabilities. */
const createIssue = (t, caps, { parent, assignees, ...spec }) => {
  const r = t.create(spec)
  applyActions(t, relationshipPlan(caps, { number: r.number, parent, assignees }))
  return r
}
const SPEC = { title: 'Login: the session expires after five minutes', body: '## Test scenarios\n\n- [ ] Given …', labels: ['type::bug', 'priority::p1', 'area::auth'], milestone: 'v0.2 Core workflow', assignees: ['ana'], parent: 3 }
const MILESTONES = { [`GET projects/${ID}/milestones?include_ancestors=true&per_page=100&page=1`]: [{ id: 77, iid: 2, title: 'v0.2 Core workflow', state: 'active', due_date: '2026-12-01' }] }

test('reads map to the shared shape: open/closed, labels, assignees, the host flag', () => {
  const { glab, t } = tracker({ [`GET projects/${ID}/issues/5`]: issue(5, { labels: ['type::bug'], assignees: [{ id: 1, username: 'ana' }], milestone: { title: 'v0.2' } }) })
  assert.deepEqual(t.get(5), { number: 5, title: 'issue 5', state: 'open', url: `https://gitlab.example.com/${P}/-/issues/5`, labels: ['type::bug'], milestone: 'v0.2', assignees: ['ana'], isPullRequest: false })
  assert.deepEqual(glab.calls[0].args.slice(-2), ['--hostname', 'gitlab.example.com'])
})

test('given /ticket with a parent epic on Premium, the issue is attached to the epic', () => {
  const { glab, t } = tracker({
    ...MILESTONES,
    'GET users?username=ana': [{ id: 11, username: 'ana' }],
    [`POST projects/${ID}/issues`]: issue(50),
    [`POST groups/${G}/epics/3/issues/9050`]: {},
    [`PUT projects/${ID}/issues/50`]: (b) => issue(50, b),
  })
  const caps = { subItems: { value: 'epics' }, dependencies: { value: true }, multipleAssignees: { value: true } }
  const r = createIssue(t, caps, SPEC)
  assert.equal(r.number, 50)
  assert.deepEqual(glab.calls.find((c) => c.key === `POST projects/${ID}/issues`).body, { title: SPEC.title, description: SPEC.body, labels: 'type::bug,priority::p1,area::auth', milestone_id: 77 })
  assert.ok(glab.calls.some((c) => c.key === `POST groups/${G}/epics/3/issues/9050`), 'attached to &3 by the issue id')
  assert.deepEqual(glab.calls.find((c) => c.key === `PUT projects/${ID}/issues/50`).body, { assignee_ids: [11] }, 'assignees by user id')
})

test('given /ticket with a parent on Free, the issue gets a Parent line and the parent a checklist item', () => {
  const bodies = {}
  const { glab, t } = tracker({
    ...MILESTONES,
    'GET users?username=ana': [{ id: 11, username: 'ana' }],
    [`POST projects/${ID}/issues`]: issue(50),
    [`GET projects/${ID}/issues/50`]: issue(50, { description: 'body' }),
    [`GET projects/${ID}/issues/3`]: issue(3, { description: 'epic-like issue' }),
    [`PUT projects/${ID}/issues/50`]: (b) => { if ('description' in b) bodies[50] = b.description; return issue(50, b) },
    [`PUT projects/${ID}/issues/3`]: (b) => { if ('description' in b) bodies[3] = b.description; return issue(3, b) },
  })
  const caps = { subItems: { value: 'tasks' }, dependencies: { value: false }, multipleAssignees: { value: false } }
  createIssue(t, caps, SPEC)
  assert.equal(bodies[50], 'body\nParent: #3')
  assert.equal(bodies[3], 'epic-like issue\n- [ ] #50')
  assert.equal(glab.calls.some((c) => c.key.includes('/epics/')), false)
})

test('blocked-by links: created once, a repeat (409) is not an error, and blockers/blocking read the link type', () => {
  const { glab, t } = tracker({
    [`POST projects/${ID}/issues/12/links`]: (_, k) => (k === 1 ? {} : { status: 1, stderr: 'glab: 409 Conflict (HTTP 409) Issue(s) already assigned' }),
    [`GET projects/${ID}/issues/12/links`]: [{ iid: 7, title: 'a', state: 'opened', link_type: 'is_blocked_by' }, { iid: 9, title: 'b', state: 'closed', link_type: 'blocks' }, { iid: 4, title: 'c', state: 'opened', link_type: 'relates_to' }],
  })
  assert.equal(t.addBlocker(12, 7).created, true)
  assert.equal(t.addBlocker(12, 7).created, false)
  assert.deepEqual(glab.calls[0].body, { target_project_id: P, target_issue_iid: '7', link_type: 'is_blocked_by' })
  assert.deepEqual(t.blockers(12), [{ number: 7, title: 'a', state: 'open' }])
  assert.deepEqual(t.blocking(12), [{ number: 9, title: 'b', state: 'closed' }])
})

test('update closes with state_event and labels in one PUT; status is one scoped label replacing the others', () => {
  const { glab, t } = tracker({
    [`PUT projects/${ID}/issues/5`]: (b) => issue(5, { labels: ['status::in-progress'] }),
    [`GET projects/${ID}/issues/5`]: issue(5, { labels: ['type::bug', 'status::todo'] }),
  })
  t.update(5, { state: 'closed', addLabels: ['blocked'], removeLabels: ['priority::p3'] })
  assert.deepEqual(glab.calls[0].body, { state_event: 'close', add_labels: 'blocked', remove_labels: 'priority::p3' })
  t.cache.issues.clear()
  assert.deepEqual(t.setStatus(5, 'In Progress'), { number: 5, status: 'status::in-progress' })
  assert.deepEqual(glab.calls.at(-1).body, { add_labels: 'status::in-progress', remove_labels: 'status::todo' })
})

test('lists follow pages of 100 and stop at a short page', () => {
  const page = (n, count) => Array.from({ length: count }, (_, k) => issue(n * 1000 + k))
  const { glab, t } = tracker({ [`GET projects/${ID}/issues?state=opened&per_page=100&page=1`]: page(1, 100), [`GET projects/${ID}/issues?state=opened&per_page=100&page=2`]: page(2, 3) })
  assert.equal(t.openIssues().length, 103)
  assert.equal(glab.calls.length, 2)
})

test('rate limits are retried', () => {
  const { t } = tracker({ 'GET user': (_, k) => (k < 3 ? { status: 1, stderr: 'glab: 429 Too Many Requests (HTTP 429)' } : { username: 'ana' }) })
  assert.equal(t.whoami(), 'ana')
})

const mr = (extra = {}) => ({ iid: 40, title: 'feat(x): y [#4]', description: 'Closes #4\nRefs #5', author: { username: 'ana' }, target_branch: 'development', source_branch: '4-y', source_project_id: 1, target_project_id: 1, web_url: 'https://gitlab.example.com/team/app/-/merge_requests/40', state: 'opened', draft: false, has_conflicts: false, detailed_merge_status: 'mergeable', sha: 'abc123', head_pipeline: { id: 900, status: 'success' }, ...extra })
const job = (id, name, status, extra = {}) => ({ id, name, status, web_url: `j/${id}`, ...extra })

test('merge request status: the pipeline jobs are the checks, the latest retry wins, approvals give the review', () => {
  const { t } = tracker({
    [`GET projects/${ID}/merge_requests/40`]: mr(),
    [`GET projects/${ID}/merge_requests/40/approvals`]: { approved: true, approvals_required: 1, approved_by: [{ user: { username: 'dan' } }] },
    [`GET projects/${ID}/pipelines/900/jobs?per_page=100&page=1`]: [job(1, 'test', 'failed'), job(2, 'test', 'success'), job(3, 'lint', 'success'), job(4, 'deploy', 'manual', { allow_failure: true })],
  })
  const s = t.pullRequestStatus(40)
  assert.equal(s.checks, 'success')
  assert.deepEqual(s.all.map((c) => `${c.name}=${c.state}`), ['test=success', 'lint=success'])
  assert.equal(s.review, 'APPROVED')
  assert.equal(s.mergeState, 'CLEAN')
  assert.equal(s.state, 'open')
})

test('behind, conflicting and requested changes map to the shared states', () => {
  const routes = (extra) => tracker({ [`GET projects/${ID}/merge_requests/40`]: mr(extra), [`GET projects/${ID}/merge_requests/40/approvals`]: {}, [`GET projects/${ID}/pipelines/900/jobs?per_page=100&page=1`]: [] }).t.pullRequestStatus(40)
  assert.equal(routes({ detailed_merge_status: 'need_rebase' }).mergeState, 'BEHIND')
  assert.equal(routes({ has_conflicts: true }).mergeable, 'CONFLICTING')
  assert.equal(routes({ detailed_merge_status: 'requested_changes' }).review, 'CHANGES_REQUESTED')
  assert.equal(routes({ head_pipeline: null }).checks, 'none')
  assert.equal(routes({ head_pipeline: { id: 900, status: 'running' } }).checks, 'pending')
})

test('/ship on GitLab: merge !40 pinned to the sha, close #4, comment on #5, delete the branch', () => {
  const states = { 4: 'opened', 5: 'opened' }
  const { glab, t } = tracker({
    [`GET projects/${ID}/merge_requests/40`]: mr(),
    [`GET projects/${ID}/merge_requests/40/approvals`]: {},
    [`GET projects/${ID}/pipelines/900/jobs?per_page=100&page=1`]: [job(1, 'ci', 'success')],
    [`GET projects/${ID}/issues/4`]: () => issue(4, { state: states[4] }),
    [`GET projects/${ID}/issues/5`]: () => issue(5, { state: states[5] }),
    [`PUT projects/${ID}/merge_requests/40/merge`]: { state: 'merged', squash_commit_sha: 'fff' },
    [`PUT projects/${ID}/issues/4`]: (b) => { if (b.state_event === 'close') states[4] = 'closed'; return issue(4, { state: states[4] }) },
    [`POST projects/${ID}/issues/4/notes`]: { id: 1 },
    [`POST projects/${ID}/issues/5/notes`]: { id: 2 },
    [`DELETE projects/${ID}/repository/branches/4-y`]: {},
  })
  const config = { branches: { integration: 'development', production: 'main', requiredChecks: ['ci'], mergeMethod: 'squash' } }
  const r = ship({ config, tracker: t, caps: { board: { value: false } }, git: () => ({ status: 1, stdout: '', stderr: '' }), vocab: vocabularyFor('gitlab') }, { number: 40 })
  assert.equal(r.shipped, true)
  assert.deepEqual(glab.calls.find((c) => c.key.endsWith('/merge')).body, { squash: true, sha: 'abc123', squash_commit_message: 'feat(x): y [#4] (!40)' })
  assert.equal(glab.calls.find((c) => c.key === `POST projects/${ID}/issues/4/notes`).body.body, 'Shipped in MR !40.')
  assert.match(glab.calls.find((c) => c.key === `POST projects/${ID}/issues/5/notes`).body.body, /stays open/)
  assert.ok(glab.calls.some((c) => c.key === `DELETE projects/${ID}/repository/branches/4-y`))
})

test('merge requests: open, find by branch, label, threads as <iid>:<discussion>, reply and resolve', () => {
  const { glab, t } = tracker({
    [`POST projects/${ID}/merge_requests`]: mr(),
    [`GET projects/${ID}/merge_requests?state=opened&source_branch=4-y&per_page=1`]: [mr()],
    [`PUT projects/${ID}/merge_requests/40`]: {},
    [`GET projects/${ID}/merge_requests/40/discussions?per_page=100&page=1`]: [
      { id: 'd1', notes: [{ resolvable: true, resolved: false, body: 'De ce?', author: { username: 'dan' }, position: { new_path: 'src/a.js', new_line: 3 } }] },
      { id: 'd2', notes: [{ resolvable: false, system: true, body: 'added 1 commit' }] },
    ],
    [`POST projects/${ID}/merge_requests/40/discussions/d1/notes`]: {},
    [`PUT projects/${ID}/merge_requests/40/discussions/d1?resolved=true`]: {},
  })
  assert.deepEqual(t.createPullRequest({ title: 't', body: 'b', head: '4-y', base: 'development', draft: true }), { number: 40, url: mr().web_url })
  assert.equal(glab.calls[0].body.title, 'Draft: t')
  assert.equal(t.pullRequestFor('4-y').number, 40)
  t.labelChangeRequest(40, ['type::feature', 'area::auth'])
  assert.deepEqual(glab.calls.at(-1).body, { add_labels: 'type::feature,area::auth' })
  const threads = t.reviewThreads(40)
  assert.deepEqual(threads.map((x) => [x.id, x.path, x.line, x.comments[0].author]), [['40:d1', 'src/a.js', 3, 'dan']])
  t.replyToThread('40:d1', 'Pentru ca…', { resolve: true })
  assert.deepEqual(glab.calls.slice(-2).map((c) => c.key), [`POST projects/${ID}/merge_requests/40/discussions/d1/notes`, `PUT projects/${ID}/merge_requests/40/discussions/d1?resolved=true`])
  assert.throws(() => t.replyToThread('d1', 'x'), /not a GitLab thread id/)
})

test('dry runs send nothing', () => {
  const { glab, t } = tracker({})
  t.create({ ...SPEC, blockedBy: [2], status: 'Todo' }, { dryRun: true })
  t.update(5, { state: 'closed' }, { dryRun: true })
  t.mergePullRequest(40, { sha: 'a' }, { dryRun: true })
  t.deleteBranch('x', { dryRun: true })
  assert.equal(glab.calls.length, 0)
})
