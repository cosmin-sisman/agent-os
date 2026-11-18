// Tests for wiring the agent-os GitLab jobs into .gitlab-ci.yml (#233): a project without the file gets one; a project
// with its own include list keeps it, and the agent-os lines go inside it; nothing else in the file changes; a shape
// agent-os cannot complete is a conflict with a .rej, never a rewrite; an update changes only the block.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installRoutes, planInstall } from './install.mjs'
import { applyManaged, placeInclude } from './managed.mjs'
import { withDefaults } from '../config/config.mjs'
import { SCHEMA } from '../config/schema.mjs'
import { parse } from '../yaml/yaml.mjs'

const config = (over = {}) => withDefaults(SCHEMA, { platform: { type: 'gitlab', project: 'team/app' }, ...over })
const tmp = () => mkdtempSync(join(tmpdir(), 'aos-glci-'))
const OWN = 'stages: [build, test]\n\ninclude:\n  - local: ci/build.yml\n  - project: team/templates\n    file: lint.yml\n\nbuild:\n  stage: build\n  script: make\n'

test('given a GitLab project without .gitlab-ci.yml, init creates it with the agent-os includes', () => {
  const cwd = tmp()
  try {
    installRoutes(cwd, config(), { version: '0.1.1' })
    const text = readFileSync(join(cwd, '.gitlab-ci.yml'), 'utf8')
    const ci = parse(text, { file: '.gitlab-ci.yml' })
    assert.deepEqual(ci.include.map((i) => i.local), ['.gitlab/agent-os-gate.yml', '.gitlab/agent-os-loop.yml', '.gitlab/agent-os-retro.yml'])
    for (const f of ci.include.map((i) => i.local)) assert.ok(existsSync(join(cwd, f)), `${f} is installed`)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('given a GitLab project with its own .gitlab-ci.yml and include list, init adds the agent-os includes to it and changes nothing else', () => {
  const cwd = tmp()
  try {
    writeFileSync(join(cwd, '.gitlab-ci.yml'), OWN)
    const r = installRoutes(cwd, config(), { version: '0.1.1' }).results.find((x) => x.key === '.gitlab-ci.yml#include')
    assert.equal(r.action, 'installed')
    const text = readFileSync(join(cwd, '.gitlab-ci.yml'), 'utf8')
    assert.equal(text.match(/^include:/gm).length, 1, 'one include key')
    const ci = parse(text, { file: '.gitlab-ci.yml' })
    assert.deepEqual(ci.include.map((i) => i.local ?? i.project), ['.gitlab/agent-os-gate.yml', '.gitlab/agent-os-loop.yml', '.gitlab/agent-os-retro.yml', 'ci/build.yml', 'team/templates'])
    assert.equal(text.replace(/# agent-os:begin include\n[\s\S]*?# agent-os:end include\n/, ''), OWN, 'everything else is byte for byte the same')
    // An update replaces only the block: with the retro job turned off, its line goes, the team's lines stay.
    const second = installRoutes(cwd, config({ ci: { retro: false } }), { version: '0.1.2' }).results.find((x) => x.key === '.gitlab-ci.yml#include')
    assert.equal(second.action, 'replaced')
    const after = readFileSync(join(cwd, '.gitlab-ci.yml'), 'utf8')
    assert.ok(!after.includes('agent-os-retro.yml') && after.includes('ci/build.yml') && after.includes('team/templates'))
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('a .gitlab-ci.yml without include gets one; an include agent-os cannot complete is a conflict, never a rewrite', () => {
  const block = '# agent-os:begin include\n  - local: .gitlab/agent-os-loop.yml\n# agent-os:end include'
  assert.equal(placeInclude('build:\n  script: make\n', block), `build:\n  script: make\n\ninclude:\n${block}\n`)
  assert.equal(placeInclude("include: 'ci/one.yml'\n", block), null, 'a string include')
  assert.equal(placeInclude('include:\n  local: ci/one.yml\n', block), null, 'a map include')
  assert.equal(placeInclude('include:\n- local: ci/one.yml\n', block), null, 'a list at another indentation')
  const cwd = tmp()
  try {
    const own = "include: 'ci/one.yml'\nbuild:\n  script: make\n"
    writeFileSync(join(cwd, '.gitlab-ci.yml'), own)
    const [r] = applyManaged(cwd, [{ key: '.gitlab-ci.yml#include', content: '  - local: .gitlab/agent-os-loop.yml' }], { version: '0.1.1' })
    assert.equal(r.action, 'conflict')
    assert.equal(readFileSync(join(cwd, '.gitlab-ci.yml'), 'utf8'), own, 'the file is untouched')
    assert.match(readFileSync(join(cwd, r.rej), 'utf8'), /cannot complete safely[\s\S]*- local: \.gitlab\/agent-os-loop\.yml/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('GitHub projects get no .gitlab-ci.yml block', () => {
  const keys = planInstall(withDefaults(SCHEMA, { platform: { type: 'github', project: 'a/b' } })).items.map((i) => i.key)
  assert.ok(!keys.some((k) => k.startsWith('.gitlab-ci.yml')))
})
