// Tests for the journal: unique names so branches never conflict, the schema, sorting, filters, and the ro ASCII rule.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { addEntry, filterEntries, readJournal, slugify, splitEntry, stampOf, validate } from './journal.mjs'

/** Merges a branch's journal into a tree the way git would, failing if any file already exists (a conflict). */
function mergeInto(target, source) {
  for (const f of readdirSync(join(source, '.agent-os'), { recursive: true, withFileTypes: true }).filter((d) => d.isFile())) {
    const rel = relative(source, join(f.parentPath, f.name))
    assert.equal(existsSync(join(target, rel)), false, `conflict on ${rel}`)
    mkdirSync(dirname(join(target, rel)), { recursive: true })
    writeFileSync(join(target, rel), readFileSync(join(source, rel)))
  }
}
const tmp = () => mkdtempSync(join(tmpdir(), 'aos-journal-'))
const entry = (over = {}) => ({ type: 'decision', title: 'Use one file per entry', areas: ['knowledge'], refs: ['#22'], author: 'ana', at: new Date('2026-11-18T14:02:30Z'), ...over })

test('names are <UTC minute>-<author>-<slug>.md in YYYY/MM', () => {
  const dir = tmp()
  try {
    const r = addEntry(dir, entry())
    assert.equal(r.path, '.agent-os/journal/2026/11/2026-11-18T14-02-ana-use-one-file-per-entry.md')
    assert.equal(readFileSync(join(dir, r.path), 'utf8'), '---\ntype: decision\nrefs: ["#22"]\nareas: [knowledge]\nauthor: ana\n---\n\n# Use one file per entry\n')
    assert.equal(stampOf(new Date('2026-01-05T09:07:00+02:00')), '2026-01-05T07-07')
    assert.equal(slugify('Lecție: țărm și ȘOSEA!'), 'lectie-tarm-si-sosea')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('given two branches adding entries, the files never collide, and both survive a merge in any order', () => {
  const main = tmp()
  const a = tmp()
  const b = tmp()
  try {
    // the same minute, two people, and the same person twice with the same title
    addEntry(a, entry({ author: 'ana', at: new Date('2026-11-18T14:05:00Z') }))
    addEntry(b, entry({ author: 'dan', at: new Date('2026-11-18T14:02:00Z') }))
    const again = addEntry(a, entry({ author: 'ana', at: new Date('2026-11-18T14:05:10Z') }))
    assert.match(again.path, /-ana-use-one-file-per-entry-2\.md$/)
    for (const order of [[a, b], [b, a]]) {
      const merged = tmp()
      try {
        for (const src of order) mergeInto(merged, src)
        const list = readJournal(merged)
        assert.deepEqual(list.map((e) => `${e.at} ${e.meta.author}`), ['2026-11-18T14:02Z dan', '2026-11-18T14:05Z ana', '2026-11-18T14:05Z ana'])
      } finally { rmSync(merged, { recursive: true, force: true }) }
    }
  } finally { for (const d of [main, a, b]) rmSync(d, { recursive: true, force: true }) }
})

test('validate names each problem', () => {
  const bad = { name: '2026-11-18T14-02-ana-x.md', folder: '2026/10', ...splitEntry('---\ntype: memo\nrefs: "#1"\nareas: []\nauthor: dan\n---\nno title\n') }
  assert.deepEqual(validate(bad), [
    'it is in 2026/10, its name says 2026/11',
    'type must be one of decision, lesson, incident, release, handoff, note (found "memo")',
    'refs must be a list, for example ["#12", "!40"] (it can be empty)',
    'areas must be a list with at least one area',
    'the file name must carry the author after the time: …T14-02-dan-<slug>.md',
    'the body needs a "# Title" line',
  ])
  assert.deepEqual(validate({ name: 'notes.md', folder: '', ...splitEntry('# just text') }), ['no front matter (a block between --- lines at the top)'])
  const ok = { name: '2026-11-18T14-02-ana-x.md', folder: '2026/11', ...splitEntry('---\ntype: note\nrefs: ["#1", "!40", "&3", "2026-11-18-journal-not-memory-file"]\nareas: [ci]\nauthor: ana\n---\n\n# X\n') }
  assert.deepEqual(validate(ok), [])
  assert.match(validate({ ...ok, ...splitEntry('---\ntype: note\nrefs: ["PR 40"]\nareas: [ci]\nauthor: ana\n---\n# X\n') })[0], /ref "PR 40" is not #N/)
})

test('a ro journal must be ASCII; add refuses diacritics and writes nothing', () => {
  const dir = tmp()
  try {
    const r = addEntry(dir, entry({ title: 'Decizie: fișier separat', lang: 'ro' }))
    assert.equal(r.written, false)
    assert.match(r.problems[0], /"ș" \(journal is ro, ASCII only: write "s"\)/)
    assert.deepEqual(readJournal(dir), [])
    assert.equal(addEntry(dir, entry({ title: 'Decizie: fisier separat', lang: 'ro' })).written, true)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('filters by type, area, ref, author and dates; README and non-md files are ignored', () => {
  const dir = tmp()
  try {
    addEntry(dir, entry({ type: 'lesson', areas: ['ci'], refs: ['#5'], author: 'ana', at: new Date('2026-11-01T10:00:00Z') }))
    addEntry(dir, entry({ areas: ['skills'], refs: ['#6'], author: 'dan', at: new Date('2026-11-20T10:00:00Z') }))
    mkdirSync(join(dir, '.agent-os/journal'), { recursive: true })
    writeFileSync(join(dir, '.agent-os/journal/README.md'), '# Journal')
    writeFileSync(join(dir, '.agent-os/journal/2026/11/.keep'), '')
    const all = readJournal(dir)
    assert.equal(all.length, 2)
    const ids = (f) => filterEntries(all, f).map((e) => e.meta.author)
    assert.deepEqual(ids({ type: 'lesson' }), ['ana'])
    assert.deepEqual(ids({ area: 'skills' }), ['dan'])
    assert.deepEqual(ids({ ref: '#5' }), ['ana'])
    assert.deepEqual(ids({ author: 'dan' }), ['dan'])
    assert.deepEqual(ids({ since: '2026-11-02' }), ['dan'])
    assert.deepEqual(ids({ until: '2026-11-01' }), ['ana'])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("this repository's own journal is valid", () => {
  const problems = readJournal(join(import.meta.dirname, '..', '..')).flatMap((e) => validate(e).map((p) => `${e.path}: ${p}`))
  assert.deepEqual(problems, [])
})
