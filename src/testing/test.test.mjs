// Tests for /test: scenario planning (a bug's regression scenario first, criteria into scenarios, no duplicates), the
// section written into the issue, test gaps, the results block in the change request, and /ship refusing unticked
// scenarios.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { expectedTests, planScenarios, sectionText, testGaps, untickedScenarios, withResults, withScenarios } from './test.mjs'
import { ship } from '../workflow/ship.mjs'
import { vocabularyFor } from '../platform/vocabulary.mjs'

const BUG = { title: 'Login: the session expires after five minutes', labels: ['type:bug'], body: '### What happens\n\nThe session expires after 5 minutes.\n\n### What should happen\n\nThe session lasts 8 hours.\n\n### How to reproduce\n\n1. Log in and wait six minutes\n2. Reload\n\n### Test scenarios\n\n_No response_\n' }

test('given a bug issue, plan adds a regression scenario that must fail before the fix', () => {
  const p = planScenarios(BUG)
  assert.deepEqual(p.existing, [])
  assert.deepEqual(p.proposed, ['Given Log in and wait six minutes, when it runs, then The session lasts 8 hours (not "The session expires after 5 minutes") (regression test: it fails before the fix)'])
  const ro = planScenarios({ ...BUG, labels: ['tip:bug'] }, { lang: 'ro' })
  assert.match(ro.proposed[0], /^Dat fiind .*\(test de regresie: pica inainte de fix\)$/)
})

test('feature criteria become scenarios; existing ones are kept and not proposed twice', () => {
  const body = '## Goal\n\nX.\n\n## Acceptance criteria\n\n- [ ] never exceeds the budget\n- [ ] never blocks the session\n\n## Test scenarios\n\n- [ ] Given …, when …, then never exceeds the budget\n'
  const p = planScenarios({ title: 't', labels: ['type:feature'], body })
  assert.deepEqual(p.existing.map((e) => e.text), ['Given …, when …, then never exceeds the budget'])
  assert.deepEqual(p.proposed, ['Given …, when …, then never blocks the session'])
  const merged = withScenarios(body, p.proposed)
  assert.deepEqual(sectionText(merged, ['Test scenarios']).split('\n'), ['- [ ] Given …, when …, then never exceeds the budget', '- [ ] Given …, when …, then never blocks the session'])
  assert.match(withScenarios('Only text.', ['Given a, when b, then c']), /Only text\.\n\n## Test scenarios\n\n- \[ \] Given a, when b, then c\n$/)
})

test('gaps: changed source files without a changed test that names them; tests, docs, fixtures and exclusions are not gaps', () => {
  const files = ['src/a.mjs', 'src/a.test.mjs', 'src/b.ts', 'app/models/user.py', 'tests/test_user.py', 'docs/x.md', 'src/__fixtures__/f.mjs', 'gen/api.ts', 'cmd/run.go']
  assert.deepEqual(testGaps(files, { exclude: ['gen/'] }), ['src/b.ts', 'cmd/run.go'])
})

test('gaps follow testing.map: mapped sources need one of their named tests; excluded globs are never gaps', () => {
  const map = { 'lib/**/*.rb': ['spec/{name}_spec.rb'], 'src/**/*.ts': ['{dir}/{name}.test.ts', '{dir}/{name}.check.ts'] }
  assert.deepEqual(expectedTests('src/x/a.ts', map['src/**/*.ts']), ['src/x/a.test.ts', 'src/x/a.check.ts'])
  const files = ['lib/billing/invoice.rb', 'spec/invoice_spec.rb', 'lib/tax.rb', 'src/a.ts', 'src/b.ts', 'src/b.check.ts', 'src/gen/schema.ts']
  assert.deepEqual(testGaps(files, { map, exclude: ['src/gen/**'] }), ['lib/tax.rb', 'src/a.ts'])
})

test('the results table goes into its own block in the change request, replaced on every run', () => {
  const body = '## What\n\nX\n\n## How it was tested\n\nBy hand.\n\n## Lessons\n\nNone: x'
  const once = withResults(body, '| a | passed |')
  assert.match(once, /## How it was tested\n\n<!-- agent-os:test-results -->\n\| a \| passed \|\n<!-- \/agent-os:test-results -->\n\nBy hand\./)
  const twice = withResults(once, '| a | failed |')
  assert.equal((twice.match(/<!-- agent-os:test-results -->/g) ?? []).length, 1, 'one block, replaced')
  assert.match(twice, /\| a \| failed \|/)
  assert.doesNotMatch(twice, /passed/)
})

test('/ship refuses while the scenarios of an issue it closes are not ticked', () => {
  assert.deepEqual(untickedScenarios('## Test scenarios\n\n- [x] done one\n- [ ] open one\n'), ['open one'])
  const status = { number: 160, title: 't', body: 'Closes #4', author: 'ana', base: 'development', branch: 'feat/4-y', fork: false, state: 'open', draft: false, mergeable: 'MERGEABLE', mergeState: 'CLEAN', review: null, head: 'abc', checks: 'success', failing: [], pending: [], all: [] }
  const calls = []
  const tracker = { pullRequestStatus: () => status, get: () => ({ state: 'open', body: '## Test scenarios\n\n- [ ] Given x, when y, then z\n' }), mergePullRequest: () => { calls.push('merge'); return { merged: true } } }
  const r = ship({ config: { branches: { integration: 'development', production: 'main' } }, tracker, caps: {}, git: () => ({ status: 1 }), vocab: vocabularyFor('github') }, { number: 160 })
  assert.equal(r.shipped, false)
  assert.match(r.problems[0].problem, /1 test scenario\(s\) not ticked: #4: Given x, when y, then z/)
  assert.deepEqual(calls, [])
})
