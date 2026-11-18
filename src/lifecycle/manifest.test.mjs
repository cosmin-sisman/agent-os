// Tests for the lifecycle manifest: collecting items, carrying states across releases, the release rules, and finding
// deprecated items a project still uses. The last test applies the release rules to this repository on every PR.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { collectItems, buildManifest, checkManifest, deprecatedInUse, readExceptions } from './manifest.mjs'
import { currentManifest, PACKAGE_MANIFEST } from '../commands/manifest.mjs'

const manifest = (items) => ({ manifestVersion: 1, version: 'x', items })
const always = () => true

test('items are collected from commands, flags, config, hooks, templates and the catalog', async () => {
  const ids = await collectItems()
  for (const id of ['command:issue', 'flag:issue --label', 'flag:* --json', 'config:languages.chat', 'hook:guards', 'template:core/.claude/skills/__crSkill__/SKILL.md', 'template:platform/github/.github/pull_request_template.md', 'catalog:technologies:astro']) assert.ok(ids.includes(id), id)
  assert.ok(!ids.some((i) => /\.(en|ro)\.(md|yml)$/.test(i)), 'language variants are one item')
})

test('a new item starts as new; states carry over; exceptions apply', () => {
  const m = buildManifest({ version: '0.2.0', items: ['a', 'b', 'c'], previous: manifest({ a: { status: 'stable', since: '0.1.0' }, b: { status: 'new', since: '0.1.0' } }), exceptions: [{ id: 'b', status: 'deprecated', deprecatedIn: '0.2.0', removeIn: '0.4.0', replacement: 'c' }] })
  assert.deepEqual(m.items.a, { status: 'stable', since: '0.1.0' })
  assert.equal(m.items.b.status, 'deprecated')
  assert.deepEqual(m.items.c, { status: 'new', since: '0.2.0' })
})

test('nothing goes from stable to removed directly', () => {
  const prev = manifest({ x: { status: 'stable' } })
  const next = buildManifest({ version: '0.3.0', items: [], previous: prev, exceptions: [{ id: 'x', status: 'removed', migration: '0.3.0' }] })
  assert.deepEqual(checkManifest(next, prev, { migrationExists: always }), ['x: stable → removed is not allowed (stable may become deprecated)'])
})

test('an item that disappears without a lifecycle entry fails the release', () => {
  const prev = manifest({ 'config:old.key': { status: 'new' } })
  const problems = checkManifest(buildManifest({ version: '0.3.0', items: [], previous: prev }), prev)
  assert.match(problems[0], /config:old\.key disappeared without being deprecated/)
})

test('deprecated and legacy need deprecatedIn, removeIn and a replacement; removed needs an existing migration', () => {
  const prev = manifest({ a: { status: 'stable' }, b: { status: 'deprecated', deprecatedIn: '1', removeIn: '2', replacement: 'z' }, c: { status: 'deprecated', deprecatedIn: '1', removeIn: '2', replacement: 'z' } })
  const next = manifest({ a: { status: 'deprecated' }, b: { status: 'removed' }, c: { status: 'removed', migration: '0.9.0' } })
  const problems = checkManifest(next, prev, { migrationExists: (v) => v === '0.8.0' })
  assert.ok(problems.includes('a: deprecated needs deprecatedIn'))
  assert.ok(problems.includes('a: deprecated needs replacement'))
  assert.ok(problems.some((p) => p.startsWith('b: removed needs a migration')))
  assert.ok(problems.includes('c: migration 0.9.0 does not exist (migrations/0.9.0.mjs)'))
})

test('the allowed path passes: new → stable → deprecated → legacy → removed', () => {
  const dep = { deprecatedIn: '1', removeIn: '2', replacement: 'z' }
  const steps = [{ status: 'new' }, { status: 'stable' }, { status: 'deprecated', ...dep }, { status: 'legacy', ...dep }, { status: 'removed', migration: '2' }]
  for (let i = 1; i < steps.length; i++) assert.deepEqual(checkManifest(manifest({ x: steps[i] }), manifest({ x: steps[i - 1] }), { migrationExists: always }), [], `${steps[i - 1].status} → ${steps[i].status}`)
  assert.match(checkManifest(manifest({ x: { status: 'legacy', ...dep } }), manifest({ x: { status: 'new' } }))[0], /new → legacy is not allowed/)
})

test('given a deprecated flag used in a hook, usage names the replacement and the removal version', () => {
  const m = manifest({ 'flag:hook --print-settings': { status: 'deprecated', deprecatedIn: '0.5.0', removeIn: '0.7.0', replacement: 'agent-os setup --only files' }, 'command:hook': { status: 'stable' } })
  const found = deprecatedInUse(m, { hookCommands: ['npx -y @cosmin-sisman/agent-os@0.5.0 hook --print-settings', 'npx -y @cosmin-sisman/agent-os@0.5.0 hook Stop'] })
  assert.deepEqual(found, [{ id: 'flag:hook --print-settings', status: 'deprecated', replacement: 'agent-os setup --only files', removeIn: '0.7.0', message: 'flag:hook --print-settings is deprecated, removed in 0.7.0; use agent-os setup --only files' }])
})

test('deprecated config keys in either file are found too', () => {
  const m = manifest({ 'config:machine.maxWorkers': { status: 'deprecated', removeIn: '1.0.0', replacement: 'machine.sessions' } })
  assert.equal(deprecatedInUse(m, { local: { machine: { maxWorkers: 2 } } })[0].id, 'config:machine.maxWorkers')
  assert.deepEqual(deprecatedInUse(m, { team: { languages: { issues: 'ro' } } }), [])
})

test('the lifecycle exceptions file is valid', () => {
  for (const e of readExceptions()) assert.ok(e.id && e.status, JSON.stringify(e))
})

test("this repository's changes keep the lifecycle rules against the last released manifest", async () => {
  const committed = JSON.parse(readFileSync(PACKAGE_MANIFEST, 'utf8'))
  assert.deepEqual(checkManifest(await currentManifest(), committed), [], 'deprecate before removing (src/lifecycle/lifecycle.yaml), or add the migration')
})
