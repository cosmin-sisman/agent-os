// Tests for /discover: a repository that uses feature/ prefixes gets a rule (and a start branch) that uses them; every
// inferred rule cites its evidence; decisions come out of change-request discussions; nothing is written until the
// person accepts a proposal by id.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { commitStyle, decisionsFrom, discoverPlan } from './discover.mjs'
import { branchFor } from '../workflow/start.mjs'
import { run } from '../cli/main.mjs'

const SUBJECTS = [
  'feat(api): add order search (#41)', 'fix(api): timeout on export (#40)', 'feat(web): checkout page (#39)', 'chore: bump deps (#38)',
  'docs: explain setup (#37)', 'fix(db): index on orders (#36)', 'feat(db): migrations folder (#35)', 'wip',
]
const git = (args) => {
  if (args[0] === 'log') return { status: 0, stdout: `${SUBJECTS.map((s) => `${s}\x1fabc123`).join('\n')}\n` }
  if (args[0] === 'for-each-ref') return { status: 0, stdout: 'origin/HEAD\norigin/main\norigin/feature/42-bulk-edit\norigin/bugfix/43-null-total\n' }
  if (args[0] === 'ls-files') return { status: 0, stdout: 'api/a.ts\napi/b.ts\nweb/c.tsx\ndb/m.sql\nREADME.md\n.github/workflows/ci.yml\n' }
  return { status: 1, stdout: '' }
}
const PRS = [
  { number: 41, title: 'Orders: search', body: 'Adds search.\n\nWe decided to use Postgres full-text search instead of Elasticsearch, to keep one database.', merged: true, mergedAt: '2026-10-01T10:00:00Z', head: 'feature/41-order-search', author: 'ana' },
  { number: 40, title: 'Export: timeout', body: 'Raises the timeout.', merged: true, head: 'bugfix/40-export-timeout' },
  { number: 39, title: 'Checkout page', body: 'The page.', merged: true, head: 'feature/39-checkout' },
  { number: 34, title: 'Draft idea', body: 'We decided nothing yet.', merged: false, head: 'feature/34-draft' },
]
const tracker = { allPullRequests: () => PRS }

test('given a repo using feature/ prefixes, the proposed rule uses them', () => {
  const plan = discoverPlan({ git, tracker })
  const p = plan.proposals.find((x) => x.id === 'branch-prefixes')
  assert.deepEqual(p.value, { feature: 'feature', bug: 'bugfix' })
  assert.match(p.rule, /feature\/<n>-<slug> for a feature/)
  assert.equal(branchFor({ number: 52, title: 'Discover: infer conventions', labels: ['type:feature'] }, { prefixes: p.value }), 'feature/52-infer-conventions')
  assert.equal(branchFor({ number: 52, title: 'Discover: infer conventions', labels: ['type:feature'] }), 'feat/52-infer-conventions', 'the default stays without the setting')
})

test('every inferred rule cites its evidence', () => {
  const plan = discoverPlan({ git, tracker })
  assert.deepEqual(plan.proposals.map((p) => p.id), ['commit-types', 'issue-refs', 'branch-prefixes', 'merge-method', 'area-map', 'decision:41'])
  for (const p of plan.proposals) assert.ok(p.evidence.length && p.evidence.every((e) => typeof e === 'string' && e.length > 5), p.id)
  const types = plan.proposals[0]
  assert.equal(types.kind, 'note', 'every type in use is a default: nothing to change')
  const custom = discoverPlan({ git: (a) => (a[0] === 'log' ? { status: 0, stdout: 'ops: rotate keys\x1fa\nops: new runner\x1fa\nfeat: x\x1fa\n' } : git(a)), tracker }).proposals[0]
  assert.deepEqual(custom.value.slice(-1), ['ops'], 'a type in use beyond the defaults is added, never narrowed')
  assert.ok(custom.value.includes('docs'))
  assert.match(types.evidence[0], /^7 of 8 commit subjects \(88%\)/)
  assert.deepEqual(plan.proposals.find((p) => p.id === 'merge-method').value, 'squash')
  assert.deepEqual(plan.proposals.find((p) => p.id === 'area-map').rows.map((r) => [r.dir, r.files, r.scopes]), [['api', 2, ['api']], ['db', 1, ['db']], ['web', 1, ['web']]])
  assert.equal(commitStyle([{ subject: 'Merge pull request #1', merge: true }]).total, 0, 'merge commits are not commit style')
})

test('decisions come from merged change-request discussions only', () => {
  assert.deepEqual(decisionsFrom(PRS), [{ number: 41, title: 'Orders: search', author: 'ana', areas: [], quote: 'We decided to use Postgres full-text search instead of Elasticsearch, to keep one database.', date: '2026-10-01' }])
})

test('agent-os discover: proposals are reviewed before anything is written', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-discover-'))
  const io = (out) => ({ stdout: (s) => { out.s += s }, stderr: () => {}, cwd, env: {}, git, tracker, now: new Date('2026-11-18T12:00:00Z') })
  try {
    const out = { s: '' }
    assert.equal(await run(['discover', 'plan'], io(out)), 0)
    assert.match(out.s, /\[branch-prefixes\][\s\S]*evidence: feature: feature\/ 4/)
    assert.equal(existsSync(join(cwd, 'agent-os.json')), false, 'the plan writes nothing but its cache')
    assert.equal(await run(['discover', 'apply'], io({ s: '' })), 2, 'apply needs the accepted ids')
    assert.equal(await run(['discover', 'apply', '--accept', 'nope'], io({ s: '' })), 2)
    assert.equal(await run(['discover', 'apply', '--accept', 'branch-prefixes', '--accept', 'decision:41', '--accept', 'area-map'], io({ s: '' })), 0)
    assert.deepEqual(JSON.parse(readFileSync(join(cwd, 'agent-os.json'), 'utf8')).branches, { prefixes: { feature: 'feature', bug: 'bugfix' } })
    const entries = readdirSync(join(cwd, '.agent-os/journal/2026/11'))
    assert.equal(entries.length, 1)
    assert.match(readFileSync(join(cwd, '.agent-os/journal/2026/11', entries[0]), 'utf8'), /type: decision[\s\S]*#41[\s\S]*Postgres full-text search/)
    assert.match(readFileSync(join(cwd, '.agent-os/cache/discover-area-map.md'), 'utf8'), /^\| Path \| What \|\n\|---\|---\|\n\| `api\/` \| to describe \(2 files; scopes: api\) \|/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
