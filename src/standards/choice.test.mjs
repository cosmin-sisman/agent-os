// Tests for the standards decision procedure: two or three candidates, one picked, the reason in one sentence, only the
// chosen one implemented, and the record for hard-to-reverse choices.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { choiceMarkdown, makeChoice } from './choice.mjs'
import { run } from '../cli/main.mjs'
import { checkDecisions } from '../decisions/decisions.mjs'

test('given two caching approaches, the procedure names both, picks one and states why in one sentence', () => {
  const c = makeChoice({ options: ['lru: an in-process LRU cache per instance', 'redis: a shared Redis cache'], pick: 'lru', why: 'One instance serves this traffic, so a shared cache only adds a moving part', criteria: { simplicity: 'no new service', performance: 'hits stay in memory' } })
  const md = choiceMarkdown(c)
  assert.match(md, /^- \*\*lru\*\*: an in-process LRU cache per instance ← chosen\n- \*\*redis\*\*: a shared Redis cache\n/)
  assert.match(md, /\*\*Choice: lru\.\*\* One instance serves this traffic, so a shared cache only adds a moving part\.\nOnly lru is implemented; redis is not\.$/)
})

test('a choice needs two or three candidates, a pick among them and a one-sentence reason', () => {
  const ok = { options: ['a: one', 'b: two'], pick: 'a', why: 'Simpler.' }
  assert.throws(() => makeChoice({ ...ok, options: ['a: one'] }), /at least two candidates/)
  assert.throws(() => makeChoice({ ...ok, options: ['a: 1', 'b: 2', 'c: 3', 'd: 4'] }), /two or three candidates/)
  assert.throws(() => makeChoice({ ...ok, pick: 'z' }), /--pick must be one of a, b/)
  assert.throws(() => makeChoice({ ...ok, why: 'Simpler. Also faster.' }), /one sentence/)
  assert.throws(() => makeChoice({ ...ok, why: '' }), /--why is required/)
  assert.throws(() => makeChoice({ ...ok, criteria: { vibes: 'x' } }), /unknown criteria: vibes/)
  assert.throws(() => makeChoice({ ...ok, options: ['just text', 'b: two'] }), /"<id>: <one line>"/)
})

test('--record turns a hard-to-reverse choice into an accepted decision record with the comparison', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-choice-'))
  try {
    writeFileSync(join(cwd, 'agent-os.json'), '{}')
    let stdout = ''
    const code = await run(['standards', 'choice', '--title', 'Cache for the catalog API', '--option', 'lru: in-process LRU', '--option', 'redis: shared Redis', '--pick', 'lru', '--why', 'One instance is enough today', '--record', 'catalog-cache'], { stdout: (s) => { stdout += s }, stderr: () => {}, cwd, env: {}, now: new Date('2026-11-20T10:00:00Z') })
    assert.equal(code, 0)
    const text = readFileSync(join(cwd, 'docs/decisions/2026-11-20-catalog-cache.md'), 'utf8')
    assert.match(text, /^Status: accepted$/m)
    assert.match(text, /## Decision\n- \*\*lru\*\*: in-process LRU ← chosen\n- \*\*redis\*\*: shared Redis\n\n\*\*Choice: lru\.\*\* One instance is enough today\./)
    assert.deepEqual(checkDecisions(cwd).problems, [])
    assert.match(stdout, /recorded in docs\/decisions\/2026-11-20-catalog-cache\.md/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('the /standards skill carries the procedure and the review order', () => {
  const skill = readFileSync(join(import.meta.dirname, '..', '..', 'templates/core/.claude/skills/standards/SKILL.md'), 'utf8')
  for (const must of [/\*\*two or three\*\* candidates/, /\*\*in one sentence\*\*/, /Implement \*\*only the chosen one\*\*/, /agent-os standards choice/, /--record <slug>/]) assert.match(skill, must)
})
