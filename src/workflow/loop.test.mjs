// Tests for the loop check: Lessons must say something, a lesson or decision needs its journal entry, dependency bots
// are exempt, and doctor --ci failures fail the check.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkLoop, isBot } from './loop.mjs'

const CONFIG = { branches: { integration: 'development', production: 'main' }, languages: {}, contextBudgets: {}, slots: {} }
const git = (added = []) => (args) => (args.includes('--diff-filter=A') ? { status: 0, stdout: added.join('\n'), stderr: '' } : { status: 0, stdout: '', stderr: '' })
const ENTRY = '.agent-os/journal/2026/11/2026-11-18T10-00-ana-x.md'
const body = (lessons) => `## What\n\nX\n\n## Lessons\n\n${lessons}\n`
const run = (b, { added = [], author = 'ana', lang = 'en', files = {} } = {}) => {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-loop-'))
  try {
    writeFileSync(join(cwd, '.gitignore'), '.agent-os/local.json\n.agent-os/cache/\n')
    for (const [f, c] of Object.entries(files)) writeFileSync(join(cwd, f), c)
    return checkLoop({ config: CONFIG, git: git(added), cwd, running: '0.0.0' }, { body: b, author, lang })
  } finally { rmSync(cwd, { recursive: true, force: true }) }
}

test('given Lessons "None: typo fix", the check passes without a journal entry', () => {
  const r = run(body('None: typo fix'))
  assert.equal(r.ok, true, r.problems.join('\n'))
  assert.ok(r.notes.includes('no journal entry: the Lessons section marks the change as trivial'))
})

test('given Lessons left as the template comment, the check fails', () => {
  const r = run(body('<!-- Required. A lesson for the rules, or "None: <reason>". -->'), { added: [ENTRY] })
  assert.equal(r.ok, false)
  assert.match(r.problems[0], /"## Lessons" is empty \(a template comment does not count\)/)
})

test('a missing section or a bare "None" fails', () => {
  assert.match(run('## What\n\nX\n', { added: [ENTRY] }).problems[0], /has no "## Lessons" section/)
  assert.match(run(body('None.'), { added: [ENTRY] }).problems[0], /says none without a reason/)
})

test('a real lesson needs its journal entry on the branch', () => {
  const lesson = body('Pin merges to the checked sha.')
  assert.match(run(lesson).problems[0], /adds no journal entry/)
  assert.equal(run(lesson, { added: [ENTRY, 'src/a.mjs'] }).ok, true)
})

test('ro descriptions use the Lectii heading', () => {
  assert.equal(run('## Lectii\n\nNiciuna: corectura de text\n', { lang: 'ro' }).ok, true)
  assert.match(run('## Lectii\n\n<!-- Obligatoriu. -->\n', { lang: 'ro' }).problems[0], /"## Lectii" is empty/)
})

test('dependency bots are exempt: the release entry records them', () => {
  assert.ok(isBot('dependabot[bot]') && isBot('renovate[bot]') && isBot('github-actions[bot]') && !isBot('ana') && !isBot('botanist'))
  assert.match(run('bump x from 1 to 2', { author: 'dependabot[bot]' }).exempt, /dependency bot/)
})

test('a doctor --ci failure fails the loop check, with its fix', () => {
  const r = run(body('None: typo'), { files: { 'stale.rej': 'x' } })
  assert.equal(r.ok, false)
  assert.match(r.problems[0], /^doctor \[conflicts\]: stale\.rej holds an unresolved update conflict \(fix: /)
})

test('without the base history, the check says how to check out', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-loop-'))
  try {
    writeFileSync(join(cwd, '.gitignore'), '.agent-os/local.json\n.agent-os/cache/\n')
    const r = checkLoop({ config: CONFIG, git: () => ({ status: 128, stdout: '', stderr: 'unknown revision' }), cwd, running: '0.0.0' }, { body: body('None: x') })
    assert.match(r.problems[0], /fetch-depth: 0/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
