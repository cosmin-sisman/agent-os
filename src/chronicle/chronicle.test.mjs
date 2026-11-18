// Tests for the chronicle: one sorted timeline from platform events and the journal, every line linked, the issue
// filter following the change requests that close it, the area filter, and the GitHub activity reader.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chronicle, chronicleMarkdown, writeChronicle, CACHE_MD } from './chronicle.mjs'
import { vocabularyFor } from '../platform/vocabulary.mjs'
import { GitHubTracker } from '../tracker/github.mjs'
import { ghClient } from '../tracker/gh.mjs'
import { fakeGh } from '../tracker/__fixtures__/fake-gh.mjs'

const VOCAB = vocabularyFor('github')
const EVENTS = [
  { at: '2026-11-10T09:00:00Z', kind: 'issue-opened', number: 5, title: 'Releases', actor: 'ana', url: 'https://x/issues/5', labels: ['area:release'], body: '', cr: false },
  { at: '2026-11-11T10:00:00Z', kind: 'comment', number: 5, title: 'Releases', actor: 'dan', url: 'https://x/issues/5#c1', labels: ['area:release'], body: 'Decision: releases use merge commits, never squash.', cr: false },
  { at: '2026-11-12T08:00:00Z', kind: 'cr-opened', number: 9, title: 'feat(release): merge commits [#5]', actor: 'ana', url: 'https://x/pull/9', labels: ['area:release'], body: '## Why\n\nCloses #5', cr: true },
  { at: '2026-11-12T12:00:00Z', kind: 'review', number: 9, title: 'feat(release): merge commits [#5]', actor: 'dan', url: 'https://x/pull/9#r1', labels: [], body: 'approved', cr: true },
  { at: '2026-11-13T15:00:00Z', kind: 'cr-merged', number: 9, title: 'feat(release): merge commits [#5]', actor: 'ana', url: 'https://x/pull/9', labels: ['area:release'], body: '## Why\n\nCloses #5', cr: true },
  { at: '2026-11-13T09:00:00Z', kind: 'issue-opened', number: 7, title: 'Docs typo', actor: 'ioan', url: 'https://x/issues/7', labels: ['area:docs'], body: '', cr: false },
  { at: '2026-11-14T00:00:00Z', kind: 'release', number: null, title: 'v0.2.0', actor: 'ana', url: 'https://x/releases/v0.2.0', labels: [], body: '', cr: false },
]
function cwdWithJournal() {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-chron-'))
  mkdirSync(join(cwd, '.agent-os/journal/2026/11'), { recursive: true })
  writeFileSync(join(cwd, '.agent-os/journal/2026/11/2026-11-13T14-00-ana-merge-commits.md'), '---\ntype: decision\nrefs: ["#9", "#5"]\nareas: [release]\nauthor: ana\n---\n\n# Releases use merge commits\n')
  writeFileSync(join(cwd, '.agent-os/journal/2026/11/2026-11-01T14-00-ana-old.md'), '---\ntype: note\nrefs: []\nareas: [release]\nauthor: ana\n---\n\n# Before the range\n')
  return cwd
}
const tracker = { activity: (since) => EVENTS.filter((e) => e.at >= since) }

test('given a decision made in an issue comment, the chronicle shows the comment and the PR that implemented it', () => {
  const cwd = cwdWithJournal()
  try {
    const c = chronicle({ tracker, cwd, vocab: VOCAB }, { since: '2026-11-01', issue: 5 })
    assert.deepEqual(c.related, [5, 9])
    assert.deepEqual(c.lines.map((l) => l.text), [
      'issue #5 Releases opened by @ana',
      'issue #5 Releases comment by @dan: "Decision: releases use merge commits, never squash."',
      'PR #9 feat(release): merge commits [#5] opened by @ana',
      'PR #9 feat(release): merge commits [#5] review by @dan: "approved"',
      'journal decision: Releases use merge commits by @ana',
      'PR #9 feat(release): merge commits [#5] merged by @ana',
    ])
    assert.ok(c.lines.every((l) => l.url), 'each line links its source')
    assert.match(chronicleMarkdown(c), /^# Chronicle since 2026-11-01 for #5 \(with #9\)\n\n- 2026-11-10 09:00 {2}\[issue #5 Releases opened by @ana\]\(https:\/\/x\/issues\/5\)/)
    assert.match(chronicleMarkdown(c), /\]\(\.\.\/\.\.\/\.agent-os\/journal\/2026\/11\/2026-11-13T14-00-ana-merge-commits\.md\)/, 'journal links work from the cache folder')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('without filters, everything in the range, sorted; the area filter keeps one area; the render goes to the cache', () => {
  const cwd = cwdWithJournal()
  try {
    const all = chronicle({ tracker, cwd, vocab: VOCAB }, { since: '2026-11-13' })
    assert.deepEqual(all.lines.map((l) => l.at), [...all.lines.map((l) => l.at)].sort())
    assert.ok(all.lines.some((l) => l.text === 'v0.2.0 released by @ana'))
    assert.ok(!all.lines.some((l) => l.text.includes('Before the range')))
    const docs = chronicle({ tracker, cwd, vocab: VOCAB }, { since: '2026-11-01', area: 'docs' })
    assert.deepEqual(docs.lines.map((l) => l.text), ['issue #7 Docs typo opened by @ioan'])
    writeChronicle(cwd, all)
    assert.ok(existsSync(join(cwd, CACHE_MD)))
    assert.match(readFileSync(join(cwd, CACHE_MD), 'utf8'), /^# Chronicle since 2026-11-13/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('the GitHub activity reader turns issues, comments, reviews, milestones and releases into events', () => {
  const R = 'repos/acme/app'
  const since = '2026-11-10T00:00:00Z'
  const gh = fakeGh({
    [`GET ${R}/issues?state=all&sort=updated&direction=desc&since=${encodeURIComponent(since)}&per_page=100&page=1`]: [
      { number: 5, title: 'Releases', html_url: 'u5', created_at: '2026-11-10T09:00:00Z', closed_at: '2026-11-13T15:01:00Z', user: { login: 'ana' }, labels: [{ name: 'area:release' }], body: '' },
      { number: 9, title: 'PR', html_url: 'u9', created_at: '2026-11-12T08:00:00Z', closed_at: '2026-11-13T15:00:00Z', user: { login: 'ana' }, labels: [], body: 'Closes #5', pull_request: { merged_at: '2026-11-13T15:00:00Z' } },
      { number: 3, title: 'Old', html_url: 'u3', created_at: '2026-10-01T00:00:00Z', closed_at: null, user: { login: 'x' }, labels: [], body: '' },
    ],
    [`GET ${R}/issues/comments?sort=created&direction=asc&since=${encodeURIComponent(since)}&per_page=100&page=1`]: [{ issue_url: 'https://api/x/issues/5', created_at: '2026-11-11T10:00:00Z', user: { login: 'dan' }, html_url: 'c1', body: 'Decision: merge commits' }],
    [`GET ${R}/pulls/9/reviews?per_page=100`]: [{ submitted_at: '2026-11-12T12:00:00Z', state: 'APPROVED', user: { login: 'dan' }, html_url: 'r1' }],
    [`GET ${R}/milestones?state=all&per_page=100&page=1`]: [{ title: 'Release 1 - 2026-11-14', created_at: '2026-09-01T00:00:00Z', closed_at: '2026-11-14T00:00:00Z', html_url: 'm1' }],
    [`GET ${R}/releases?per_page=100&page=1`]: [{ name: 'v0.2.0', published_at: '2026-11-14T00:00:00Z', author: { login: 'ana' }, html_url: 'rel' }],
  })
  const t = new GitHubTracker({ repo: 'acme/app' }, ghClient(gh, { backoffMs: 1 }))
  const kinds = t.activity(since).map((e) => `${e.kind}:${e.number ?? e.title}`).sort()
  assert.deepEqual(kinds, ['comment:5', 'cr-merged:9', 'cr-opened:9', 'issue-closed:5', 'issue-opened:5', 'milestone-closed:Release 1 - 2026-11-14', 'release:v0.2.0', 'review:9'])
})
