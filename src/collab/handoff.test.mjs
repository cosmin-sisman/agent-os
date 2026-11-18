// Tests for /handoff: one status comment per held issue with work in flight, nothing for issues without work or held
// by others, the next steps, the journal entry, the dry run and the ro wording.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handoff } from './handoff.mjs'
import { readJournal } from '../journal/journal.mjs'
import { vocabularyFor } from '../platform/vocabulary.mjs'

const git = (args) => {
  const k = args.join(' ')
  if (k.startsWith('for-each-ref')) return { status: 0, stdout: 'origin/development\norigin/feat/14-start\norigin/fix/22-journal\norigin/feat/99-someone-else\n' }
  if (k === 'log -1 --format=%h %s (%cr) origin/feat/14-start') return { status: 0, stdout: 'abc1234 feat(start): wip (2 hours ago)\n' }
  if (k === 'log -1 --format=%h %s (%cr) origin/fix/22-journal') return { status: 0, stdout: 'def5678 fix(journal): names (1 day ago)\n' }
  return { status: 1, stdout: '' }
}
function fakeTracker() {
  const calls = []
  return {
    calls,
    assignedIssues: (me) => (me === 'ana' ? [{ number: 14, title: 'Start' }, { number: 22, title: 'Journal' }, { number: 30, title: 'Not started yet' }] : []),
    pullRequestFor: (b) => (b === 'feat/14-start' ? { number: 150, url: 'u' } : null),
    pullRequestStatus: () => ({ checks: 'pending' }),
    blockers: (n) => (n === 22 ? [{ number: 9, state: 'open' }, { number: 8, state: 'closed' }] : []),
    get: (n) => ({ body: n === 14 ? '## Test scenarios\n\n- [x] one\n- [ ] two\n' : '' }),
    comment: (n, b) => calls.push([n, b]),
  }
}

test('given two open issues with work in flight, each gets one status comment; one without work gets none', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-handoff-'))
  try {
    const t = fakeTracker()
    const r = handoff({ tracker: t, git, cwd, vocab: vocabularyFor('github') }, { me: 'ana', notes: { 14: 'answer the review on #150' }, now: new Date('2026-11-18T18:00:00Z') })
    assert.deepEqual(t.calls.map((c) => c[0]), [14, 22], 'one comment each; #30 has no branch or change request')
    assert.equal(t.calls[0][1], ['Handoff from @ana:', '', '- Branch: `feat/14-start`', '- Last commit: abc1234 feat(start): wip (2 hours ago)', '- Change request: #150, checks pending', '- 1 test scenario(s) still unticked', '- Next: answer the review on #150'].join('\n'))
    assert.match(t.calls[1][1], /- Change request: none yet\n- Blocked by: #9\n- Next: continue from the issue and the change request/)
    const [entry] = readJournal(cwd)
    assert.equal(entry.meta.type, 'handoff')
    assert.deepEqual(entry.meta.refs, ['#14', '#22'])
    assert.equal(r.journal, entry.path)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('nothing for issues held by others; the dry run comments nowhere and writes no journal entry; ro wording', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-handoff-'))
  try {
    const t = fakeTracker()
    assert.deepEqual(handoff({ tracker: t, git, cwd, vocab: vocabularyFor('github') }, { me: 'dan' }).comments, [])
    const dry = handoff({ tracker: t, git, cwd, vocab: vocabularyFor('gitlab') }, { me: 'ana', lang: 'ro', dryRun: true })
    assert.equal(dry.comments.length, 2)
    assert.match(dry.comments[0].body, /^Predare de la @ana:\n\n- Branch: `feat\/14-start`[\s\S]*- Change request: !150, verificari pending/)
    assert.deepEqual(t.calls, [])
    assert.equal(readJournal(cwd).filter((e) => e.meta.author === 'ana').length, 0)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
