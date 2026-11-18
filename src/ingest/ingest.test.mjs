// Tests for /ingest-docs: two specs that disagree block issue creation until the person resolves the contradiction;
// every created issue cites its source section; epics get their requirements as sub-issues.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { contradictions, ingestPlan, sections } from './ingest.mjs'
import { run } from '../cli/main.mjs'

const PRODUCT = '# Product\n\n## Accounts\n\nPeople sign up with an e-mail address.\n\n- Sessions expire after 30 minutes of inactivity.\n- Users can reset their password by e-mail.\n\n## Orders\n\n- Customers can cancel an order before it ships.\n\n```\n- not a requirement\n```\n'
const SECURITY = '# Security\n\n## Sessions\n\n- Sessions expire after 15 minutes of inactivity.\n- Admins must use two-factor login.\n'
const repo = (files) => { const cwd = mkdtempSync(join(tmpdir(), 'aos-ingest-')); for (const [p, c] of Object.entries(files)) { mkdirSync(join(cwd, p, '..'), { recursive: true }); writeFileSync(join(cwd, p), c) } return cwd }
const fakeTracker = () => { const calls = []; let n = 100; return { calls, create(spec, { dryRun } = {}) { calls.push({ ...spec, dryRun }); return dryRun ? { dryRun: true } : { number: ++n } } } }
const cli = async (cwd, argv, tracker) => { let out = ''; const code = await run(argv, { stdout: (s) => { out += s }, stderr: (s) => { out += s }, cwd, env: {}, tracker }); return { code, out } }

test('sections keep their heading path and line; code blocks are not requirements', () => {
  const s = sections('docs/product.md', PRODUCT)
  assert.deepEqual(s.map((x) => [x.heading, x.line, x.trail.join(' › ')]), [['Product', 1, 'Product'], ['Accounts', 3, 'Product › Accounts'], ['Orders', 10, 'Product › Orders']])
  assert.deepEqual(s[2].statements.map((x) => x.text), ['Customers can cancel an order before it ships.'])
})

test('given two specs that disagree, /ingest-docs asks before creating issues', async () => {
  const cwd = repo({ 'docs/product.md': PRODUCT, 'docs/security.md': SECURITY })
  const tracker = fakeTracker()
  try {
    const plan = ingestPlan(cwd)
    assert.deepEqual(plan.contradictions.map((c) => [c.id, c.kind, `${c.a.path}:${c.a.line}`, `${c.b.path}:${c.b.line}`]), [['c1', 'numbers', 'docs/product.md:7', 'docs/security.md:5']])
    let r = await cli(cwd, ['ingest', 'plan'], tracker)
    assert.equal(r.code, 1, 'a contradiction is a failing check')
    assert.match(r.out, /1 contradiction\(s\): ask the person before creating any issue:\n {2}c1 \(numbers\): a\) docs\/product\.md:7 "Sessions expire after 30 minutes/)
    r = await cli(cwd, ['ingest', 'apply'], tracker)
    assert.equal(r.code, 1)
    assert.match(r.out, /nothing was created/)
    assert.deepEqual(tracker.calls, [], 'no issue before the person answers')
    assert.equal((await cli(cwd, ['ingest', 'apply', '--resolve', 'c9=a'], tracker)).code, 2)
    r = await cli(cwd, ['ingest', 'apply', '--resolve', 'c1=b'], tracker)
    assert.equal(r.code, 0, r.out)
    assert.match(r.out, /left out the statement\(s\) the person overruled: docs\/product\.md:7/)
    assert.ok(!tracker.calls.some((c) => /30 minutes/.test(c.title)), 'the overruled statement is not filed')
    assert.ok(tracker.calls.some((c) => /15 minutes/.test(c.title)))
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('every created issue cites its source section; requirements become sub-issues of their epic', async () => {
  const cwd = repo({ 'docs/product.md': PRODUCT })
  const tracker = fakeTracker()
  try {
    assert.equal((await cli(cwd, ['ingest', 'plan'], tracker)).code, 0)
    const made = []
    tracker.milestones = () => [{ title: 'Backlog' }]
    tracker.createMilestone = (m) => { made.push(m.title); return {} }
    const r = await cli(cwd, ['ingest', 'apply', '--milestone', 'MVP'], tracker)
    assert.equal(r.code, 0, r.out)
    assert.deepEqual(made, ['MVP'], 'the milestone is created when missing')
    assert.deepEqual(tracker.calls.map((c) => [c.title, c.parent ?? null, c.labels]), [
      ['Accounts', null, ['type:epic']],
      ['Accounts: Sessions expire after 30 minutes of inactivity', 101, ['type:feature']],
      ['Accounts: Users can reset their password by e-mail', 101, ['type:feature']],
      ['Orders', null, ['type:epic']],
      ['Orders: Customers can cancel an order before it ships', 104, ['type:feature']],
    ])
    for (const c of tracker.calls) {
      assert.match(c.body, /From the specification: `docs\/product\.md` line \d+, section "Product › (Accounts|Orders)" \(\[docs\/product\.md#(accounts|orders)\]/, c.title)
      assert.equal(c.milestone, 'MVP')
    }
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('statements that agree, or are about different things, are not contradictions', () => {
  const s = (path, line, text) => ({ path, line, text })
  assert.deepEqual(contradictions([s('a.md', 1, 'Sessions expire after 30 minutes of inactivity.'), s('b.md', 2, 'Sessions expire after 30 minutes of inactivity.')]), [])
  assert.deepEqual(contradictions([s('a.md', 1, 'Orders ship within 2 days.'), s('b.md', 2, 'Passwords have at least 12 characters.')]), [])
  assert.deepEqual(contradictions([s('a.md', 1, 'Guests can check out without an account.'), s('b.md', 2, 'Guests can check out with an account.')]).map((c) => c.kind), ['negation'])
})
