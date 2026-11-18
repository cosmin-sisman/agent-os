// Tests for /retro: themes and proposals, the repeated review finding that becomes a rule, every inbox entry decided,
// counters from the journal with retro as their only writer, and the Retro issue body.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyRetro, findingKey, repeatedFindings, retroIssueBody, retroPlan } from './retro.mjs'
import { readLessons } from '../lessons/lessons.mjs'

const card = (meta, body) => `---\n${meta}\n---\n\n${body}\n`
function store() {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-retro-'))
  const w = (p, c) => { mkdirSync(join(cwd, p, '..'), { recursive: true }); writeFileSync(join(cwd, p), c) }
  w('.agent-os/lessons/active/pin-actions.md', card('areas: [ci]\nkeywords: [actions]\nsource: "#20"\nrecalled: 0\nfollowed: 0', 'Pin GitHub Actions by commit SHA. Tags move. Example: checkout.'))
  w('.agent-os/lessons/inbox/2026-11-18T10-00-ana-yaml-a.md', card('areas: [i18n]\nkeywords: [yaml]\nsource: "#11"', 'Quote hex colors in YAML files. 000000 is a number. Example.'))
  w('.agent-os/lessons/inbox/2026-11-18T11-00-dan-yaml-b.md', card('areas: [i18n]\nkeywords: [yaml]\nsource: "#12"', 'Quote version strings in YAML. 1.10 becomes 1.1. Example.'))
  w('.agent-os/lessons/inbox/2026-11-18T12-00-ana-pin-again.md', card('areas: [ci]\nkeywords: [actions]\nsource: "#30"', 'Pin GitHub Actions by commit SHA because tags move. Example.'))
  w('.agent-os/lessons/inbox/2026-11-18T13-00-ana-db-only.md', card('areas: [db]\npaths: ["db/**"]\nsource: "#40"\nconfidence: medium', 'Run migrations in a transaction on this database. Why. Example.'))
  w('.agent-os/journal/2026/11/2026-11-18T14-00-ana-x.md', '---\ntype: decision\nrefs: []\nareas: [ci]\nauthor: ana\n---\n\n# X\n\nRecalled pin-actions; followed pin-actions in the workflow.\n')
  w('.agent-os/journal/2026/11/2026-11-18T15-00-ana-y.md', '---\ntype: decision\nrefs: []\nareas: [ci]\nauthor: ana\n---\n\n# Y\n\nlesson pin-actions came back again.\n')
  return cwd
}
const threads = (body, path = 'src/a.ts') => [{ id: 't', path, comments: [{ author: 'dan', body }] }]

test('given the same review finding on three PRs, /retro proposes a rule', () => {
  const tracker = { reviewThreads: (n) => ({ 40: threads('Please avoid `any` here; use a precise type.'), 41: threads('please avoid any here, use a precise type', 'src/b.ts'), 42: threads('Avoid `any` here: use a precise type please.'), 43: threads('Rename this variable.') })[n] ?? [] }
  const f = repeatedFindings(tracker, [40, 41, 42, 43])
  assert.deepEqual(f.map((x) => [x.prs, x.paths]), [[[40, 41, 42], ['src/a.ts', 'src/b.ts']]])
  const cwd = store()
  try {
    const plan = retroPlan({ cwd, tracker, recent: [40, 41, 42, 43] })
    const rule = plan.proposals.find((p) => p.finding)
    assert.equal(rule.action, 'rule')
    assert.equal(rule.reason, 'the same review finding on #40, #41, #42')
    assert.equal(findingKey('Avoid `any` here: use a precise type please.'), findingKey('please avoid any here, use a precise type'))
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('the inbox is grouped by theme; each lesson gets a proposal with a reason', () => {
  const cwd = store()
  try {
    const plan = retroPlan({ cwd })
    assert.equal(plan.inbox, 4)
    const by = Object.fromEntries(plan.proposals.map((p) => [p.id.split('-ana-').pop().split('-dan-').pop(), [p.action, p.reason]]))
    assert.deepEqual(by['yaml-a'], ['rule', '2 lessons on i18n point the same way'])
    assert.deepEqual(by['pin-again'], ['reject', 'it repeats the active card pin-actions'])
    assert.deepEqual(by['db-only'], ['card', 'specific to some paths: recall it as a card'])
    assert.deepEqual(plan.counters['pin-actions'], { recalled: 2, followed: 1 })
    assert.match(retroIssueBody(plan), /^4 lesson\(s\) wait in the inbox\./)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('every inbox entry ends as a rule, a card, or rejected with a reason; the counters are written by retro only', () => {
  const cwd = store()
  try {
    assert.throws(() => applyRetro(cwd, { accept: ['db-only'] }), /3 inbox lesson\(s\) have no decision/)
    assert.throws(() => applyRetro(cwd, { accept: ['db-only'], promote: { 'yaml-a': 'r', 'yaml-b': 'r' }, reject: { 'pin-again': '' } }), /needs a reason/)
    const decisions = { accept: ['db-only'], promote: { 'yaml-a': '.claude/rules/yaml.md', 'yaml-b': '.claude/rules/yaml.md' }, reject: { 'pin-again': 'repeats pin-actions' } }
    const before = readLessons(cwd).map((c) => [c.id, c.state])
    const dry = applyRetro(cwd, decisions, { dryRun: true })
    assert.deepEqual(dry.done.map((d) => d.action).sort(), ['card', 'rejected', 'rule', 'rule'])
    assert.deepEqual(readLessons(cwd).map((c) => [c.id, c.state]), before, 'a dry run writes nothing')
    assert.throws(() => applyRetro(cwd, { ...decisions, accept: ['db-only', 'nope'] }, { dryRun: true }), /no inbox lesson "nope"/)
    const r = applyRetro(cwd, { accept: ['db-only'], promote: { 'yaml-a': '.claude/rules/yaml.md', 'yaml-b': '.claude/rules/yaml.md' }, reject: { 'pin-again': 'repeats pin-actions' } })
    assert.deepEqual(r.done.map((d) => d.action).sort(), ['card', 'rejected', 'rule', 'rule'])
    const all = readLessons(cwd)
    assert.equal(all.filter((c) => c.state === 'inbox').length, 0)
    assert.deepEqual(all.filter((c) => c.state === 'retired').map((c) => c.meta.retiredBecause).sort(), ['promoted to .claude/rules/yaml.md', 'promoted to .claude/rules/yaml.md', 'rejected: repeats pin-actions'])
    assert.match(readFileSync(join(cwd, '.agent-os/lessons/active/pin-actions.md'), 'utf8'), /^recalled: 2\nfollowed: 1$/m)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
