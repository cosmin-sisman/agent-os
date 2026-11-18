// Tests for /ticket logic: validation, label translation, similarity, and relationship plans per capability.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateTicket, resolveLabels, similarity, findSimilar, relationshipPlan } from './ticket.mjs'
import { withDefaults } from '../config/config.mjs'
import { SCHEMA } from '../config/schema.mjs'

const config = (languages = {}) => withDefaults(SCHEMA, { languages })
const good = { title: 'Login: the session expires after five minutes', body: '## Context\n\nx\n\n## Test scenarios\n\n- Given …', labels: ['type:bug', 'priority:p1', 'area:auth'], milestone: 'v0.2' }

test('a complete ticket passes', () => {
  assert.deepEqual(validateTicket(good, config()), [])
})

test('an issue without a milestone or a type is refused, saying what to add', () => {
  const p = validateTicket({ ...good, milestone: undefined, labels: ['priority:p1', 'area:auth'] }, config())
  assert.ok(p.some((x) => x.startsWith('a milestone is required')))
  assert.ok(p.some((x) => x.startsWith('exactly one type label is needed') && x.includes('type:bug')))
})

test('priority, area, size, title form and test scenarios are enforced', () => {
  const p = validateTicket({ title: 'session expires.', body: 'no scenarios', labels: ['type:bug', 'size:s', 'size:m'], milestone: 'm' }, config())
  for (const start of ['the title must be "<Area>: ', 'remove the final period', 'exactly one priority', 'at least one area', 'at most one size', 'the body needs a "## Test scenarios"']) assert.ok(p.some((x) => x.startsWith(start)), start)
})

test('in ro, labels translate from their ids and the body must be ASCII with a ro scenarios heading', () => {
  const cfg = config({ issues: 'ro', labels: 'ro' })
  assert.deepEqual(resolveLabels(['type:bug', 'priority:p1', 'area:auth', 'needs-decision'], cfg), ['tip:bug', 'prioritate:p1', 'area:auth', 'necesita-decizie'])
  const spec = { ...good, labels: resolveLabels(good.labels, cfg), body: '## Scenarii de test\n\n- Dat fiind că…' }
  const p = validateTicket(spec, cfg)
  assert.equal(p.length, 1)
  assert.match(p[0], /"ă"; issues are written in ASCII Romanian, use "a"/)
  assert.deepEqual(validateTicket({ ...spec, body: '## Scenarii de test\n\n- Dat fiind ca…' }, cfg), [])
})

test('similarity compares meaningful words; findSimilar keeps the close ones', () => {
  assert.ok(similarity('Login: the session expires too early', 'Session expires early after login') >= 0.75)
  assert.equal(similarity('Billing: invoices are rounded wrong', 'Login: session expires'), 0)
  const tracker = { search: () => [{ number: 4, title: 'Session expires early after login', state: 'open' }, { number: 9, title: 'Billing rounding', state: 'closed' }] }
  assert.deepEqual(findSimilar(tracker, 'Login: the session expires too early').map((i) => i.number), [4])
})

test('relationships use native links on GitHub and fallbacks without them', () => {
  const github = { subItems: { value: true }, dependencies: { value: true }, multipleAssignees: { value: true } }
  assert.deepEqual(relationshipPlan(github, { number: 50, parent: 10, blockedBy: [3], blocks: [60], assignees: ['ana', 'dan'] }).map((a) => `${a.do}:${a.type ?? ''}`), ['link:sub-issue', 'link:blocked-by', 'link:blocked-by', 'assign:'])
  const free = { subItems: { value: 'tasks' }, dependencies: { value: false }, multipleAssignees: { value: false } }
  assert.deepEqual(relationshipPlan(free, { number: 50, blockedBy: [3], assignees: ['ana', 'dan'] }).map((a) => a.do), ['link', 'add-label', 'body-line', 'assign', 'comment'])
})
