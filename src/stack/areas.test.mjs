// Tests for stack-driven areas: area labels from the layers in use (labels language, group colors), setup creating
// the label of a newly added layer (GitHub and GitLab), /pr labelling by layer paths, lessons recall and overlap by
// area, and CODEOWNERS as a block that completes the team's file and never replaces it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { areaLabelEntries, areasFor, codeownersLines, codeownersPath } from './areas.mjs'
import { planGitHubSetup } from '../platform/setup-github.mjs'
import { planGitLabSetup } from '../platform/setup-gitlab.mjs'
import { ghClient } from '../tracker/gh.mjs'
import { fakeGh } from '../tracker/__fixtures__/fake-gh.mjs'
import { LABELS, renderLabel } from '../i18n/i18n.mjs'
import { labelId } from '../workflow/next.mjs'
import { openChangeRequest } from '../workflow/pr.mjs'
import { saveResult } from '../gate/gate.mjs'
import { vocabularyFor } from '../platform/vocabulary.mjs'
import { installRoutes } from '../managed/install.mjs'
import { withDefaults } from '../config/config.mjs'
import { SCHEMA } from '../config/schema.mjs'

const STACK = 'layers:\n  data-layer:\n    tech: drizzle-supabase-postgres\n    paths: ["packages/db/**"]\n    owners: [ana, "@acme/data"]\n  auth: { tech: supabase-auth, paths: ["packages/auth/**"] }\n  mobile: { tech: expo-react-native, status: evaluating, paths: ["apps/mobile/**"] }\n'
function project(stack = STACK) {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-areas-'))
  writeFileSync(join(cwd, 'stack.yaml'), stack)
  return cwd
}

test('area labels come from the layers in use, named in the labels language, colored by layer group', () => {
  const cwd = project()
  try {
    const entries = areaLabelEntries(cwd)
    assert.deepEqual(entries.map((e) => e.id), ['area:data-layer', 'area:auth'], 'an evaluating layer is not in use')
    assert.equal(renderLabel(entries[0], 'ro').name, 'zona:data-layer')
    assert.equal(renderLabel(entries[0], 'en', { scoped: true }).name, 'area::data-layer')
    assert.match(entries[0].color, /^[0-9a-f]{6}$/)
    assert.equal(labelId('zona:data-layer'), 'area:data-layer')
    assert.equal(labelId('area::auth'), 'area:auth')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('adding a layer adds its label through setup, on GitHub and on GitLab; existing labels are kept', () => {
  const cwd = project()
  try {
    const config = withDefaults(SCHEMA, { platform: { type: 'github', project: 'acme/app' } })
    const existing = [...LABELS.map((l) => ({ name: l.name.en, color: l.color, description: l.description.en })), { name: 'area:data-layer', color: 'abcdef', description: 'ours' }]
    const gh = fakeGh({ 'GET repos/acme/app/labels?per_page=100&page=1': existing })
    const steps = planGitHubSetup(config, ghClient(gh), { only: ['labels'], areas: areaLabelEntries(cwd) })
    assert.deepEqual(steps.filter((s) => s.action === 'create').map((s) => s.description), ['create label area:auth'])
    assert.ok(steps.some((s) => s.action === 'keep' && /area:data-layer/.test(s.description)), 'its own color and description stay')
    const glab = { rest: (m, path) => (m === 'GET' && path.includes('labels') ? (path.includes('page=1') ? [] : []) : null) }
    const gl = planGitLabSetup(withDefaults(SCHEMA, { platform: { type: 'gitlab', project: 'acme/app' } }), glab, { only: ['labels'], areas: areaLabelEntries(cwd) })
    assert.ok(gl.some((s) => s.action === 'create' && s.description === 'create label area::auth'))
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('given a file under a layer path, /pr labels the PR with that area', () => {
  const cwd = project()
  try {
    saveResult(cwd, { head: 'abc1234', clean: true, ok: true, suites: [{ name: 'unit', passed: true }] })
    const git = (args) => {
      const k = args.join(' ')
      if (k === 'rev-parse --abbrev-ref HEAD') return { status: 0, stdout: 'feat/15-x\n', stderr: '' }
      if (k === 'rev-parse HEAD') return { status: 0, stdout: 'abc1234\n', stderr: '' }
      if (k === 'diff --name-only --diff-filter=A origin/development...HEAD') return { status: 0, stdout: '.agent-os/journal/2026/11/2026-11-18T10-00-ana-x.md', stderr: '' }
      if (k === 'diff --name-only origin/development...HEAD') return { status: 0, stdout: 'packages/db/schema.ts\n.agent-os/journal/2026/11/2026-11-18T10-00-ana-x.md', stderr: '' }
      if (args[0] === 'push') return { status: 0, stdout: '', stderr: '' }
      return { status: 1, stdout: '', stderr: 'unexpected' }
    }
    const calls = []
    const tracker = { warnings: [], pullRequestFor: () => null, openPullRequests: () => [], get: (n) => ({ number: n, labels: ['type:feature', 'priority:p1'] }), createPullRequest: () => ({ number: 7, url: 'u' }), labelChangeRequest: (n, l) => calls.push(l), comment: () => {} }
    const config = { branches: { integration: 'development', production: 'main' }, conventions: { types: ['feat'], maxTitleLength: 72, exempt: [] }, languages: { labels: 'en' } }
    const body = '## What\n\nX.\n\n## Why\n\nCloses #15\n\n## How it was tested\n\nnpm test\n\n## Lessons\n\nNone: routine.\n'
    const r = openChangeRequest({ config, git, cwd, tracker, vocab: vocabularyFor('github') }, { title: 'feat(db): add the schema [#15]', body })
    assert.equal(r.opened, true, JSON.stringify(r.problems))
    assert.deepEqual(calls, [['type:feature', 'area:data-layer']])
    assert.deepEqual(areasFor(['packages/auth/x.ts', 'packages/db/y.ts', 'README.md'], cwd), ['area:auth', 'area:data-layer'])
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('CODEOWNERS: a block from layer owners, around the team lines; a hand-edited block ends in a .rej', () => {
  const cwd = project()
  try {
    assert.match(codeownersLines(cwd), /^# Generated from stack\.yaml[\s\S]*\n\/packages\/db\/\*\* @ana @acme\/data$/)
    mkdirSync(join(cwd, '.github'))
    writeFileSync(join(cwd, '.github/CODEOWNERS'), '* @acme/leads\n')
    assert.equal(codeownersPath(cwd), '.github/CODEOWNERS')
    const config = withDefaults(SCHEMA, { platform: { type: 'github' } })
    installRoutes(cwd, config, { version: '0.1.0' })
    const text = readFileSync(join(cwd, '.github/CODEOWNERS'), 'utf8')
    assert.match(text, /^\* @acme\/leads\n\n# agent-os:begin areas\n# Generated from stack\.yaml[\s\S]*\/packages\/db\/\*\* @ana @acme\/data\n# agent-os:end areas\n$/)
    writeFileSync(join(cwd, '.github/CODEOWNERS'), text.replace('@ana @acme/data', '@someone-else'))
    writeFileSync(join(cwd, 'stack.yaml'), STACK.replace('owners: [ana, "@acme/data"]', 'owners: [dan]'))
    const r = installRoutes(cwd, config, { version: '0.1.1' })
    assert.equal(r.results.find((x) => x.key === '.github/CODEOWNERS#areas').action, 'conflict')
    assert.match(readFileSync(join(cwd, '.github/CODEOWNERS'), 'utf8'), /@someone-else/, 'the hand edit is kept')
    assert.ok(existsSync(join(cwd, '.github/CODEOWNERS.areas.rej')))
  } finally { rmSync(cwd, { recursive: true, force: true }) }
  const none = project('layers:\n  auth: { tech: supabase-auth }\n')
  try { assert.equal(codeownersLines(none), '', 'no owners, no block') } finally { rmSync(none, { recursive: true, force: true }) }
})
