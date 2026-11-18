// Tests for the release flow with a scripted git and a fake tracker: risks stop the release until accepted, the merge
// is a merge commit pinned to the checked head, tag, notes and milestone roll, the sync back, hotfixes, and reruns.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { finishRelease, openRelease, planRelease, releaseRisks } from './release.mjs'
import { vocabularyFor } from '../platform/vocabulary.mjs'

const CONFIG = { branches: { integration: 'development', production: 'main', requiredChecks: [], requiredApprovals: 0 }, languages: { milestones: 'en' }, requires: {}, gate: {} }
const VOCAB = vocabularyFor('github')

/** A scripted repository: v0.1.0 on main, three merged PRs on development, optional risky files. */
function fakeGit({ tags = ['v0.1.0'], files = {}, envExample = '', remoteBranches = [] } = {}) {
  const calls = []
  const state = { tags: [...tags] }
  const git = (args) => {
    calls.push(args)
    const k = args.join(' ')
    const r = (stdout, status = 0) => ({ status, stdout, stderr: status ? 'fatal' : '' })
    if (args[0] === 'fetch') return r('')
    if (k.startsWith('rev-parse --verify --quiet refs/tags/')) return state.tags.includes(args[3].slice(10)) ? r('tagsha') : r('', 1)
    if (k.startsWith('rev-parse --verify --quiet refs/remotes/origin/')) return remoteBranches.includes(args[3].slice(20)) ? r('x') : r('', 1)
    if (k.startsWith('describe')) { const base = args.at(-1); if (base.endsWith('^')) return r('v0.1.0'); return state.tags.length ? r(state.tags.at(-1) === 'v0.2.0' && base === 'origin/main' ? 'v0.2.0' : 'v0.1.0') : r('', 128) }
    if (k.startsWith('rev-list --max-parents=0')) return r('rootsha')
    if (k.startsWith('log --format=%s')) return r('feat(a): one (#10)\nfix(b): two (#11)\nfeat(db): drop old table (#12)')
    if (k.startsWith('diff --name-only --diff-filter=AM')) return r(Object.keys(files).join('\n'))
    if (k.startsWith('diff --name-only --diff-filter=A')) return r('')
    if (args[0] === 'show') { const [ref, path] = args[1].split(':'); if (path === 'agent-os.json') return ref === 'v0.1.0' ? r('{"requires":{"env":["DB_URL"]}}') : r('{"requires":{"env":["DB_URL","STRIPE_KEY"]}}'); return path in files ? r(files[path]) : r('', 128) }
    if (args[0] === 'diff') return r(envExample)
    if (k === 'rev-parse origin/main') return r('mergesha')
    if (k.startsWith('rev-list -n 1')) return r('mergesha')
    if (k === 'rev-parse --abbrev-ref HEAD') return r('development')
    return r('')
  }
  git.calls = calls
  return git
}

function fakeTracker({ pr = null, prBody = '', milestones = [{ number: 5, title: 'Stage 0 - Release 3 (in progress)', state: 'open' }], tagExists = false, syncExists = false } = {}) {
  const calls = []
  const ms = [...milestones]
  const t = {
    calls,
    get: (n) => ({ number: n, url: `u/${n}`, title: { 10: 'feat(a): one', 11: 'fix(b): two', 12: 'feat(db): drop old table' }[n], labels: [], body: '' }),
    milestones: () => ms,
    findPullRequest: ({ head, base }) => (base === 'main' ? pr : syncExists ? { number: 80, url: 'u/80' } : null),
    pullRequestStatus: () => ({ number: pr.number, state: 'open', draft: false, base: 'main', checks: 'success', failing: [], pending: [], all: [], review: null, mergeable: 'MERGEABLE', mergeState: 'CLEAN', head: 'releasehead', body: prBody }),
    mergePullRequest: (n, o) => { calls.push(['merge', n, o]); return { merged: true } },
    createTag: (tag, sha) => { calls.push(['tag', tag, sha]); return { tag, sha, created: !tagExists } },
    publishRelease: (r) => { calls.push(['release', r.tag]); return { tag: r.tag, url: 'u/release', created: true } },
    updateMilestone: (n, ch) => { calls.push(['milestone', n, ch]); const m = ms.find((x) => x.number === n); Object.assign(m, ch) },
    createMilestone: (m) => { calls.push(['new milestone', m.title]); ms.push({ number: 6, title: m.title, state: 'open' }); return { number: 6 } },
    createPullRequest: (spec) => { calls.push(['pr', spec.head, spec.base, spec.title]); return { number: spec.base === 'main' ? 70 : 80, url: 'u' } },
    updatePullRequest: (n, spec) => { calls.push(['update pr', n, spec.title]); return { number: n, url: 'u' } },
    deleteBranch: (b) => { calls.push(['delete', b]); return {} },
  }
  return t
}
const deps = (git, tracker, cwd = '.') => ({ git, tracker, cwd, config: CONFIG, vocab: VOCAB })

test('risks: destructive migrations and new variables are found', () => {
  const git = fakeGit({ files: { 'db/migrations/0004_cleanup.sql': 'ALTER TABLE orders DROP COLUMN legacy_id;', 'db/migrations/0005_add.sql': 'CREATE TABLE x (id int);', 'src/a.ts': 'DROP TABLE nope' }, envExample: '+PAYPAL_SECRET=\n-OLD=1\n context' })
  assert.deepEqual(releaseRisks(git, { from: 'v0.1.0', head: 'origin/development' }).map((r) => r.id), ['destructive:db/migrations/0004_cleanup.sql', 'env:PAYPAL_SECRET', 'env:STRIPE_KEY'])
})

test('given a release with a destructive migration, when /release runs, it stops and asks', () => {
  const git = fakeGit({ files: { 'db/migrations/0004_cleanup.sql': 'DROP TABLE sessions;' } })
  const t = fakeTracker({ pr: { number: 70, url: 'u/70' } })
  const r = finishRelease(deps(git, t), { version: '0.2.0' })
  assert.equal(r.released, false)
  assert.ok(r.problems.some((p) => /^ask first: db\/migrations\/0004_cleanup\.sql contains "DROP TABLE"/.test(p)))
  assert.ok(r.problems.some((p) => /ask first: new variable STRIPE_KEY/.test(p)))
  assert.deepEqual(t.calls, [], 'nothing merged, tagged or published')
  const accepted = finishRelease(deps(git, t), { version: '0.2.0', accept: ['destructive:db/migrations/0004_cleanup.sql', 'env'] })
  assert.equal(accepted.released, true)
})

test('a risk ticked under Before merge in the release PR counts as accepted', () => {
  const git = fakeGit({ files: { 'db/migrations/1.sql': 'TRUNCATE logs;' } })
  const t = fakeTracker({ pr: { number: 70 }, prBody: '## Before merge\n\n- [x] destructive:db/migrations/1.sql\n- [x] env:STRIPE_KEY\n' })
  assert.equal(finishRelease(deps(git, t), { version: '0.2.0' }).released, true)
})

test('finish: merge commit pinned to the checked head, tag on production, notes, milestone roll, sync back; nothing deleted', () => {
  const git = fakeGit()
  const t = fakeTracker({ pr: { number: 70, url: 'u/70' } })
  const r = finishRelease(deps(git, t), { version: '0.2.0', accept: ['env'], now: new Date('2026-12-01T00:00:00Z') })
  assert.equal(r.released, true)
  assert.deepEqual(t.calls, [
    ['merge', 70, { method: 'merge', sha: 'releasehead' }],
    ['tag', 'v0.2.0', 'mergesha'],
    ['release', 'v0.2.0'],
    ['milestone', 5, { title: 'Release 3 - 2026-12-01', description: 'A shipped release', state: 'closed' }],
    ['new milestone', 'Stage 0 - Release 4 (in progress)'],
    ['pr', 'release/0.2.0', 'development', 'chore(release): sync v0.2.0 into development'],
  ])
  assert.ok(!t.calls.some((c) => c[0] === 'delete'), 'never deletes a branch, the integration branch least of all')
  assert.ok(!t.calls.some((c) => c[0] === 'merge' && c[2].method === 'squash'))
})

test('finish is safe to rerun: an existing tag, release and sync are reused, and the milestone is not rolled twice', () => {
  const git = fakeGit({ tags: ['v0.1.0', 'v0.2.0'] })
  const t = fakeTracker({ pr: null, tagExists: true, syncExists: true, milestones: [{ number: 6, title: 'Stage 0 - Release 4 (in progress)', state: 'open' }] })
  const r = finishRelease(deps(git, t), { version: '0.2.0', accept: ['env'] })
  assert.equal(r.released, true, r.problems?.join('; '))
  assert.equal(r.plan.lastTag, 'v0.1.0', 'the notes still cover the whole release')
  assert.deepEqual(t.calls.map((c) => c[0]), ['tag', 'release'])
  assert.equal(r.sync.existed, true)
})

test('--dry-run lists the steps and changes nothing', () => {
  const t = fakeTracker({ pr: { number: 70 } })
  const r = finishRelease(deps(fakeGit(), t), { version: '0.2.0', accept: ['env'], dryRun: true })
  assert.equal(r.dryRun, true)
  assert.match(r.steps[0], /merge #70 into main with a merge commit \(never squashed\)/)
  assert.deepEqual(t.calls, [])
})

test('hotfix: no release PR; tag what is on production and sync production back into integration', () => {
  const t = fakeTracker()
  const r = finishRelease(deps(fakeGit(), t), { version: '0.2.0', hotfix: true, accept: ['env'] })
  assert.equal(r.released, true)
  assert.equal(t.calls[0][0], 'tag')
  assert.deepEqual(t.calls.at(-1), ['pr', 'main', 'development', 'chore(release): sync v0.2.0 into development'])
})

test('a version that is not after the last release, and a missing release PR, are refused', () => {
  assert.match(planRelease(deps(fakeGit(), fakeTracker()), { version: '0.1.0' }).problems[0], /not after the last release v0\.1\.0/)
  assert.throws(() => planRelease(deps(fakeGit(), fakeTracker()), { version: 'next' }), /--version is required/)
  assert.ok(finishRelease(deps(fakeGit(), fakeTracker()), { version: '0.2.0', accept: ['env'] }).problems.some((p) => /no open release pull request/.test(p)))
})

test('open: the release branch carries the changelog and a release journal entry; a rerun updates the same PR', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-release-'))
  try {
    const git = fakeGit()
    const t = fakeTracker()
    const r = openRelease(deps(git, t, cwd), { version: '0.2.0', author: 'ana', now: new Date('2026-12-01T10:00:00Z') })
    assert.equal(r.opened, true)
    assert.deepEqual(git.calls.filter((c) => ['switch', 'add', 'commit', 'push'].includes(c[0])).map((c) => c.slice(0, 3).join(' ')), ['switch -c release/0.2.0', 'add changelog.yaml .agent-os/journal/2026/12/2026-12-01T10-00-ana-release-0-2-0.md', 'commit -m chore(release): 0.2.0', 'push -u origin', 'switch development'])
    assert.match(readFileSync(join(cwd, 'changelog.yaml'), 'utf8'), /version: 0\.2\.0/)
    assert.deepEqual(t.calls.at(-1), ['pr', 'release/0.2.0', 'main', 'release-3: 0.2.0'])
    const again = openRelease(deps(fakeGit({ remoteBranches: ['release/0.2.0'] }), fakeTracker({ pr: { number: 70, url: 'u/70' } }), cwd), { version: '0.2.0' })
    assert.equal(again.updated, true)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('given a KEV entry for a direct dependency, /release refuses to ship it until it is updated or accepted in writing', async () => {
  const { saveCache } = await import('../security/digest.mjs')
  const cwd = mkdtempSync(join(tmpdir(), 'aos-release-kev-'))
  try {
    saveCache(cwd, { at: '2026-11-18T00:00:00Z', packages: 2, items: [
      { id: 'GHSA-xxxx-1111', aliases: ['CVE-2026-1111'], severity: 'critical', kev: true, shipped: true, direct: true, accepted: false, fixed: '4.19.2', touched: [{ ecosystem: 'npm', name: 'express', version: '4.19.1', direct: true, dev: false }] },
      { id: 'GHSA-dev-only', aliases: [], severity: 'high', kev: true, shipped: false, direct: true, accepted: false, fixed: null, touched: [{ ecosystem: 'npm', name: 'vitest', version: '1.0.0', direct: true, dev: true }] },
    ] })
    const t = fakeTracker({ pr: { number: 70, url: 'u/70' } })
    const r = finishRelease(deps(fakeGit(), t, cwd), { version: '0.2.0', accept: ['env'] })
    assert.equal(r.released, false)
    assert.ok(r.problems.some((p) => /^known exploited: GHSA-xxxx-1111 \(CVE-2026-1111\) in express@4\.19\.1; fixed in 4\.19\.2/.test(p)), r.problems.join('\n'))
    assert.equal(r.problems.some((p) => /vitest/.test(p)), false, 'a development-only dependency does not ship')
    assert.deepEqual(t.calls, [], 'nothing merged or tagged')
    saveCache(cwd, { at: '2026-11-18T00:00:00Z', packages: 2, items: [{ id: 'GHSA-xxxx-1111', aliases: ['CVE-2026-1111'], severity: 'critical', kev: true, shipped: true, direct: true, accepted: true, fixed: '4.19.2', touched: [{ ecosystem: 'npm', name: 'express', version: '4.19.1', direct: true, dev: false }] }] })
    assert.equal(finishRelease(deps(fakeGit(), fakeTracker({ pr: { number: 70, url: 'u/70' } }), cwd), { version: '0.2.0', accept: ['env'] }).released, true, 'accepted in writing')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
