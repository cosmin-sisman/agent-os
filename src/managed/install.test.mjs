// Tests for installing the platform routes: only the active route is written, GitLab gets /mr with a /pr alias, the
// lock records the platform, and every shipped template renders validly for every platform and language.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { planInstall, installRoutes } from './install.mjs'
import { readLock } from './managed.mjs'
import { withDefaults } from '../config/config.mjs'
import { SCHEMA } from '../config/schema.mjs'
import { parse } from '../yaml/yaml.mjs'
import { findDiacritics } from '../i18n/i18n.mjs'

const config = (platform, languages = {}) => withDefaults(SCHEMA, { platform: { type: platform }, languages })
const tmp = () => mkdtempSync(join(tmpdir(), 'aos-install-'))

test('installing for GitHub writes the GitHub route and never a .gitlab folder; the lock records the platform', () => {
  const dir = tmp()
  try {
    const r = installRoutes(dir, config('github'), { version: '0.1.0' })
    assert.ok(r.results.every((x) => x.action === 'installed'))
    assert.ok(existsSync(join(dir, '.github/pull_request_template.md')))
    assert.ok(existsSync(join(dir, '.claude/skills/pr/SKILL.md')))
    assert.equal(existsSync(join(dir, '.gitlab')), false)
    assert.equal(existsSync(join(dir, '.claude/skills/mr')), false)
    assert.equal(readLock(dir).platform, 'github')
    assert.ok(installRoutes(dir, config('github'), { version: '0.1.0' }).results.every((x) => x.action === 'unchanged'))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('installing for GitLab writes only the GitLab route', () => {
  const dir = tmp()
  try {
    installRoutes(dir, config('gitlab'), { version: '0.1.0' })
    assert.equal(existsSync(join(dir, '.github')), false)
    assert.ok(existsSync(join(dir, '.gitlab/merge_request_templates/Default.md')))
    assert.ok(existsSync(join(dir, '.gitlab/issue_templates/Bug.md')))
    assert.ok(Object.keys(readLock(dir).items).every((k) => !k.startsWith('.github/')))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('given platform gitlab, /pr is an alias of /mr and the skills speak of merge requests', () => {
  const plan = planInstall(config('gitlab'))
  assert.deepEqual(plan.aliases, [{ alias: 'pr', target: 'mr' }])
  const mr = plan.items.find((i) => i.key === '.claude/skills/mr/SKILL.md').content
  const pr = plan.items.find((i) => i.key === '.claude/skills/pr/SKILL.md').content
  assert.match(mr, /^name: mr$/m)
  assert.match(mr, /merge request/)
  assert.match(mr, /`!N`/)
  assert.match(pr, /alias of \/mr/)
  assert.match(pr, /Run `\/mr \$ARGUMENTS`/)
  const gh = planInstall(config('github'))
  assert.deepEqual(gh.aliases, [])
  assert.match(gh.items.find((i) => i.key === '.claude/skills/pr/SKILL.md').content, /pull request[\s\S]*`#N`/)
})

test('the change-request and issue templates follow their area languages', () => {
  const plan = planInstall(config('gitlab', { issues: 'ro', prs: 'en', labels: 'ro' }))
  assert.match(plan.items.find((i) => i.key === '.gitlab/issue_templates/Bug.md').content, /## Ce se intampla[\s\S]*\/label ~"tip:bug"/)
  assert.match(plan.items.find((i) => i.key === '.gitlab/merge_request_templates/Default.md').content, /^## What/m)
})

test('switching platform is refused and points to #98', () => {
  const dir = tmp()
  try {
    installRoutes(dir, config('github'), { version: '0.1.0' })
    assert.throws(() => installRoutes(dir, config('gitlab'), { version: '0.1.0' }), (err) => /installed for github/.test(err.message) && /#98/.test(err.hint))
    assert.equal(existsSync(join(dir, '.gitlab')), false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a route that would override a core file is refused', () => {
  const root = tmp()
  try {
    for (const p of ['core/AGENTS.md', 'platform/github/AGENTS.md']) { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), 'x') }
    assert.throws(() => planInstall(config('github'), { templatesRoot: root }), /AGENTS\.md comes from both core and platform\/github/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('every shipped template renders for each platform and language; YAML parses and ro text is ASCII', () => {
  for (const platform of ['github', 'gitlab']) {
    for (const lang of ['en', 'ro']) {
      const plan = planInstall(config(platform, { issues: lang, prs: lang, labels: lang }))
      for (const item of plan.items) {
        if (/\.ya?ml$/.test(item.key)) assert.doesNotThrow(() => parse(item.content, { file: item.key }), `${platform}/${lang}: ${item.key}`)
        if (lang === 'ro') assert.deepEqual(findDiacritics(item.content), [], `${platform}/ro: ${item.key}`)
        // CI expressions (${{ … }}) are meant to be there; any other braces are a tag the engine missed.
        assert.doesNotMatch(item.content.replace(/\$\{\{[^}]*\}\}/g, ''), /\{\{|\}\}/, `${platform}/${lang}: ${item.key} has an unrendered tag`)
      }
    }
  }
})

test('dry-run installs nothing and records nothing', () => {
  const dir = tmp()
  try {
    installRoutes(dir, config('github'), { version: '0.1.0', dryRun: true })
    assert.deepEqual(readdirSync(dir), [])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a project whose own CI already runs the loop and the gate can leave out those jobs, and the retro schedule', () => {
  for (const type of ['github', 'gitlab']) {
    const keys = (ci) => planInstall(withDefaults(SCHEMA, { platform: { type, project: 'acme/shop' }, ci })).items.map((i) => i.key).filter((k) => /agent-os-(loop|gate|retro)\.yml$/.test(k))
    assert.equal(keys({}).length, 3, `${type}: installed by default`)
    assert.deepEqual(keys({ loop: false, gate: false, retro: false }), [], `${type}: left out when turned off`)
    assert.deepEqual(keys({ retro: false }).map((k) => k.split('/').pop()), ['agent-os-gate.yml', 'agent-os-loop.yml'])
  }
})
