// Tests for legacy features and deprecation notes: opt-in install, doctor debt, unknown ids, deprecated items in use,
// and the note a deprecated command or flag prints when it runs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../config/config.mjs'
import { runDoctor } from '../doctor/doctor.mjs'
import { installRoutes } from '../managed/install.mjs'
import { legacyFeatures, runNotices } from './legacy.mjs'

const write = (root, files) => { for (const [p, c] of Object.entries(files)) { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), c) } }
const EXCEPTIONS = [
  { id: 'legacy:old-flow', status: 'legacy', deprecatedIn: '0.3.0', removeIn: '0.6.0', replacement: '/start and /pr' },
  { id: 'flag:hook --print-settings', status: 'deprecated', deprecatedIn: '0.5.0', removeIn: '0.7.0', replacement: 'command:setup' },
  { id: 'config:old.key', status: 'deprecated', deprecatedIn: '0.5.0', removeIn: '0.7.0', replacement: 'config:new.key' },
]

function project(config) {
  const root = mkdtempSync(join(tmpdir(), 'aos-legacy-'))
  const templates = join(root, 'templates')
  write(templates, { 'core/.claude/skills/start/SKILL.md': '---\nname: start\ndescription: Start.\n---\n\n## 1. Learn\n', 'legacy/old-flow/.claude/skills/old-flow/SKILL.md': '---\nname: old-flow\ndescription: The old flow.\n---\n\n## 1. Learn\n' })
  const cwd = join(root, 'app')
  write(cwd, { 'agent-os.json': JSON.stringify({ version: '0.0.0', platform: { type: 'github', project: 'acme/app' }, ...config }), '.gitignore': '.agent-os/local.json\n.agent-os/cache/\n' })
  return { root, cwd, templates }
}

test('given legacy: ["old-flow"], the old skill is installed and doctor reports it as debt', () => {
  const p = project({ legacy: ['old-flow'] })
  try {
    installRoutes(p.cwd, loadConfig(p.cwd).merged, { version: '0.0.0', templatesRoot: p.templates })
    assert.ok(existsSync(join(p.cwd, '.claude/skills/old-flow/SKILL.md')))
    const r = runDoctor({ cwd: p.cwd, config: loadConfig(p.cwd).merged, running: '0.0.0', templatesRoot: p.templates, exceptions: EXCEPTIONS }, { offline: true })
    const f = r.checks.find((c) => c.id === 'lifecycle').findings
    assert.deepEqual(f.map((x) => [x.level, x.message, x.fix]), [['warn', 'debt: the legacy feature "old-flow" is enabled; it is removed in 0.6.0', 'move to /start and /pr, then remove "old-flow" from legacy in agent-os.json']])
    assert.equal(r.checks.find((c) => c.id === 'skills').level, 'ok', 'an installed legacy skill counts as managed')
  } finally { rmSync(p.root, { recursive: true, force: true }) }
})

test('legacy items are absent unless enabled', () => {
  const p = project({})
  try {
    installRoutes(p.cwd, loadConfig(p.cwd).merged, { version: '0.0.0', templatesRoot: p.templates })
    assert.ok(existsSync(join(p.cwd, '.claude/skills/start/SKILL.md')))
    assert.ok(!existsSync(join(p.cwd, '.claude/skills/old-flow')))
    assert.deepEqual(legacyFeatures(p.templates), ['old-flow'])
  } finally { rmSync(p.root, { recursive: true, force: true }) }
})

test('an unknown legacy id fails doctor; deprecated items still in use are listed with their replacement', () => {
  const p = project({ legacy: ['nope'] })
  try {
    write(p.cwd, { 'agent-os.json': JSON.stringify({ version: '0.0.0', legacy: ['nope'], old: { key: 1 } }) })
    const config = { branches: { integration: 'development', production: 'main' }, legacy: ['nope'], languages: {}, contextBudgets: {}, slots: {} }
    const r = runDoctor({ cwd: p.cwd, config, running: '0.0.0', templatesRoot: p.templates, exceptions: EXCEPTIONS }, { offline: true, only: ['lifecycle'] })
    const f = r.checks[0].findings
    assert.equal(f[0].level, 'fail')
    assert.match(f[0].message, /"nope" is not a legacy feature/)
    assert.match(f[0].fix, /use one of old-flow/)
    assert.deepEqual(f.slice(1).map((x) => x.message), ['this project uses old.key is deprecated and will be removed in 0.7.0; use new.key'])
    assert.equal(f[1].fix, 'switch to new.key')
  } finally { rmSync(p.root, { recursive: true, force: true }) }
})

test('a deprecated command or flag prints a note when it runs', () => {
  assert.deepEqual(runNotices('hook', { 'print-settings': true, json: false }, EXCEPTIONS), ['hook --print-settings is deprecated and will be removed in 0.7.0; use setup'])
  assert.deepEqual(runNotices('hook', { json: true }, EXCEPTIONS), [])
})
