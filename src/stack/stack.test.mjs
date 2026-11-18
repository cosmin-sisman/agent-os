// Tests for the standards rules: the core rule always installed, language rules chosen from stack.yaml and scoped to
// their layers' paths, "read the docs first" for technologies agents know poorly, both languages, and the budget.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { languagesInUse, stackLayers } from './stack.mjs'
import { loadConfig } from '../config/config.mjs'
import { installRoutes, stackRules, TEMPLATES } from '../managed/install.mjs'
import { render } from '../templates/engine.mjs'
import { buildContext } from '../templates/tree.mjs'
import { findDiacritics } from '../i18n/i18n.mjs'

const STACK = `project: "Shop"
layers:
  internal-api:
    tech: fastapi
    status: chosen
    paths: ["services/api/**"]
  workers:
    tech: fastapi
    status: chosen
    paths: ["services/workers/**"]
  events:
    tech: scylladb
    status: chosen
    paths: ["db/events/**"]
  web:
    tech: astro
    status: evaluating
    paths: ["apps/site/**"]
`
function project(config = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-stack-'))
  writeFileSync(join(cwd, 'agent-os.json'), JSON.stringify({ version: '0.0.0', platform: { type: 'github', project: 'acme/app' }, ...config }))
  writeFileSync(join(cwd, 'stack.yaml'), STACK)
  return cwd
}

test('layers in use come from stack.yaml and the catalog; evaluating layers are left out', () => {
  const cwd = project()
  try {
    assert.deepEqual(languagesInUse(stackLayers(cwd)), [
      { language: 'python', paths: ['services/api/**', 'services/workers/**'], lowAi: [] },
      { language: 'sql', paths: ['db/events/**'], lowAi: ['ScyllaDB'] },
    ])
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('given a Python layer in stack.yaml, the Python rule is installed and scoped to its paths', () => {
  const cwd = project()
  try {
    installRoutes(cwd, loadConfig(cwd).merged, { version: '0.0.0' })
    const python = readFileSync(join(cwd, '.claude/rules/stack/python.md'), 'utf8')
    assert.match(python, /^---\npaths:\n {2}- "services\/api\/\*\*"\n {2}- "services\/workers\/\*\*"\n---\n\n# Python\n\nApplies to `services\/api\/\*\*`, `services\/workers\/\*\*`\./)
    assert.doesNotMatch(python, /Read the docs first/)
    assert.match(readFileSync(join(cwd, '.claude/rules/stack/sql.md'), 'utf8'), /## Read the docs first\n\nAgents know ScyllaDB poorly/)
    assert.ok(!existsSync(join(cwd, '.claude/rules/stack/typescript.md')), 'an evaluating layer installs nothing')
    assert.match(readFileSync(join(cwd, '.claude/rules/standards.md'), 'utf8'), /^# Coding standards/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('in ro the rules are in Romanian without diacritics; without stack.yaml only the core rule is installed', () => {
  const cwd = project({ languages: { docs: 'ro' } })
  try {
    const rules = stackRules(loadConfig(cwd).merged, { cwd })
    assert.match(rules.find((r) => r.key.endsWith('python.md')).content, /# Python\n\nSe aplica pentru/)
    for (const r of rules) assert.deepEqual(findDiacritics(r.content), [])
    rmSync(join(cwd, 'stack.yaml'))
    assert.deepEqual(stackRules(loadConfig(cwd).merged, { cwd }), [])
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('every rule stays within the 6 KB context budget, in both languages, and renders with no tag left', () => {
  for (const lang of ['en', 'ro']) {
    const context = { ...buildContext({ languages: { docs: lang, codeComments: lang }, platform: { type: 'github' }, branches: {} }), paths: '`services/api/**`, `services/workers/**`, `apps/web/**`', lowAi: 'ScyllaDB, Webflow' }
    const files = [join(TEMPLATES, 'core/.claude/rules', `standards.${lang}.md`), ...readdirSync(join(TEMPLATES, 'stack')).filter((f) => f.endsWith(`.${lang}.md`)).map((f) => join(TEMPLATES, 'stack', f))]
    for (const f of files) {
      const out = render(readFileSync(f, 'utf8'), context, { file: f })
      assert.ok(Buffer.byteLength(out) <= 6 * 1024, `${f} is ${Buffer.byteLength(out)} bytes`)
      assert.doesNotMatch(out, /\{\{|\}\}/)
      if (lang === 'ro') assert.deepEqual(findDiacritics(out), [], f)
    }
  }
})
