// Tests for /audit's deterministic half: an idea runs the product, architecture, stack and cost lenses; a problem in
// the data layer runs only the related lenses; a finding without evidence becomes a question; duplicates across
// lenses merge; severity and confidence stay separate; strengths are kept.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LENSES, detectSubject, lensBrief, lensesFor, mergeFindings } from './audit.mjs'
import { run } from '../cli/main.mjs'

const io = (cwd) => { const o = { out: '', err: '' }; return [o, { stdout: (s) => { o.out += s }, stderr: (s) => { o.err += s }, cwd, env: {} }] }

test('given an idea, the product, architecture, stack and cost lenses run', () => {
  const d = detectSubject('a booking app for small dental clinics, with reminders by SMS')
  assert.equal(d.subject, 'idea')
  assert.match(d.question, /Audit this as an idea/)
  assert.deepEqual(lensesFor(d.subject), ['product', 'architecture', 'stack', 'performance-cost'])
})

test('given a problem in the data layer, only the related lenses run', () => {
  const d = detectSubject('the orders queries are slow since the last migration')
  assert.equal(d.subject, 'problem')
  assert.deepEqual(d.layers, ['data-layer'])
  const lenses = lensesFor(d.subject, { layers: d.layers })
  assert.deepEqual(lenses, ['architecture', 'security-privacy', 'performance-cost', 'operations'])
  for (const l of ['product', 'delivery', 'process', 'stack', 'code-quality']) assert.ok(!lenses.includes(l), l)
  assert.deepEqual(lensesFor('problem', { layers: d.layers, add: ['code-quality'], remove: ['security-privacy'] }), ['architecture', 'code-quality', 'performance-cost', 'operations'], 'lenses can be added and removed')
  assert.throws(() => lensesFor('problem', { add: ['vibes'] }), /unknown lens "vibes"/)
})

test('the subject is detected from folders, releases and issues', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-audit-'))
  try {
    mkdirSync(join(cwd, 'docs')); writeFileSync(join(cwd, 'docs/spec.md'), '# spec\n')
    mkdirSync(join(cwd, 'src')); writeFileSync(join(cwd, 'src/a.ts'), 'export {}\n')
    assert.equal(detectSubject('docs', { cwd }).subject, 'spec')
    assert.equal(detectSubject('.', { cwd }).subject, 'project')
    assert.equal(detectSubject('release', { cwd }).subject, 'release')
    assert.equal(detectSubject('#42', { cwd }).subject, 'problem')
    assert.deepEqual(lensesFor('project'), Object.keys(LENSES))
    assert.throws(() => detectSubject('  ', { cwd }), /what should be audited/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('each lens brief asks for evidence and turns what has none into a question', () => {
  const b = lensBrief('stack', { subject: 'idea', input: 'a booking app' })
  assert.match(b, /through the stack lens only/)
  assert.match(b, /catalog scores/)
  assert.match(b, /Evidence is required/)
  assert.match(b, /"question"/)
})

test('a finding without evidence becomes a question; duplicates merge; strengths are kept', () => {
  const r = mergeFindings([
    { lens: 'architecture', findings: [
      { title: 'No index on orders.customer_id', evidence: ['db/schema.sql:12'], severity: 'medium', confidence: 'likely', recommendation: 'add the index' },
      { title: 'The cache may be stale', severity: 'high', confidence: 'likely', recommendation: 'check it' },
    ], strengths: ['migrations are reviewed (db/migrations/README.md)'] },
    { lens: 'performance-cost', findings: [
      { title: 'no index on orders customer_id', evidence: ['EXPLAIN shows a seq scan'], severity: 'high', confidence: 'confirmed', recommendation: 'add the index', alternatives: ['partition by customer'] },
      { question: 'What is the expected load at peak?' },
      { title: 'Backups untested', evidence: ['#12'], severity: 'critical', confidence: 'to verify' },
    ] },
  ])
  assert.deepEqual(r.findings.map((f) => [f.title, f.severity, f.confidence]), [['Backups untested', 'critical', 'to verify'], ['No index on orders.customer_id', 'high', 'confirmed']])
  const idx = r.findings[1]
  assert.deepEqual(idx.lenses, ['architecture', 'performance-cost'])
  assert.deepEqual(idx.evidence, ['db/schema.sql:12', 'EXPLAIN shows a seq scan'])
  assert.deepEqual(r.questions.map((q) => q.lens), ['architecture', 'performance-cost'])
  assert.match(r.questions[0].question, /The cache may be stale: what shows it\? \(raised without evidence\)/)
  assert.equal(r.findings.some((f) => /cache/.test(f.title)), false, 'not reported as a finding')
  assert.equal(r.strengths.length, 1)
  assert.deepEqual(r.problems, ['"Backups untested" has no recommendation'])
})

test('agent-os audit plan and merge', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-audit-'))
  try {
    let [o, x] = io(cwd)
    assert.equal(await run(['audit', 'plan', 'a', 'booking', 'app', '--json'], x), 0)
    const plan = JSON.parse(o.out).result
    assert.equal(plan.subject, 'idea')
    assert.deepEqual(plan.briefs.map((b) => b.lens), plan.lenses)
    ;[o, x] = io(cwd)
    assert.equal(await run(['audit', 'plan', 'login fails', '--as', 'system', '--no-lens', 'operations'], x), 0)
    assert.match(o.out, /subject: system \(detected: problem\)/)
    assert.doesNotMatch(o.out, /lenses.*operations/)
    writeFileSync(join(cwd, 'a.json'), JSON.stringify({ lens: 'delivery', findings: [{ title: 'No required check', evidence: ['.github/workflows'], severity: 'high', confidence: 'confirmed', recommendation: 'require ci' }, { title: 'flaky tests' }] }))
    ;[o, x] = io(cwd)
    assert.equal(await run(['audit', 'merge', 'a.json'], x), 0)
    assert.match(o.out, /1 finding\(s\), 1 question\(s\)/)
    assert.match(o.out, /HIGH \(confirmed\) No required check {2}\[delivery\]/)
    assert.match(o.out, /\[delivery\] flaky tests: what shows it\?/)
    writeFileSync(join(cwd, 'bad.json'), 'nope')
    ;[o, x] = io(cwd)
    assert.equal(await run(['audit', 'merge', 'bad.json'], x), 2)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
