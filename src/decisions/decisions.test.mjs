// Tests for decision records: date-based ids that never collide across slugs, supersession through a new record, the
// checks (doctor), and the template in both languages.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkDecisions, newDecision, readDecisions, stateOf } from './decisions.mjs'
import { runDoctor } from '../doctor/doctor.mjs'

const tmp = () => mkdtempSync(join(tmpdir(), 'aos-decisions-'))
const day = new Date('2026-11-20T09:00:00Z')

test('two decisions on the same day with different slugs never collide; the same slug is refused', () => {
  const cwd = tmp()
  try {
    assert.equal(newDecision(cwd, { slug: 'cache-ttl', title: 'Cache the PR list for 10 minutes', now: day }).path, 'docs/decisions/2026-11-20-cache-ttl.md')
    assert.equal(newDecision(cwd, { slug: 'merge-commits', title: 'Releases use merge commits', now: day }).path, 'docs/decisions/2026-11-20-merge-commits.md')
    assert.throws(() => newDecision(cwd, { slug: 'cache-ttl', title: 'Again', now: day }), /already exists/)
    assert.deepEqual(readDecisions(cwd).map((d) => d.id), ['2026-11-20-cache-ttl', '2026-11-20-merge-commits'])
    assert.deepEqual(checkDecisions(cwd).problems, [], 'a new record from the template is valid')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('superseding is a new record; the old one only gets its status pointed at the successor', () => {
  const cwd = tmp()
  try {
    newDecision(cwd, { slug: 'squash', title: 'Releases are squashed', accepted: true, now: new Date('2026-11-01T00:00:00Z') })
    const before = readFileSync(join(cwd, 'docs/decisions/2026-11-01-squash.md'), 'utf8')
    newDecision(cwd, { slug: 'merge-commits', title: 'Releases use merge commits', supersedes: 'squash', now: day })
    const after = readFileSync(join(cwd, 'docs/decisions/2026-11-01-squash.md'), 'utf8')
    assert.equal(after, before.replace('Status: accepted', 'Status: superseded by [Releases use merge commits](2026-11-20-merge-commits.md)'))
    assert.match(readFileSync(join(cwd, 'docs/decisions/2026-11-20-merge-commits.md'), 'utf8'), /^Status: proposed · supersedes \[Releases are squashed\]\(2026-11-01-squash\.md\)$/m)
    assert.equal(stateOf(readDecisions(cwd)[0].statusLine), 'superseded')
    assert.throws(() => newDecision(cwd, { slug: 'other', title: 'x', supersedes: 'squash', now: day }), /already superseded/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('given a superseded record, doctor requires the link to its successor', () => {
  const cwd = tmp()
  try {
    mkdirSync(join(cwd, 'docs/decisions'), { recursive: true })
    const body = '\n\n## Context\nx\n\n## Decision\ny\n\n## Consequences\nz\n'
    writeFileSync(join(cwd, 'docs/decisions/2026-11-01-old.md'), `# Old\n\nStatus: superseded by the new one${body}`)
    writeFileSync(join(cwd, 'docs/decisions/2026-11-02-gone.md'), `# Gone\n\nStatus: superseded by [x](2026-12-01-missing.md)${body}`)
    writeFileSync(join(cwd, 'docs/decisions/0001-numbered.md'), '# N\n\nStatus: maybe\n')
    const config = { branches: { integration: 'development', production: 'main' }, languages: {}, contextBudgets: {}, slots: {} }
    const f = runDoctor({ cwd, config, running: '0.0.0' }, { offline: true, only: ['decisions'] }).checks[0].findings
    const msgs = f.map((x) => x.message)
    assert.ok(msgs.includes('docs/decisions/2026-11-01-old.md: it is superseded but its status does not link its successor'))
    assert.ok(msgs.includes('docs/decisions/2026-11-02-gone.md: it is superseded by 2026-12-01-missing.md, which does not exist'))
    assert.ok(msgs.some((m) => /0001-numbered\.md is not named <YYYY-MM-DD>-<slug>\.md/.test(m)))
    assert.ok(msgs.some((m) => /0001-numbered\.md: its status line is missing or unknown/.test(m)))
    assert.ok(f.every((x) => x.level === 'fail' && x.fix))
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('the template follows the docs language: ro headings and statuses, ASCII', () => {
  const cwd = tmp()
  try {
    newDecision(cwd, { slug: 'x', title: 'Decizie de test', lang: 'ro', now: day })
    const text = readFileSync(join(cwd, 'docs/decisions/2026-11-20-x.md'), 'utf8')
    assert.match(text, /^Stare: propusa$/m)
    assert.match(text, /^## Decizie$/m)
    assert.match(text, /^## Consecinte$/m)
    assert.ok(!/[ăâîșțşţ]/i.test(text))
    assert.deepEqual(checkDecisions(cwd).problems, [])
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test("this repository's decision records are valid", () => {
  assert.deepEqual(checkDecisions(join(import.meta.dirname, '..', '..')).problems, [])
})
