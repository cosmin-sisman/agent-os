// Tests for capability slots: defaults bind Claude Code built-ins, the rest are explicitly empty after init, templates
// call slots and never skills, swapping a design skill is one config line, doctor wants every slot decided, and an
// unbound ui-design slot warns on a UI change and lets the change request go ahead.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SLOTS, SLOT_DEFAULTS, slotsFor } from './slots.mjs'
import { planInstall } from '../managed/install.mjs'
import { runDoctor } from '../doctor/doctor.mjs'
import { buildConfig } from '../init/init.mjs'
import { saveResult } from '../gate/gate.mjs'
import { preflight } from '../workflow/pr.mjs'
import { withDefaults } from '../config/config.mjs'
import { SCHEMA } from '../config/schema.mjs'

const merge = (c) => withDefaults(SCHEMA, c)
const raw = { platform: { type: 'github', project: 'acme/app' }, branches: { integration: 'development', production: 'main' }, languages: {}, conventions: { types: ['feat'], maxTitleLength: 72, exempt: [] }, contextBudgets: {} }
const base = merge(raw)
const prSkill = (config) => planInstall(config).items.find((i) => i.key === '.claude/skills/pr/SKILL.md').content

test('defaults bind the built-ins where they exist; init writes every slot, bound or explicitly empty', () => {
  assert.deepEqual(SLOT_DEFAULTS, { review: 'code-review', 'security-review': 'security-review', standards: null, testing: null, 'ui-design': null, ci: null, docs: null })
  assert.deepEqual(slotsFor({ slots: { 'ui-design': 'impeccable' } })['ui-design'], 'impeccable')
  const { team } = buildConfig({ profile: 'active', platform: base.platform, integration: 'development', production: 'main', team: true, lang: 'en', areaLangs: {}, chat: 'en', version: '0.0.0', cwd: tmpdir() })
  assert.deepEqual(Object.keys(team.slots), SLOTS)
})

test('swapping a design skill is a one-line config change; core templates name the slot, never a skill', () => {
  assert.match(prSkill(base), /no ui-design skill is bound and the UI was reviewed by hand; continue/)
  assert.match(prSkill(merge({ ...raw, slots: { 'ui-design': 'impeccable' } })), /run the `impeccable` skill on it/)
  assert.doesNotMatch(prSkill(base), /impeccable/)
})

test('the built-ins bound by default are registered; a rebound slot drops its built-in', () => {
  const keys = (c) => planInstall(c).items.map((i) => i.key).filter((k) => k.startsWith('.agent-os/registry/') && /review/.test(k))
  assert.deepEqual(keys(base), ['.agent-os/registry/code-review.json', '.agent-os/registry/security-review.json'])
  assert.deepEqual(keys(merge({ ...raw, slots: { review: 'my-review' } })), ['.agent-os/registry/security-review.json'])
})

test('doctor: every slot decided; a bound skill that does not exist is reported', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-slots-'))
  try {
    const f = (slots) => runDoctor({ cwd, config: merge({ ...raw, slots }), running: '0.0.0' }, { offline: true, only: ['slots'] }).checks[0].findings.filter((x) => x.level !== 'ok').map((x) => x.message)
    assert.ok(f({}).includes('slot "ui-design" is neither bound nor explicitly empty'))
    const decided = Object.fromEntries(SLOTS.map((s) => [s, null]))
    assert.deepEqual(f(decided), [])
    assert.deepEqual(f({ ...decided, 'ui-design': 'impeccable' }), ['slot "ui-design" is bound to "impeccable", which is neither in .claude/skills/ nor registered'])
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('given ui-design unbound, when /pr touches UI, it warns and continues', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-slots-'))
  try {
    saveResult(cwd, { head: 'abc', clean: true, ok: true, suites: [] })
    const git = (args) => {
      const k = args.join(' ')
      if (k === 'rev-parse --abbrev-ref HEAD') return { status: 0, stdout: 'feat/40-x\n' }
      if (k === 'rev-parse HEAD') return { status: 0, stdout: 'abc\n' }
      if (k.includes('--diff-filter=A')) return { status: 0, stdout: '.agent-os/journal/2026/11/x.md' }
      if (k.startsWith('diff --name-only')) return { status: 0, stdout: 'src/components/Button.tsx\n' }
      return { status: 0, stdout: '' }
    }
    const body = '## Why\n\nCloses #40\n\n## How it was tested\n\nx\n\n## Lessons\n\nNone: x'
    const r = preflight({ config: base, git, cwd, tracker: null }, { title: 'feat(ui): a button [#40]', body })
    assert.equal(r.ok, true, 'it continues')
    assert.match(r.warnings[0], /no ui-design skill is bound \(slots\.ui-design\)/)
    const bound = preflight({ config: { ...base, slots: { 'ui-design': 'impeccable' } }, git, cwd, tracker: null }, { title: 'feat(ui): a button [#40]', body })
    assert.deepEqual(bound.warnings, [])
    assert.ok(!existsSync(join(cwd, '.claude')))
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
