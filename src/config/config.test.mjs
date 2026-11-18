// Tests for configuration validation, defaults, the team/personal split and the published schemas.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validate, loadConfig, isPersonal, keyPaths, ensureGitignore, setPath } from './config.mjs'
import { pick, SCHEMA } from './schema.mjs'
import { FILES, render, DOC, renderDoc } from '../../scripts/schema/build.mjs'

const team = (v) => validate(v, { personal: false, file: 'agent-os.json' })
const local = (v) => validate(v, { personal: true, file: '.agent-os/local.json' })

function repo(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'aos-config-'))
  for (const [path, value] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), typeof value === 'string' ? value : JSON.stringify(value))
  }
  return dir
}

test('a valid team file has no problems', () => {
  assert.deepEqual(team({ platform: { type: 'gitlab', host: 'https://git.example.internal', project: 'team/app' }, languages: { issues: 'ro', prs: 'en' }, slots: { review: 'code-review', 'ui-design': null } }), [])
})

test('languages.chat in agent-os.json fails because chat is personal', () => {
  const [problem] = team({ languages: { chat: 'ro' } })
  assert.match(problem, /^agent-os\.json: languages\.chat is personal: set it in \.agent-os\/local\.json/)
})

test('a team key in the personal file names the team file', () => {
  assert.match(local({ languages: { issues: 'ro' } })[0], /languages\.issues is a team setting: set it in agent-os\.json/)
})

test('an invalid value names the key, what was expected and what was found', () => {
  assert.deepEqual(team({ languages: { issues: 'fr' } }), ['agent-os.json: languages.issues: expected one of "en", "ro", got "fr"'])
  assert.deepEqual(local({ machine: { devPortStart: 80 } }), ['.agent-os/local.json: machine.devPortStart: expected at least 1024, got 80'])
  assert.match(team({ packs: 'pg' })[0], /packs: expected array, got string "pg"/)
  assert.match(team({ platform: { host: 'git.example' } })[0], /platform\.host: "git\.example" does not match/)
})

test('unknown keys are reported with a did-you-mean', () => {
  assert.equal(team({ platform: { hots: 'x' } })[0], 'agent-os.json: platform.hots: unknown key; did you mean "host"?')
})

test('required fields inside lists are checked', () => {
  assert.match(team({ requires: { mcp: [{ name: 'pg' }] } })[0], /requires\.mcp\[0\]\.scope: required/)
})

test('loadConfig merges defaults, team and personal values', () => {
  const dir = repo({ 'agent-os.json': { languages: { issues: 'ro' } }, '.agent-os/local.json': { languages: { chat: 'ro' }, machine: { maxWorkers: 2 } } })
  try {
    const { merged, initialized } = loadConfig(dir)
    assert.equal(initialized, true)
    assert.equal(merged.languages.issues, 'ro')
    assert.equal(merged.languages.chat, 'ro')
    assert.equal(merged.languages.prs, 'en')
    assert.equal(merged.machine.maxWorkers, 2)
    assert.equal(merged.machine.devPortStart, 5174)
    assert.equal(merged.branches.integration, 'development')
    assert.equal(merged.platform.type, 'github')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('without any file, defaults apply and the project is not initialized', () => {
  const dir = repo()
  try {
    const { merged, initialized } = loadConfig(dir)
    assert.equal(initialized, false)
    assert.equal(merged.profile, 'active')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('loadConfig lists every problem in both files at once', () => {
  const dir = repo({ 'agent-os.json': { languages: { chat: 'ro', issues: 'de' } }, '.agent-os/local.json': '{ not json' })
  try {
    assert.throws(() => loadConfig(dir), /local\.json is not valid JSON/)
    writeFileSync(join(dir, '.agent-os/local.json'), JSON.stringify({ profile: 'active' }))
    assert.throws(() => loadConfig(dir), (err) => err.message.split('\n  - ').length === 4)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('personal keys are exactly chat, machine and orchestrator', () => {
  const personal = keyPaths().filter((k) => !k.includes('<') && isPersonal(k))
  assert.deepEqual(personal.sort(), ['languages.chat', 'machine', 'machine.devPortStart', 'machine.maxWorkers', 'machine.minFreeMb', 'orchestrator'])
})

test('the team and personal schemas share no key', () => {
  const keys = (node, prefix = '') => Object.entries(node?.properties ?? {}).flatMap(([k, c]) => [`${prefix}${k}`, ...keys(c, `${prefix}${k}.`)])
  const t = new Set(keys(pick(SCHEMA, false)).filter((k) => !['languages'].includes(k)))
  for (const k of keys(pick(SCHEMA, true))) if (k !== 'languages') assert.ok(!t.has(k), k)
})

test('ensureGitignore adds the personal and cache entries once', () => {
  const dir = repo({ '.gitignore': 'node_modules/' })
  try {
    assert.deepEqual(ensureGitignore(dir), ['.agent-os/local.json', '.agent-os/cache/'])
    assert.deepEqual(ensureGitignore(dir), [])
    assert.equal(readFileSync(join(dir, '.gitignore'), 'utf8'), 'node_modules/\n.agent-os/local.json\n.agent-os/cache/\n')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('setPath creates the path without changing the original', () => {
  const a = { languages: { issues: 'en' } }
  assert.deepEqual(setPath(a, 'languages.prs', 'ro'), { languages: { issues: 'en', prs: 'ro' } })
  assert.deepEqual(a, { languages: { issues: 'en' } })
})

test('the published schemas and the reference table are up to date', () => {
  for (const [file, personal] of Object.entries(FILES)) assert.equal(readFileSync(file, 'utf8'), render(personal), `${file}: run npm run schema`)
  const doc = readFileSync(DOC, 'utf8')
  assert.equal(doc, renderDoc(doc), `${DOC}: run npm run schema`)
})
