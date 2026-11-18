// Tests for the skill index: three tables from the registry and the folders, descriptions from front matter, a new
// local skill showing up at once, and the SessionStart line.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { indexLine, indexMarkdown, skillIndex } from './skill-index.mjs'
import { registerSkill } from './registry.mjs'
import { loadConfig } from '../config/config.mjs'
import { installRoutes } from '../managed/install.mjs'
import { run } from '../cli/main.mjs'

const skill = (cwd, name, description) => { mkdirSync(join(cwd, '.claude/skills', name), { recursive: true }); writeFileSync(join(cwd, '.claude/skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n`) }
function project() {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-index-'))
  writeFileSync(join(cwd, 'agent-os.json'), JSON.stringify({ version: '0.0.0', platform: { type: 'github', project: 'acme/app' } }))
  installRoutes(cwd, loadConfig(cwd).merged, { version: '0.0.0' })
  return cwd
}

test('three tables: core from the install, external (with plugin and builtin), local; descriptions from front matter', () => {
  const cwd = project()
  try {
    skill(cwd, 'impeccable', 'Reviews UI design. Long details follow.')
    registerSkill(cwd, { name: 'impeccable', origin: 'external', source: 'github:pbakaus/impeccable@4f2a9c1', version: '4.5.0', provides: ['ui-design'] })
    skill(cwd, 'deploy', 'Deploys to staging.')
    registerSkill(cwd, { name: 'deploy', origin: 'local' })
    const i = skillIndex(cwd)
    assert.ok(i.core.some((r) => r.name === 'start' && /^Start work on an issue/.test(r.description)))
    assert.deepEqual(i.external.map((r) => [r.name, r.origin]), [['code-review', 'builtin'], ['impeccable', 'external'], ['security-review', 'builtin']], 'the built-ins the slots bind are registered by the install')
    assert.deepEqual(i.local.map((r) => r.name), ['deploy'])
    const md = indexMarkdown(i)
    assert.match(md, /## External\n\n\| Skill \| What it does \| Source \| Provides \|\n\|---\|---\|---\|---\|\n\| \/code-review \| Claude Code built-in code review\. \| builtin: claude-code \| review \|\n\| \/impeccable \| Reviews UI design\. \| github:pbakaus\/impeccable@4f2a9c1 \(4\.5\.0\) \| ui-design \|/)
    assert.match(md, /## Local\n\n\| Skill \| What it does \| Provides \|\n\|---\|---\|---\|\n\| \/deploy \| Deploys to staging\. \| — \|/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('given a new local skill, it appears under Local immediately, with no edit anywhere else', async () => {
  const cwd = project()
  try {
    skill(cwd, 'seed-db', 'Seeds the database.')
    let stdout = ''
    await run(['skills'], { stdout: (s) => { stdout += s }, stderr: () => {}, cwd, env: {} })
    assert.match(stdout, /## Local\n\n[^#]*\| \/seed-db _\(unregistered\)_ \| Seeds the database\. \|/)
    assert.match(indexLine(skillIndex(cwd)), /; local \/seed-db \(agent-os skills for what each does\)\.$/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('the SessionStart line lists the groups in one line', () => {
  const cwd = project()
  try {
    const line = indexLine(skillIndex(cwd))
    const core = readdirSync(join(cwd, '.claude/skills')).sort().map((n) => `/${n}`).join(' ')
    assert.equal(line, `Skills: core ${core}; external /code-review /security-review (agent-os skills for what each does).`, 'every installed skill, in one line')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
