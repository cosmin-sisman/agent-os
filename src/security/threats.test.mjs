// Tests for preparing against attacks: an issue in the payments area gets "Given an attacker" scenarios in its test
// plan; the STRIDE threat model is a living artifact that goes stale and refreshes when stack.yaml changes (by
// `stack set` too); tabletop exercises find runbook gaps and propose an issue without filing it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { abuseCases, exercise, refreshThreatModel, sensitiveAreas, threatModel, threatModelStale } from './threats.mjs'
import { planScenarios } from '../testing/test.mjs'
import { externalLoads } from '../artifacts/artifact.mjs'
import { run } from '../cli/main.mjs'
import { CORE_HANDLERS } from '../hooks/runner.mjs'

const STACK = 'layers:\n  public-api-webhooks: { tech: hono-zod-openapi, paths: ["apps/api/**"] }\n  data-layer: { tech: drizzle-supabase-postgres, paths: ["packages/db/**"] }\n'
const repo = (files) => { const cwd = mkdtempSync(join(tmpdir(), 'aos-threat-')); for (const [p, c] of Object.entries(files)) { mkdirSync(join(cwd, p, '..'), { recursive: true }); writeFileSync(join(cwd, p), c) } return cwd }

test('given an issue in the payments area, the test plan includes Given-an-attacker scenarios', () => {
  const issue = { title: 'Checkout: pay an order by card', labels: ['type:feature', 'area:payments'], body: '## Goal\n\nCustomers pay their order.\n\n## Acceptance criteria\n\n- [ ] the order is marked paid\n' }
  const p = planScenarios(issue)
  assert.equal(p.proposed[0], 'Given …, when …, then the order is marked paid')
  const attacker = p.proposed.filter((s) => s.startsWith('Given an attacker'))
  assert.equal(attacker.length, 2)
  assert.match(attacker.join('\n'), /forged payment webhook/)
  assert.ok(planScenarios(issue, { lang: 'ro' }).proposed.some((s) => s.startsWith('Dat fiind un atacator')), 'in ro too')
  assert.deepEqual(sensitiveAreas({ title: 'Docs: fix a typo', labels: ['type:docs'], body: '## Acceptance criteria\n\n- [ ] the login page link works\n' }), [], 'only the title, Goal and Context are read')
  assert.deepEqual(abuseCases({ title: 'Profile: export personal data (GDPR)', labels: [] }).length, 2)
})

test('the STRIDE threat model covers each layer and the flows between them', () => {
  const m = threatModel({ layers: { 'public-api-webhooks': { tech: 'hono' }, 'data-layer': { tech: 'postgres' }, 'ci-cd': { tech: 'gha' }, analytics: { tech: 'x' }, cms: { tech: 'y', status: 'rejected' } } })
  assert.deepEqual(m.layers.map((l) => [l.layer, l.group]), [['analytics', null], ['ci-cd', 'ci'], ['data-layer', 'data'], ['public-api-webhooks', 'api']])
  assert.ok(m.threats.some((t) => t.layer === 'public-api-webhooks' && t.category === 'elevation of privilege'))
  assert.deepEqual(m.flows.map((f) => `${f.from}→${f.to}`), ['api→data'])
  assert.deepEqual(m.uncovered, ['analytics'])
})

test('the threat model refreshes when stack.yaml changes', async () => {
  const cwd = repo({ 'stack.yaml': STACK })
  const now = new Date('2026-11-18T10:00:00Z')
  try {
    const a = refreshThreatModel(cwd, { now })
    assert.equal(a.action, 'created')
    assert.equal(a.id, '2026-11-18-threat-model')
    const page = readFileSync(join(cwd, 'artifacts', a.id, 'index.html'), 'utf8')
    assert.deepEqual(externalLoads(page), [])
    assert.match(readFileSync(join(cwd, 'artifacts', a.id, 'artifact.yaml'), 'utf8'), /kind: living[\s\S]*- path: stack\.yaml/)
    assert.deepEqual(threatModelStale(cwd), { id: a.id, stale: [] })
    assert.equal(refreshThreatModel(cwd, { now }).action, 'current')

    writeFileSync(join(cwd, 'stack.yaml'), `${STACK}  auth: { tech: supabase-auth, paths: ["apps/auth/**"] }\n`)
    assert.deepEqual(threatModelStale(cwd).stale, ['stack.yaml'], 'stale when the stack changes')
    const handler = CORE_HANDLERS.find((h) => h.name === 'security')
    assert.match(handler.run({}, { cwd }).message, /the threat model 2026-11-18-threat-model is stale \(stack\.yaml changed\): agent-os security threat-model/, 'SessionStart says so')
    const b = refreshThreatModel(cwd, { now: new Date('2026-11-20T10:00:00Z') })
    assert.deepEqual([b.action, b.id], ['refreshed', a.id], 'the same living artifact, refreshed in place')
    assert.ok(b.model.layers.some((l) => l.layer === 'auth'))
    assert.deepEqual(threatModelStale(cwd).stale, [])
    assert.equal(handler.run({}, { cwd }), null)
    let out = ''
    const io = { stdout: (s) => { out += s }, stderr: () => {}, cwd, env: {}, now }
    assert.equal(await run(['security', 'threat-model'], io), 0)
    assert.match(out, /threat model 2026-11-18-threat-model is current/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('agent-os stack set refreshes a threat model built from the stack', async () => {
  const cwd = repo({ 'stack.yaml': STACK })
  try {
    refreshThreatModel(cwd, { now: new Date('2026-11-18T10:00:00Z') })
    let out = ''
    const code = await run(['stack', 'set', 'data-layer', 'prisma-neon-postgres', '--why', 'serverless'], { stdout: (s) => { out += s }, stderr: () => {}, cwd, env: {}, now: new Date('2026-11-19T10:00:00Z') })
    assert.equal(code, 0, out)
    assert.match(out, /refreshed the threat model 2026-11-18-threat-model/)
    assert.deepEqual(threatModelStale(cwd).stale, [])
    assert.match(readFileSync(join(cwd, 'artifacts/2026-11-18-threat-model/data.json'), 'utf8'), /prisma-neon-postgres/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('a tabletop exercise finds runbook gaps and proposes an issue, filing nothing', async () => {
  const cwd = repo({ 'docs/runbooks/secrets.md': '# Leaked secret\n\n1. Revoke the key in the provider console.\n2. Check the access log for its usage.\n' })
  try {
    const r = exercise(cwd, 'leaked-key')
    assert.deepEqual(r.runbooks, ['docs/runbooks/secrets.md'])
    assert.deepEqual(r.steps.map((s) => [s.step, s.covered]), [['revoke', true], ['find where it was used', true], ['rotate every copy', false], ['tell who must know', false]])
    assert.deepEqual(r.proposed.steps, ['rotate every copy', 'tell who must know'])
    assert.match(r.note, /environments the project owns only/)
    assert.throws(() => exercise(cwd, 'ddos-them'), /unknown exercise/)
    const calls = []
    let out = ''
    const code = await run(['security', 'exercise', 'leaked-key'], { stdout: (s) => { out += s }, stderr: () => {}, cwd, env: {}, gh: (a) => { calls.push(a); return { status: 1, stdout: '' } } })
    assert.equal(code, 1, 'gaps fail the exercise')
    assert.match(out, /GAP {2}rotate every copy/)
    assert.match(out, /proposed: Runbooks: cover/)
    assert.deepEqual(calls, [], 'nothing is filed')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
