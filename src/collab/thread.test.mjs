// Tests for comment-driven work: the thread read before acting (decisions verbatim, participants, language), the
// decisions quoted into the journal entry, replies in the comment's language with ro ASCII, and @mentions only for
// real people, both for review replies and for issue comments.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from '../cli/main.mjs'
import { decisionsIn, decisionsSection, detectLanguage, prepareReply, readThread, realMentions } from './thread.mjs'

/** A tracker with one issue (#34) and its comments; records what it posts. */
function fakeTracker(comments, { assignees = ['ana'] } = {}) {
  const posted = []
  return {
    posted,
    whoami: () => 'me',
    get: (n) => ({ number: n, title: 'Queue choice', body: 'Which queue?', state: 'open', url: `u/${n}`, assignees, isPullRequest: false }),
    comments: () => comments,
    comment: (n, body, { dryRun } = {}) => { if (!dryRun) posted.push({ n, body }); return { number: n, dryRun: Boolean(dryRun) } },
  }
}
const CONVO = [
  { author: 'dan', body: 'Putem folosi Redis pentru coada?', at: '2026-11-17T09:00:00Z', url: 'c1' },
  { author: 'ana', body: 'Nu acum, avem deja Postgres.\n\nDecizie: ramanem pe pg-boss pana la 10k joburi pe zi.\nRedis il reluam atunci.', at: '2026-11-17T10:00:00Z', url: 'c2' },
  { author: 'github-actions', bot: true, body: 'Decision: bot noise', at: '2026-11-17T11:00:00Z', url: 'c3' },
]

test('the language of a comment: ro by its words or diacritics, en, or no signal for code', () => {
  assert.equal(detectLanguage('De ce nu folosim map aici?'), 'ro')
  assert.equal(detectLanguage('Mulțumesc'), 'ro')
  assert.equal(detectLanguage('Why is this not a map? It would be clearer.'), 'en')
  assert.equal(detectLanguage('`x.map(f)` https://example.com'), null)
})

test('decisions are found and kept verbatim, in English and Romanian; other text is not a decision', () => {
  assert.deepEqual(decisionsIn(CONVO[1].body), ['Decizie: ramanem pe pg-boss pana la 10k joburi pe zi.\nRedis il reluam atunci.'])
  assert.deepEqual(decisionsIn('**Decision:** keep the CLI flat.'), ['**Decision:** keep the CLI flat.'])
  assert.deepEqual(decisionsIn('We decided to drop the cache.'), ['We decided to drop the cache.'])
  assert.deepEqual(decisionsIn('I have not decided yet. What do you think?\n\n```\nDecision: in code\n```'), [])
})

test('the thread: participants, the conversation language and the decisions with author and link; bots ignored', () => {
  const t = readThread(fakeTracker(CONVO), 34)
  assert.deepEqual(t.participants, ['ana', 'dan'])
  assert.equal(t.language, 'ro')
  assert.deepEqual(t.decisions.map((d) => [d.author, d.url]), [['ana', 'c2']])
  assert.equal(t.comments, 3)
})

test('@mentions only for real people: unknown handles lose the @, emails and code are left alone', () => {
  assert.equal(realMentions('thanks @Ana, cc @nobody; mail x@y.com; `@scope/pkg`', ['ana']), 'thanks @Ana, cc `nobody`; mail x@y.com; `@scope/pkg`')
})

test('given a ro comment, the reply is ro and ASCII; an English one is refused', () => {
  assert.deepEqual(prepareReply('Gata, am schimbat. Mulțumesc!', { to: CONVO[0] }), { lang: 'ro', body: 'Gata, am schimbat. Multumesc!', problems: [] })
  assert.match(prepareReply('Done, I changed it and it is fine now.', { to: CONVO[0] }).problems[0], /answer in ro \(ASCII/)
  assert.deepEqual(prepareReply('Done.', { to: { body: '' }, fallback: 'en' }).problems, [])
})

async function cli(cwd, argv, io = {}) {
  let stdout = ''
  let stderr = ''
  const code = await run(argv, { stdout: (s) => { stdout += s }, stderr: (s) => { stderr += s }, cwd, env: {}, ...io })
  return { code, stdout, stderr }
}

test('a decision in a comment appears verbatim in the implementing PR journal entry (journal add --thread)', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-thread-'))
  try {
    writeFileSync(join(cwd, 'agent-os.json'), '{}')
    const r = await cli(cwd, ['journal', 'add', '--type', 'decision', '--title', 'Queue stays on pg-boss', '--area', 'workers', '--ref', '#34', '--author', 'me', '--body', 'Implements the queue choice.', '--thread', '#34'], { tracker: fakeTracker(CONVO) })
    assert.equal(r.code, 0, r.stderr)
    const dir = join(cwd, '.agent-os/journal/2026')
    const month = readdirSync(dir)[0]
    const text = readFileSync(join(dir, month, readdirSync(join(dir, month))[0]), 'utf8')
    assert.match(text, /Implements the queue choice\.\n\n## Decisions from the conversation\n\n> Decizie: ramanem pe pg-boss pana la 10k joburi pe zi\.\n> Redis il reluam atunci\.\n\n-- @ana, 2026-11-17, #34 \(c2\)/)
    assert.doesNotMatch(text, /bot noise/)
    assert.equal((await cli(cwd, ['journal', 'check'])).code, 0)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('issue comment answers in the language of the last comment by someone else, with real mentions only', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-thread-'))
  try {
    writeFileSync(join(cwd, 'agent-os.json'), '{}')
    const tracker = fakeTracker(CONVO.slice(0, 2))
    writeFileSync(join(cwd, 'en.md'), 'Thanks, I will keep pg-boss and note it in the journal.')
    const refused = await cli(cwd, ['issue', 'comment', '34', '--body-file', 'en.md'], { tracker })
    assert.equal(refused.code, 1)
    assert.deepEqual(tracker.posted, [])
    writeFileSync(join(cwd, 'ro.md'), 'Mulțumesc @ana, rămânem pe pg-boss. cc @mallory')
    assert.equal((await cli(cwd, ['issue', 'comment', '34', '--body-file', 'ro.md'], { tracker })).code, 0)
    assert.deepEqual(tracker.posted, [{ n: 34, body: 'Multumesc @ana, ramanem pe pg-boss. cc `mallory`' }])
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('agent-os thread highlights the decisions and says which language to reply in', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-thread-'))
  try {
    writeFileSync(join(cwd, 'agent-os.json'), '{}')
    const r = await cli(cwd, ['thread', '34'], { tracker: fakeTracker(CONVO) })
    assert.equal(r.code, 0, r.stderr)
    assert.match(r.stdout, /participants: @ana @dan {3}language: ro {3}comments: 3/)
    assert.match(r.stdout, /DECISIONS \(1\)[\s\S]*Decizie: ramanem pe pg-boss[\s\S]*-- @ana, 2026-11-17, c2/)
    assert.match(r.stdout, /reply in ro \(ASCII, no diacritics\)/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('the decisions section is empty without decisions and in ro when the journal is', () => {
  assert.equal(decisionsSection([{ number: 1, decisions: [] }]), '')
  assert.match(decisionsSection([{ number: 1, decisions: [{ text: 'Decizie: x', author: 'ana', at: '2026-11-17', url: null }] }], { lang: 'ro' }), /^## Decizii din discutie\n\n> Decizie: x\n\n-- @ana, 2026-11-17, #1\n$/)
})
