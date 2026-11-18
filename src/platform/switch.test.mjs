// Tests for the platform switch plan: a GitHub project switched to GitLab removes .github/ and adds .gitlab-ci.yml in
// one change request; no file from the old route remains once the plan's manual steps are done; files edited by hand
// are conflicts, never deleted; journal references are re-linked from the importer's map. Nothing changes in the
// repository while planning.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { switchPlan } from './switch.mjs'
import { installRoutes } from '../managed/install.mjs'
import { loadConfig } from '../config/config.mjs'
import { run } from '../cli/main.mjs'

const FIXTURE = fileURLToPath(new URL('./__fixtures__/switch-github/', import.meta.url))
function project({ ownCi = true } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-switch-'))
  cpSync(FIXTURE, cwd, { recursive: true })
  rmSync(join(cwd, 'README.md'))
  if (!ownCi) rmSync(join(cwd, '.github/workflows/ci.yml'))
  installRoutes(cwd, loadConfig(cwd).merged, { version: '0.0.0' })
  return cwd
}
const map = JSON.parse(readFileSync(join(FIXTURE, 'issue-map.json'), 'utf8'))

test('given a GitHub project switched to GitLab, .github/ is removed and .gitlab-ci.yml is added in one MR', () => {
  const cwd = project({ ownCi: false })
  try {
    const p = switchPlan(cwd, loadConfig(cwd).merged, { to: 'gitlab', project: 'acme/shop', map })
    assert.ok(p.remove.length > 5 && p.remove.every((k) => k.startsWith('.github/') || k.startsWith('.claude/') || k.startsWith('.agent-os/')), p.remove.join(', '))
    assert.ok(p.remove.includes('.github/workflows/agent-os-loop.yml') && p.remove.includes('.github/pull_request_template.md'))
    assert.ok(p.add.includes('.gitlab/agent-os-loop.yml') && p.add.includes('.gitlab/merge_request_templates/Default.md'))
    const ci = p.ci.find((c) => c.path === '.gitlab-ci.yml')
    assert.equal(ci.action, 'add')
    assert.match(ci.content, /^include:\n# agent-os:begin include\n {2}- local: \.gitlab\/agent-os-gate\.yml\n[\s\S]*- local: \.gitlab\/agent-os-loop\.yml\n[\s\S]*# agent-os:end include\n$/m)
    assert.ok(p.add.includes('.gitlab-ci.yml#include'), 'install writes the same block')
    assert.deepEqual(p.manual, [])
    assert.deepEqual(p.conflicts, [])
    assert.equal(p.complete, true, 'no file from the old route remains')
    assert.equal(p.steps.filter((s) => /merge request/.test(s)).length, 1, 'one merge request with all of it')
    assert.deepEqual(p.config.map((c) => [c.key, c.to]), [['platform.type', 'gitlab'], ['platform.project', 'acme/shop'], ['platform.board', null]])
    const remaining = p.remove.filter((k) => k.startsWith('.github/'))
    const all = new Set([...remaining, ...p.conflicts, ...p.manual])
    for (const f of ['.github/workflows/agent-os-gate.yml', '.github/ISSUE_TEMPLATE/bug.yml']) assert.ok(all.has(f), `${f} is accounted for`)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test("the team's own files and hand-edited ones are never deleted: they block a complete switch until ported", () => {
  const cwd = project()
  try {
    writeFileSync(join(cwd, '.github/pull_request_template.md'), '# Our own template\n')
    const p = switchPlan(cwd, loadConfig(cwd).merged, { to: 'gitlab', project: 'acme/shop' })
    assert.deepEqual(p.manual, ['.github/workflows/ci.yml'])
    assert.deepEqual(p.conflicts, ['.github/pull_request_template.md'])
    assert.ok(!p.remove.includes('.github/pull_request_template.md'))
    assert.equal(p.complete, false)
    assert.throws(() => switchPlan(cwd, loadConfig(cwd).merged, { to: 'github', project: 'x/y' }), /already on github/)
    assert.throws(() => switchPlan(cwd, loadConfig(cwd).merged, { to: 'gitlab' }), /which project/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('journal references are re-linked from the importer map; the CLI only plans', async () => {
  const cwd = project()
  try {
    const p = switchPlan(cwd, loadConfig(cwd).merged, { to: 'gitlab', project: 'acme/shop', map })
    assert.deepEqual(p.journal.relink, [{ file: '.agent-os/journal/2026/10/2026-10-02T09-00-ana-search-decision.md', changes: [{ from: '#12', to: '#7' }, { from: '#40', to: '!3' }] }])
    assert.deepEqual(p.journal.unmapped, ['#99'])
    const before = readFileSync(join(cwd, '.agent-os/lock.json'), 'utf8')
    let out = ''
    const cli = (argv) => run(argv, { stdout: (s) => { out += s }, stderr: (s) => { out += s }, cwd, env: {} })
    assert.equal(await cli(['platform', 'switch', '--to', 'gitlab', '--project', 'acme/shop']), 2, 'only --plan exists')
    out = ''
    assert.equal(await cli(['platform', 'switch', '--to', 'gitlab', '--project', 'acme/shop', '--map', 'issue-map.json', '--plan']), 1, 'the team CI file still needs porting')
    assert.match(out, /switch github → gitlab \(acme\/shop\): the plan, nothing changed/)
    assert.match(out, /ci: add \.gitlab-ci\.yml/)
    assert.match(out, /port them by hand \(1\):\n {2}\.github\/workflows\/ci\.yml/)
    assert.match(out, /journal: 1 entry, 1 to re-link; not in the map: #99/)
    assert.equal(readFileSync(join(cwd, '.agent-os/lock.json'), 'utf8'), before, 'the lock is untouched')
    assert.ok(existsSync(join(cwd, '.github/workflows/agent-os-loop.yml')) && !existsSync(join(cwd, '.gitlab-ci.yml')), 'nothing moved')
    assert.ok(existsSync(join(cwd, '.agent-os/cache/platform-switch.json')), 'the plan is saved for review')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
