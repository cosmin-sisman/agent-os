// Tests for release notes: change requests in a range, grouped by changelog and type labels, deprecations with their
// replacement, breaking changes with their migration, journal entries, and the changelog.yaml entry.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { changelogEntry, groupOf, mergedNumbers, notesMarkdown, releaseNotes } from './notes.mjs'
import { groupedChanges } from '../update/update.mjs'
import { parse } from '../yaml/yaml.mjs'
import { vocabularyFor } from '../platform/vocabulary.mjs'
import { run } from '../cli/main.mjs'

const VOCAB = vocabularyFor('github')
const SUBJECTS = ['feat(x): add a [#1] (#10)', 'fix(y): repair b (#11)', 'Merge pull request #12 from a/b', 'chore: no number', 'refactor(z): old c is deprecated [#3] (#13)', 'feat(api)!: rename d (#14)']
const PRS = {
  10: { title: 'feat(x): add a [#1]', labels: ['type:feature'], body: '' },
  11: { title: 'fix(y): repair b', labels: ['type:bug'], body: '' },
  12: { title: 'docs: c', labels: ['type:docs', 'changelog:new'], body: '' },
  13: { title: 'refactor(z): old c is deprecated [#3]', labels: ['type:chore', 'changelog:deprecation'], body: '## What\n\nReplacement: `agent-os setup --only files`\n' },
  14: { title: 'feat(api)!: rename d', labels: ['type:feature', 'changelog:breaking'], body: 'Migration: migrations/0.2.0.mjs' },
}
const git = (subjects = SUBJECTS, added = ['.agent-os/journal/2026/11/2026-11-18T10-00-ana-pin.md']) => (args) => {
  if (args[0] === 'log') return { status: 0, stdout: subjects.join('\n'), stderr: '' }
  if (args[0] === 'diff') return { status: 0, stdout: added.join('\n'), stderr: '' }
  return { status: 1, stdout: '', stderr: 'bad revision' }
}
const tracker = (prs = PRS) => ({ get: (n) => ({ number: n, url: `u/${n}`, ...prs[n] }) })
function cwdWithJournal() {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-notes-'))
  mkdirSync(join(cwd, '.agent-os/journal/2026/11'), { recursive: true })
  writeFileSync(join(cwd, '.agent-os/journal/2026/11/2026-11-18T10-00-ana-pin.md'), '---\ntype: decision\nrefs: ["#14"]\nareas: [api]\nauthor: ana\n---\n\n# Pin merges to the checked sha\n')
  return cwd
}

test('the range gives squash and merge-commit numbers, once each', () => {
  assert.deepEqual(mergedNumbers(git()), [10, 11, 12, 13, 14])
  assert.throws(() => mergedNumbers(() => ({ status: 128, stdout: '' }), 'v9'), /cannot read the history v9\.\.HEAD/)
})

test('groups come from changelog labels first, then type labels, then the title type', () => {
  assert.equal(groupOf({ labels: ['type:feature', 'changelog:breaking'] }), 'breaking')
  assert.equal(groupOf({ labels: ['tip:bug'] }), 'fix')
  assert.equal(groupOf({ title: 'perf: faster' }), 'fix')
  assert.equal(groupOf({ title: 'feat(x)!: drop y' }), 'breaking')
  assert.equal(groupOf({ title: 'whatever' }), 'chore')
})

test('given a PR labelled changelog:deprecation, it appears under Deprecated with its replacement', () => {
  const cwd = cwdWithJournal()
  try {
    const notes = releaseNotes({ git: git(), tracker: tracker(), cwd, vocab: VOCAB }, { from: 'v0.1.0', version: '0.2.0' })
    assert.deepEqual(notes.groups.deprecated, [{ number: 13, title: 'refactor(z): old c is deprecated', url: 'u/13', group: 'deprecated', replacement: 'agent-os setup --only files' }])
    assert.deepEqual(notes.problems, [])
    const md = notesMarkdown(notes, VOCAB)
    assert.match(md, /## Deprecated\n\n- refactor\(z\): old c is deprecated \(#13\)\. Use instead: agent-os setup --only files/)
    assert.match(md, /## Breaking\n\n- feat\(api\)!: rename d \(#14\)\. Migration: `migrations\/0\.2\.0\.mjs`/)
    assert.match(md, /## New\n\n- feat\(x\): add a \(#10\)\n- docs: c \(#12\)/)
    assert.match(md, /## Fixes\n\n- fix\(y\): repair b \(#11\)/)
    assert.match(md, /## Decisions and incidents\n\n- Pin merges to the checked sha/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('every breaking item links its migration; a deprecation without a replacement is a problem', () => {
  const cwd = cwdWithJournal()
  try {
    const prs = { ...PRS, 13: { ...PRS[13], body: '' }, 14: { ...PRS[14], body: '' } }
    const notes = releaseNotes({ git: git(), tracker: tracker(prs), cwd, vocab: VOCAB }, { from: 'v0.1.0', version: '0.2.0' })
    assert.equal(notes.problems.length, 2)
    assert.match(notes.problems[0], /#13 deprecates something but names no replacement/)
    assert.match(notes.problems[1], /#14 is breaking but names no migration: add "Migration: migrations\/0\.2\.0\.mjs"/)
    mkdirSync(join(cwd, 'migrations'))
    writeFileSync(join(cwd, 'migrations/0.2.0.mjs'), 'export function migrate() {}')
    const withFile = releaseNotes({ git: git(), tracker: tracker(prs), cwd, vocab: VOCAB }, { from: 'v0.1.0', version: '0.2.0' })
    assert.equal(withFile.groups.breaking[0].migration, 'migrations/0.2.0.mjs', 'the version migration counts')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('the changelog entry round-trips into update --plan', () => {
  const cwd = cwdWithJournal()
  try {
    const notes = releaseNotes({ git: git(), tracker: tracker(), cwd, vocab: VOCAB }, { from: 'v0.1.0', version: '0.2.0' })
    const entry = changelogEntry(notes, { date: '2026-12-01' })
    const g = groupedChanges({ from: '0.1.0', to: '0.2.0', changelog: [entry], manifest: { items: {} } })
    assert.deepEqual(g.breaking.map((c) => [c.text, c.migration]), [['feat(api)!: rename d', 'migrations/0.2.0.mjs']])
    assert.deepEqual(g.deprecated.map((c) => c.text), ['refactor(z): old c is deprecated (use instead: agent-os setup --only files)'])
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('release notes --changelog writes changelog.yaml locally, keeping its header; --dry-run writes nothing; nothing is published', async () => {
  const cwd = cwdWithJournal()
  try {
    writeFileSync(join(cwd, 'agent-os.json'), JSON.stringify({ platform: { type: 'github', project: 'acme/app' } }))
    writeFileSync(join(cwd, 'changelog.yaml'), '# header line\nreleases: []\n')
    const io = (extra = {}) => ({ stdout: () => {}, stderr: () => {}, cwd, env: {}, tracker: tracker(), git: git(), now: new Date('2026-12-01T00:00:00Z'), ...extra })
    assert.equal(await run(['release', 'notes', '--from', 'v0.1.0', '--version', '0.2.0', '--changelog', '--dry-run'], io()), 0)
    assert.equal(readFileSync(join(cwd, 'changelog.yaml'), 'utf8'), '# header line\nreleases: []\n')
    assert.equal(await run(['release', 'notes', '--from', 'v0.1.0', '--version', '0.2.0', '--changelog'], io()), 0)
    const text = readFileSync(join(cwd, 'changelog.yaml'), 'utf8')
    assert.match(text, /^# header line\n/)
    assert.equal(parse(text).releases[0].version, '0.2.0')
    let err = ''
    const bad = { ...PRS, 14: { ...PRS[14], body: '' } }
    assert.equal(await run(['release', 'notes', '--from', 'v0.1.0', '--version', '0.2.0'], io({ tracker: tracker(bad), stderr: (s) => { err += s } })), 1)
    assert.match(err, /problem: #14 is breaking but names no migration/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
