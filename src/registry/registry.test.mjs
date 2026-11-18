// Tests for the skill registry: the entry schema, core entries from the install, registering local, external, plugin
// and builtin skills, doctor on every mismatch, and two branches adding skills merging without conflict.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readRegistry, registerSkill, validateEntry } from './registry.mjs'
import { loadConfig } from '../config/config.mjs'
import { installRoutes } from '../managed/install.mjs'
import { runDoctor } from '../doctor/doctor.mjs'

const skill = (cwd, name) => { mkdirSync(join(cwd, '.claude/skills', name), { recursive: true }); writeFileSync(join(cwd, '.claude/skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: Does ${name}.\n---\n`) }
function project() {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-registry-'))
  writeFileSync(join(cwd, 'agent-os.json'), JSON.stringify({ version: '0.0.0', platform: { type: 'github', project: 'acme/app' } }))
  writeFileSync(join(cwd, '.gitignore'), '.agent-os/local.json\n.agent-os/cache/\n')
  return cwd
}

test('the entry schema', () => {
  assert.deepEqual(validateEntry({ name: 'impeccable', origin: 'external', source: 'github:pbakaus/impeccable@4f2a9c1', version: '4.5.0', license: 'Apache-2.0', provides: ['ui-design'], managed: false }, 'impeccable.json'), [])
  assert.deepEqual(validateEntry({ name: 'x', origin: 'external', source: 'github:a/b' }, 'y.json'), ['the file must be named x.json', 'an external skill needs source "<host>:<owner>/<repo>@<commit or tag>", pinned'])
  assert.deepEqual(validateEntry({ name: 'X', origin: 'mine', provides: 'review', extra: 1 }), ['unknown key "extra" (known: name, origin, source, version, license, provides, managed, description)', 'name must be lowercase kebab-case', 'origin must be one of core, external, local, plugin, builtin', 'provides must be a list of slot names'])
})

test('install writes a core entry for every core skill; a fresh install is consistent', () => {
  const cwd = project()
  try {
    installRoutes(cwd, loadConfig(cwd).merged, { version: '0.0.0' })
    const start = JSON.parse(readFileSync(join(cwd, '.agent-os/registry/start.json'), 'utf8'))
    assert.deepEqual({ ...start, description: undefined }, { name: 'start', origin: 'core', source: 'agent-os', version: '0.0.0', license: 'MIT', provides: [], managed: true, description: undefined })
    assert.match(start.description, /^Start work on an issue/)
    const d = runDoctor({ cwd, config: loadConfig(cwd).merged, running: '0.0.0' }, { offline: true, only: ['skills'] })
    assert.equal(d.checks[0].level, 'ok', JSON.stringify(d.checks[0].findings))
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('register: local and external need their folder; plugin and builtin skills are registered without files', () => {
  const cwd = project()
  try {
    assert.throws(() => registerSkill(cwd, { name: 'deploy', origin: 'local' }), /no \.claude\/skills\/deploy\/SKILL\.md/)
    skill(cwd, 'deploy')
    assert.equal(registerSkill(cwd, { name: 'deploy', origin: 'local' }).path, '.agent-os/registry/deploy.json')
    assert.throws(() => registerSkill(cwd, { name: 'deploy', origin: 'local' }), /already exists/)
    registerSkill(cwd, { name: 'code-review', origin: 'builtin', provides: ['review'] })
    registerSkill(cwd, { name: 'frontend-design', origin: 'plugin', source: 'claude-plugins:frontend-design', provides: ['ui-design'] })
    assert.throws(() => registerSkill(cwd, { name: 'start', origin: 'core' }), /core skills are registered by agent-os/)
    assert.deepEqual(readRegistry(cwd).map((r) => [r.entry.name, r.entry.origin, r.problems.length]), [['code-review', 'builtin', 0], ['deploy', 'local', 0], ['frontend-design', 'plugin', 0]])
    const d = runDoctor({ cwd, config: loadConfig(cwd).merged, running: '0.0.0' }, { offline: true, only: ['skills', 'slots'] })
    assert.equal(d.summary.fail, 0)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('doctor fails on any mismatch between folders and entries, and on an invalid entry', () => {
  const cwd = project()
  try {
    skill(cwd, 'orphan')
    mkdirSync(join(cwd, '.agent-os/registry'), { recursive: true })
    writeFileSync(join(cwd, '.agent-os/registry/ghost.json'), JSON.stringify({ name: 'ghost', origin: 'local' }))
    writeFileSync(join(cwd, '.agent-os/registry/bad.json'), '{ nope')
    const f = runDoctor({ cwd, config: loadConfig(cwd).merged, running: '0.0.0' }, { offline: true, only: ['skills'] }).checks[0].findings
    assert.deepEqual(f.map((x) => x.message).sort(), ['.agent-os/registry/bad.json: not valid JSON', '.agent-os/registry/ghost.json registers "ghost", which has no folder in .claude/skills/', 'the skill folder .claude/skills/orphan has no registry entry'])
    assert.ok(f.every((x) => x.level === 'fail'))
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('given two branches each adding a skill, they merge without conflict', () => {
  const cwd = project()
  try {
    const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(cwd, '.gc'), GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@e.com', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@e.com' }
    writeFileSync(join(cwd, '.gc'), '[commit]\n\tgpgsign = false\n[init]\n\tdefaultBranch = development\n')
    const g = (...a) => { const r = spawnSync('git', a, { cwd, env, encoding: 'utf8' }); if (r.status) throw new Error(`git ${a.join(' ')}: ${r.stderr}`); return r.stdout }
    g('init', '-q'); g('add', '-A'); g('commit', '-qm', 'base')
    g('switch', '-qc', 'a'); skill(cwd, 'deploy'); registerSkill(cwd, { name: 'deploy', origin: 'local' }); g('add', '-A'); g('commit', '-qm', 'deploy')
    g('switch', '-q', 'development'); g('switch', '-qc', 'b'); skill(cwd, 'seed-db'); registerSkill(cwd, { name: 'seed-db', origin: 'local' }); g('add', '-A'); g('commit', '-qm', 'seed')
    g('switch', '-q', 'development'); g('merge', '-q', '--no-edit', 'a'); g('merge', '-q', '--no-edit', 'b')
    assert.deepEqual(readRegistry(cwd).map((r) => r.entry.name), ['deploy', 'seed-db'])
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
