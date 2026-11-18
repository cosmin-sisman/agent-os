// Tests for /pr: the body rules, preflight (gate for this exact commit, journal entry, title) and opening.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { saveResult } from '../gate/gate.mjs'
import { checkBody, openChangeRequest, preflight, section } from './pr.mjs'
import { vocabularyFor } from '../platform/vocabulary.mjs'

const CONFIG = { branches: { integration: 'development', production: 'main' }, conventions: { types: ['feat', 'fix', 'docs', 'chore'], maxTitleLength: 72, exempt: [] } }
const BODY = '## What\n\nX.\n\n## Why\n\nCloses #15\n\n## How it was tested\n\nnpm test: 300 pass\n\n## Lessons\n\nNone: a routine change.\n'
const TITLE = 'feat(pr): open change requests only when ready [#15]'

function fakeGit({ branch = 'feat/15-pr', head = 'abc1234', added = ['.agent-os/journal/2026/11/2026-11-18T10-00-ana-x.md', 'src/a.mjs'], push = 0 } = {}) {
  const calls = []
  const git = (args) => {
    calls.push(args)
    const k = args.join(' ')
    if (k === 'rev-parse --abbrev-ref HEAD') return { status: 0, stdout: `${branch}\n`, stderr: '' }
    if (k === 'rev-parse HEAD') return { status: 0, stdout: `${head}\n`, stderr: '' }
    if (k === 'diff --name-only --diff-filter=A origin/development...HEAD') return { status: 0, stdout: added.join('\n'), stderr: '' }
    if (args[0] === 'push') return { status: push, stdout: '', stderr: push ? 'rejected' : '' }
    return { status: 1, stdout: '', stderr: `unexpected ${k}` }
  }
  git.calls = calls
  return git
}
const withGate = (fn, result = { head: 'abc1234', clean: true, ok: true, suites: [{ name: 'unit', passed: true }] }) => {
  const dir = mkdtempSync(join(tmpdir(), 'aos-pr-'))
  try { if (result) saveResult(dir, result); return fn(dir) } finally { rmSync(dir, { recursive: true, force: true }) }
}
function fakeTracker({ existing = null, labels = ['type:feature', 'area:skills', 'priority:p0', 'size:l'] } = {}) {
  const calls = []
  return {
    calls,
    warnings: [],
    pullRequestFor: () => existing,
    get: (n) => ({ number: n, labels }),
    createPullRequest: (spec) => { calls.push(['create', spec]); return { number: 160, url: 'https://github.com/acme/app/pull/160' } },
    addLabels: (n, l) => calls.push(['labels', n, l]),
    comment: (n, b) => calls.push(['comment', n, b]),
  }
}

test('the Lessons section must say something, with a reason when it is none', () => {
  assert.deepEqual(checkBody(BODY), [])
  assert.match(checkBody(BODY.replace('None: a routine change.', '<!-- Required. -->'))[0], /"## Lessons" is empty/)
  assert.match(checkBody(BODY.replace('None: a routine change.', 'None'))[0], /without a reason/)
  assert.match(checkBody(BODY.replace(/## Lessons[\s\S]*/, ''))[0], /no "## Lessons" section/)
  assert.match(checkBody(BODY.replace('Closes #15', 'Something'))[0], /closes or references no issue/)
  assert.equal(section('## A\n\nx\n## B\ny', 'A'), 'x')
})

test('a ro body uses the ro headings and must be ASCII', () => {
  const ro = '## Ce\n\nX.\n\n## De ce\n\nCloses #15\n\n## Cum a fost testat\n\nnpm test\n\n## Lectii\n\nNiciuna: schimbare de rutina, fără risc.\n'
  const problems = checkBody(ro, { lang: 'ro' })
  assert.equal(problems.length, 2, 'both letters of "fără", and the ro headings are accepted')
  assert.match(problems[0], /body line 15: "ă" \(prs are ro, ASCII only: write "a"\)/)
})

test('preflight passes with a gate passed on this commit, a journal entry and a good title', () => {
  withGate((cwd) => assert.deepEqual(preflight({ config: CONFIG, git: fakeGit(), cwd }, { title: TITLE, body: BODY }).problems, []))
})

test('a failing gate, a stale gate, no gate or no journal entry block the change request', () => {
  withGate((cwd) => assert.match(preflight({ config: CONFIG, git: fakeGit(), cwd }, { title: TITLE, body: BODY }).problems[0], /the gate failed: unit .*never opens with a failing check/), { head: 'abc1234', clean: true, ok: false, suites: [{ name: 'unit', passed: false }] })
  withGate((cwd) => assert.match(preflight({ config: CONFIG, git: fakeGit({ head: 'fff0000' }), cwd }, { title: TITLE, body: BODY }).problems[0], /the gate ran on commit abc1234, not on fff0000/))
  withGate((cwd) => assert.match(preflight({ config: CONFIG, git: fakeGit(), cwd }, { title: TITLE, body: BODY }).problems[0], /the gate has not run/), null)
  withGate((cwd) => assert.match(preflight({ config: CONFIG, git: fakeGit({ added: ['src/a.mjs'] }), cwd }, { title: TITLE, body: BODY }).problems[0], /adds no journal entry/))
  withGate((cwd) => assert.match(preflight({ config: CONFIG, git: fakeGit({ branch: 'development' }), cwd }, { title: TITLE, body: BODY }).problems[0], /you are on development/))
})

test('a bad title is a problem with a suggestion', () => {
  withGate((cwd) => {
    const r = preflight({ config: CONFIG, git: fakeGit(), cwd }, { title: 'feat(pr): Open change requests.', body: BODY })
    assert.equal(r.ok, false)
    assert.equal(r.suggestion, 'feat(pr): open change requests [#15]')
  })
})

test('when ready, create pushes, opens, copies type and area labels, and records it on the issue', () => {
  withGate((cwd) => {
    const t = fakeTracker()
    const git = fakeGit()
    const r = openChangeRequest({ config: CONFIG, git, cwd, tracker: t, vocab: vocabularyFor('github') }, { title: TITLE, body: BODY })
    assert.equal(r.opened, true)
    assert.deepEqual(git.calls.at(-1), ['push', '-u', 'origin', 'feat/15-pr'])
    assert.deepEqual(t.calls, [
      ['create', { title: TITLE, body: BODY, head: 'feat/15-pr', base: 'development', draft: false }],
      ['labels', 160, ['type:feature', 'area:skills']],
      ['comment', 15, 'PR #160 is open for this issue.'],
    ])
  })
})

test('not ready: nothing is pushed or opened; dry run: nothing is sent', () => {
  withGate((cwd) => {
    const t = fakeTracker()
    const git = fakeGit()
    const r = openChangeRequest({ config: CONFIG, git, cwd, tracker: t, vocab: vocabularyFor('github') }, { title: TITLE, body: BODY })
    assert.equal(r.opened, false)
    assert.deepEqual(t.calls, [])
    assert.equal(git.calls.some((c) => c[0] === 'push'), false)
  }, { head: 'abc1234', clean: true, ok: false, suites: [{ name: 'unit', passed: false }] })
  withGate((cwd) => {
    const t = fakeTracker()
    const git = fakeGit()
    const r = openChangeRequest({ config: CONFIG, git, cwd, tracker: t, vocab: vocabularyFor('github') }, { title: TITLE, body: BODY, dryRun: true })
    assert.equal(r.dryRun, true)
    assert.equal(r.steps.length, 4)
    assert.deepEqual(t.calls, [])
    assert.equal(git.calls.some((c) => c[0] === 'push'), false)
  })
})

test('a branch that already has a change request is refused; GitLab words and ro comments follow the config', () => {
  withGate((cwd) => {
    assert.throws(() => openChangeRequest({ config: CONFIG, git: fakeGit(), cwd, tracker: fakeTracker({ existing: { number: 150, url: 'u' } }), vocab: vocabularyFor('github') }, { title: TITLE, body: BODY }), /already has PR #150/)
    const t = fakeTracker()
    openChangeRequest({ config: CONFIG, git: fakeGit(), cwd, tracker: t, vocab: vocabularyFor('gitlab') }, { title: TITLE, body: BODY, issuesLang: 'ro' })
    assert.deepEqual(t.calls.at(-1), ['comment', 15, 'MR !160 este deschis pentru acest issue.'])
  })
})
