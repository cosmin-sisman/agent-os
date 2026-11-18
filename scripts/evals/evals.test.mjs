// The skill evals in npm test: every deterministic scenario passes (a destructive release asks, contradicting specs
// block, discover cites evidence, map and recall save steps and tokens); model scenarios are never reported as run.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runEvals } from './scenarios.mjs'

test('given a PR with a destructive migration fixture, /release asks; every deterministic eval passes', () => {
  const r = runEvals({ env: {} })
  for (const x of r.results) assert.ok(x.ok, `${x.id}: ${x.detail}`)
  assert.match(r.results.find((x) => x.id === 'release-asks').detail, /^ask first: db\/migrations\/002_drop_legacy\.sql contains "DROP TABLE"/)
  const map = r.results.find((x) => x.id === 'map-saves').metrics
  assert.ok(map.steps.map === 1 && map.steps.reading > 10 && map.tokens.map * 5 < map.tokens.reading, JSON.stringify(map))
  const rec = r.results.find((x) => x.id === 'recall-saves').metrics
  assert.ok(rec.lessons.recalled <= 3 && rec.tokens.recall * 5 < rec.tokens.reading, JSON.stringify(rec))
})

test('scenarios that need a model are skipped, with how to run them, unless explicitly opted in', () => {
  const r = runEvals({ env: {} })
  assert.ok(r.skipped.length >= 1)
  for (const s of r.skipped) assert.match(s.skipped, /set AGENT_OS_EVALS_MODEL to run it locally \(never in CI\)/)
  for (const s of runEvals({ env: { AGENT_OS_EVALS_MODEL: '1' } }).skipped) assert.match(s.skipped, /harness is not written yet: nothing ran/, 'never reported as run')
})
