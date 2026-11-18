// Tests for retrofit, on a fake tracker and a fake git only: given 200 closed PRs the plan changes none of them and
// writes a baseline journal; the plan maps labels, creates milestones from tags, links merged PRs on issues and
// normalizes open PRs; applying twice changes nothing the second time; writes are rate-limited and marked.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyRetrofit, MARKER, planRetrofit } from './retrofit.mjs'
import { withDefaults } from '../config/config.mjs'
import { SCHEMA } from '../config/schema.mjs'
import { readJournal } from '../journal/journal.mjs'
import { run } from '../cli/main.mjs'

const config = withDefaults(SCHEMA, { platform: { type: 'github', project: 'acme/app' } })

/** A fake tracker that holds state, so a second apply sees what the first one did. */
function fakeTracker({ prs, issues, labels, milestones = [] }) {
  const writes = []
  const state = { prs: structuredClone(prs), issues: structuredClone(issues), labels: [...labels], milestones: structuredClone(milestones), comments: {} }
  return {
    writes,
    state,
    labels: () => state.labels,
    allIssues: () => structuredClone(state.issues),
    allPullRequests: () => structuredClone(state.prs),
    milestones: () => state.milestones,
    comments: (n) => state.comments[n] ?? [],
    update: (n, { addLabels }) => { writes.push(['label', n, addLabels]); const i = state.issues.find((x) => x.number === n); i.labels.push(...addLabels) },
    comment: (n, body) => { writes.push(['comment', n]); (state.comments[n] ??= []).push({ author: 'bot', body }) },
    createMilestone: ({ title }) => { writes.push(['milestone', title]); const m = { number: state.milestones.length + 1, title, state: 'open' }; state.milestones.push(m); return m },
    updateMilestone: (n, { state: st }) => { writes.push(['milestone-state', n, st]); state.milestones.find((m) => m.number === n).state = st },
    updatePullRequest: (n, change) => { writes.push(['pr', n, Object.keys(change)]); Object.assign(state.prs.find((p) => p.number === n), change) },
  }
}
const git = (args) => (args[0] === 'for-each-ref' ? { status: 0, stdout: 'v1.0.0|2025-03-01\nv1.1.0|2025-06-01\nnightly|2025-07-01\n' } : { status: 1, stdout: '' })
const closedPrs = (n) => Array.from({ length: n }, (_, i) => ({ number: i + 1, title: i % 3 ? `Fix thing ${i}` : `whatever ${i}`, body: i % 10 === 0 ? 'Fixes #900' : '', state: 'closed', merged: i % 4 !== 0, mergedAt: i % 4 !== 0 ? '2025-05-01T00:00:00Z' : null, createdAt: '2025-01-01T00:00:00Z', labels: [], author: 'ana' }))

test('given 200 closed PRs, the plan changes none of them and writes a baseline journal', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-retrofit-'))
  try {
    const t = fakeTracker({ prs: closedPrs(200), issues: [{ number: 900, title: 'x', state: 'closed', labels: [] }], labels: [] })
    const plan = planRetrofit({ tracker: t, git, config })
    assert.equal(plan.counts.closed, 200)
    assert.equal(plan.steps.some((s) => s.kind === 'pr-title' || s.kind === 'pr-body'), false, 'no step rewrites a closed PR')
    const journal = plan.steps.find((s) => s.kind === 'journal')
    assert.match(journal.body, /^200 change request\(s\) before agent-os: 150 merged, 50 closed without merging, 0 open/)
    assert.match(journal.body, /- … and 50 more/)
    const r = await applyRetrofit({ tracker: t, cwd, config, setupLabels: () => {}, sleep: async () => {}, author: 'ana' }, plan)
    assert.equal(t.writes.some((w) => w[0] === 'pr'), false, 'no closed PR was touched')
    assert.ok(r.applied.some((a) => a.id === 'journal'))
    assert.equal(readJournal(cwd).filter((e) => e.title === 'Baseline: the history before agent-os').length, 1)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

const REPO = () => fakeTracker({
  prs: [
    { number: 10, title: 'Add login', body: 'Closes #1', state: 'closed', merged: true, mergedAt: '2025-05-02T00:00:00Z', createdAt: '2025-05-01T00:00:00Z', labels: [], author: 'ana' },
    { number: 11, title: 'Add login', body: '## What\n\nX', state: 'closed', merged: false, createdAt: '2025-05-03T00:00:00Z', labels: [], author: 'dan' },
    { number: 13, title: 'WIP stuff', body: '', state: 'open', merged: false, createdAt: '2025-06-02T00:00:00Z', labels: [], author: 'dan' },
    { number: 12, title: 'feat(billing): New billing page.', body: 'Refs #2', state: 'open', merged: false, createdAt: '2025-06-01T00:00:00Z', labels: [], author: 'ana' },
  ],
  issues: [{ number: 1, title: 'Login', state: 'closed', labels: ['enhancement'] }, { number: 2, title: 'Billing', state: 'open', labels: ['bug', 'type:bug'] }, { number: 3, title: 'Docs', state: 'open', labels: ['documentation'] }],
  labels: ['enhancement', 'bug', 'documentation', 'type:bug'],
  milestones: [{ number: 1, title: 'v1.0.0', state: 'closed' }],
})

test('the plan maps labels, creates milestones from tags, links merged PRs on issues, and normalizes only open PRs', () => {
  const plan = planRetrofit({ tracker: REPO(), git, config })
  const by = (kind) => plan.steps.filter((s) => s.kind === kind)
  assert.ok(by('labels')[0].create.includes('type:feature'))
  assert.deepEqual(by('label-map').map((s) => [s.from, s.to, s.issues]).sort(), [['documentation', 'type:docs', [3]], ['enhancement', 'type:feature', [1]]], 'bug is already mapped on #2')
  assert.deepEqual(by('milestone').map((s) => s.title), ['v1.1.0'], 'v1.0.0 exists; nightly is not a release')
  assert.deepEqual(by('issue-link').map((s) => [s.pr, s.issue]), [[10, 1]])
  assert.deepEqual(by('pr-title').map((s) => [s.pr, s.to]).sort((a, b) => a[0] - b[0]), [[12, 'feat(billing): new billing page [#2]'], [13, null]], 'a title it cannot fix is left for a person')
  assert.deepEqual(by('pr-body').map((s) => [s.pr, s.add]).sort((a, b) => a[0] - b[0]), [[12, ['How it was tested', 'Lessons']], [13, ['How it was tested', 'Lessons']]])
})

test('applying twice changes nothing the second time; writes are rate-limited and marked', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-retrofit-'))
  try {
    const t = REPO()
    const plan = planRetrofit({ tracker: t, git, config })
    let labelsCreated = 0
    const sleeps = []
    const deps = { tracker: t, cwd, config, setupLabels: () => { labelsCreated++; t.state.labels.push(...plan.steps.find((x) => x.kind === 'labels').create) }, sleep: async (ms) => { sleeps.push(ms) }, author: 'ana' }
    const first = await applyRetrofit(deps, plan, { delayMs: 300 })
    assert.ok(first.applied.length >= 6, JSON.stringify(first))
    assert.ok(sleeps.length >= 5 && sleeps.every((ms) => ms === 300), 'spaced writes')
    assert.ok(t.state.comments[1][0].body.includes(MARKER), 'marked')
    assert.match(t.state.prs.find((p) => p.number === 12).body, /## Lessons[\s\S]*agent-os:retrofit/)
    assert.deepEqual(t.state.milestones.find((m) => m.title === 'v1.1.0').state, 'closed')
    assert.equal(t.state.prs.find((p) => p.number === 11).body, '## What\n\nX', 'the closed PR is untouched')
    assert.equal(t.state.prs.find((p) => p.number === 12).title, 'feat(billing): new billing page [#2]')
    assert.equal(t.state.prs.find((p) => p.number === 13).title, 'WIP stuff', 'no invented title')
    const writesBefore = t.writes.length
    const second = await applyRetrofit(deps, plan, { delayMs: 300 })
    assert.equal(second.applied.length, 0, JSON.stringify(second.applied))
    assert.equal(t.writes.length, writesBefore, 'no write at all the second time')
    assert.equal(labelsCreated, 1)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('a PR closed after planning is skipped, never rewritten; plan and apply from the CLI with a dry run', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-retrofit-'))
  try {
    writeFileSync(join(cwd, 'agent-os.json'), JSON.stringify({ platform: { type: 'github', project: 'acme/app' } }))
    const t = REPO()
    const io = { stdout: () => {}, stderr: () => {}, cwd, env: {}, tracker: t, git, sleep: async () => {}, setupLabels: () => {} }
    assert.equal(await run(['retrofit', 'plan'], io), 0)
    assert.ok(existsSync(join(cwd, '.agent-os/retrofit/plan.json')))
    t.state.prs.find((p) => p.number === 12).state = 'closed'
    let out = ''
    assert.equal(await run(['retrofit', 'apply', '--dry-run'], { ...io, stdout: (s) => { out += s } }), 0)
    assert.match(out, /= title:12: not open any more: closed change requests are never rewritten/)
    assert.deepEqual(t.writes, [], 'a dry run writes nothing')
    assert.equal(JSON.parse(readFileSync(join(cwd, '.agent-os/retrofit/plan.json'), 'utf8')).version, 1)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
