// Tests for rendering a folder of templates: language variants by area, context values and their errors.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderTree, buildContext } from './tree.mjs'
import { withDefaults } from '../config/config.mjs'
import { SCHEMA } from '../config/schema.mjs'
import { parse } from '../yaml/yaml.mjs'

const fixtures = fileURLToPath(new URL('./__fixtures__/github', import.meta.url))
const config = (over = {}) => withDefaults(SCHEMA, over)

test('with issues in ro and PRs in en, the issue form renders in ro and the PR template in en', () => {
  const out = renderTree(fixtures, config({ languages: { issues: 'ro', prs: 'en', labels: 'ro' } }))
  const bug = out.find((f) => f.path === '.github/ISSUE_TEMPLATE/bug.yml')
  const pr = out.find((f) => f.path === '.github/pull_request_template.md')
  assert.equal(bug.lang, 'ro')
  assert.match(bug.content, /Ceva functioneaza gresit/)
  assert.deepEqual(parse(bug.content).labels, ['tip:bug'])
  assert.equal(pr.lang, 'en')
  assert.match(pr.content, /^## What/m)
  assert.doesNotMatch(pr.content, /area:/)
})

test('switching the areas switches the variants', () => {
  const out = renderTree(fixtures, config({ languages: { issues: 'en', prs: 'ro' } }))
  assert.match(out.find((f) => f.path.endsWith('bug.yml')).content, /Something works wrong/)
  assert.match(out.find((f) => f.path.endsWith('.md')).content, /^## Ce$/m)
})

test('packs switch conditional blocks, and files without variants render once', () => {
  const withPg = renderTree(fixtures, config({ packs: ['stack-postgres'] }))
  assert.equal(parse(withPg.find((f) => f.path.endsWith('bug.yml')).content).body.length, 2)
  const without = renderTree(fixtures, config({}))
  assert.equal(parse(without.find((f) => f.path.endsWith('bug.yml')).content).body.length, 1)
  assert.deepEqual(JSON.parse(without.find((f) => f.path === 'settings.json').content), { integration: 'development', packs: [] })
})

test('output is sorted by path and identical across runs', () => {
  const a = renderTree(fixtures, config({ languages: { issues: 'ro' } }))
  assert.deepEqual(a.map((f) => f.path), ['.github/ISSUE_TEMPLATE/bug.yml', '.github/pull_request_template.md', 'settings.json'])
  assert.deepEqual(renderTree(fixtures, config({ languages: { issues: 'ro' } })), a)
})

test('the context exposes labels by group, pack flags and the language of every area', () => {
  const ctx = buildContext(config({ languages: { labels: 'ro', issues: 'ro' }, packs: ['x'] }))
  assert.equal(ctx.labels.type.bug, 'tip:bug')
  assert.equal(ctx.labels['needs-decision'], 'necesita-decizie')
  assert.deepEqual(ctx.pack, { x: true })
  assert.equal(ctx.lang.issues, 'ro')
  assert.equal(ctx.lang.chat, 'en')
})

function tree(files) {
  const dir = mkdtempSync(join(tmpdir(), 'aos-tpl-'))
  for (const [p, c] of Object.entries(files)) { mkdirSync(join(dir, p, '..'), { recursive: true }); writeFileSync(join(dir, p), c) }
  return dir
}

test('variant mistakes are reported against the file', () => {
  const cases = [
    [{ 'a.en.md': 'x', 'a.ro.md': 'y' }, /a\.(en|ro)\.md:1:1: language variants must declare their area/],
    [{ 'a.en.md': '{{! area: issues }}', 'a.ro.md': '{{! area: prs }}' }, /declare different areas/],
    [{ 'a.en.md': '{{! area: tickets }}' }, /unknown area "tickets"/],
    [{ 'a.en.md': '{{! area: issues }}' }, /a\.md has no "ro" variant/],
    [{ 'a.md': 'x', 'a.en.md': '{{! area: issues }}' }, /both a plain file and language variants/],
    [{ 'b.md': 'line\n{{ nope }}' }, /b\.md:2:1: unknown placeholder "nope"/],
  ]
  for (const [files, pattern] of cases) {
    const dir = tree(files)
    try { assert.throws(() => renderTree(dir, config({ languages: { issues: 'ro' } })), pattern) } finally { rmSync(dir, { recursive: true, force: true }) }
  }
})
