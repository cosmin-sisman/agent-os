// Tests for title and commit conventions.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkTitle, checkCommit, referencedIssues } from './conventions.mjs'
import { withDefaults } from '../config/config.mjs'
import { SCHEMA } from '../config/schema.mjs'

const conv = withDefaults(SCHEMA, {}).conventions

test('given a body with Closes #3 and a title ending [#4], the check fails naming both and proposes the fix', () => {
  const r = checkTitle('feat(cli): add the runner [#4]', 'Closes #3', conv)
  assert.equal(r.ok, false)
  assert.ok(r.problems.some((p) => p.includes('#3') && p.includes('does not list')))
  assert.ok(r.problems.some((p) => p.includes('#4') && p.includes('neither closes nor references')))
  assert.equal(r.suggestion, 'feat(cli): add the runner [#3]')
})

test('issues are read from Closes, Fixes, Resolves, Refs and Part of, with comma lists; comments and other repos are ignored', () => {
  assert.deepEqual(referencedIssues('Closes #12, #13\nfixes #2\nRefs #20 and more\nPart of #1\n<!-- Closes #99 -->\nCloses other/repo#5'), [1, 2, 12, 13, 20])
})

test('a good title passes; the suffix may list several issues in any order the body has them', () => {
  assert.deepEqual(checkTitle('chore(github): project board script [#127, #20]', 'Closes #127\nRefs #20', conv), { ok: true, problems: [], suggestion: null })
  assert.equal(checkTitle('docs: fix typo', 'No issue.', conv).ok, true)
})

test('each mistake is named with what to change', () => {
  const r = checkTitle('Feature: Added login.', '', conv)
  assert.deepEqual(r.problems, [
    '"Feature" is not an allowed type; use one of feat, fix, docs, chore, refactor, perf, test, ci, build, style, revert',
    'remove the final punctuation from the summary',
    'start the summary in lower case: "added login"',
  ])
  assert.match(checkTitle('just words', '', conv).problems[0], /must look like "type\(scope\): summary"/)
})

test('the length counts the suffix; the fix is to shorten the summary, never the issue list', () => {
  const r = checkTitle(`feat(x): ${'a'.repeat(60)} [#1]`, 'Closes #1', conv)
  assert.match(r.problems[0], /the limit is 72, issue suffix included: shorten the summary by \d+, never the issue list/)
  assert.equal(r.suggestion, null)
})

test('release titles have no length limit; syncs and dependency bots are exempt', () => {
  assert.equal(checkTitle(`release-3: ${'x '.repeat(50)}[#1, #2]`, '- #1 a\nRefs #1\nRefs #2', conv).ok, true)
  assert.equal(checkTitle('chore: sync main into development', '', conv).exempt, true)
  assert.equal(checkTitle('chore(deps): bump x from 1 to 2', 'Bumps x', conv).exempt, true)
})

test('ro titles must be ASCII', () => {
  const r = checkTitle('fix(auth): sesiunea expiră prea devreme [#7]', 'Closes #7', conv, { lang: 'ro' })
  assert.match(r.problems[0], /"ă" at column \d+: titles in ro are ASCII; write "a"/)
  assert.equal(r.suggestion, 'fix(auth): sesiunea expira prea devreme [#7]')
})

test('commit messages: conventional subject, length, blank line, ro ASCII; merges and reverts are exempt', () => {
  assert.equal(checkCommit('feat(x): add y\n\nWhy it matters.\n\nCo-Authored-By: A <a@b>', conv).ok, true)
  assert.equal(checkCommit('feat(x): add y [#4] (#12)', conv).ok, true, 'squash subjects keep their suffixes')
  assert.deepEqual(checkCommit('fix(x): thing.\nbody right away', conv).problems, ['remove the final punctuation from the subject', 'leave a blank line between the subject and the body'])
  assert.match(checkCommit('fix: ș', conv, { lang: 'ro' }).problems[0], /line 1, column 6: "ș"/)
  assert.equal(checkCommit("Merge branch 'x'", conv).exempt, true)
  assert.equal(checkCommit('# comment only\nfix: y', conv).ok, true)
})

test('allowed types and the length are configurable', () => {
  const custom = { ...conv, types: ['feature'], maxTitleLength: 40 }
  assert.equal(checkTitle('feature: add x', '', custom).ok, true)
  assert.match(checkTitle('feat: add x', '', custom).problems[0], /use one of feature/)
})
