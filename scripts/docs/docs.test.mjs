// Tests for the documentation: every command is documented (the generated reference is current), every command in
// the guides exists with the options it is shown with, and a new user can follow the greenfield guide end to end.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DOC, SKILLS_DOC, renderCommands, renderSkills } from './build.mjs'
import { COMMANDS } from '../../src/cli/registry.mjs'
import { GLOBAL_OPTIONS } from '../../src/cli/options.mjs'
import { run } from '../../src/cli/main.mjs'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const GUIDES = join(ROOT, 'docs/guides')

/** The agent-os command lines in a Markdown file's code blocks, split into words (quotes kept together). */
export function guideCommands(text) {
  const out = []
  for (const block of text.matchAll(/```(?:bash|sh)?\n([\s\S]*?)```/g)) {
    for (const line of block[1].split('\n')) {
      const m = line.trim().replace(/\s+#.*$/, '').match(/^(?:npx )?agent-os (.+)$/)
      if (m) out.push([...m[1].matchAll(/"([^"]*)"|(\S+)/g)].map((x) => x[1] ?? x[2]))
    }
  }
  return out
}

test('every command is documented: the generated references are current', async () => {
  assert.equal(readFileSync(join(ROOT, DOC), 'utf8'), await renderCommands(), `${DOC} is out of date: run npm run docs`)
  assert.equal(readFileSync(join(ROOT, SKILLS_DOC), 'utf8'), renderSkills(), `${SKILLS_DOC} is out of date: run npm run docs`)
  const doc = readFileSync(join(ROOT, DOC), 'utf8')
  for (const c of COMMANDS) assert.match(doc, new RegExp(`^## ${c.name}$`, 'm'), c.name)
  const catalog = readFileSync(join(ROOT, SKILLS_DOC), 'utf8')
  for (const s of readdirSync(join(ROOT, 'templates/core/.claude/skills')).filter((d) => !d.startsWith('__'))) assert.match(catalog, new RegExp(`\`/${s}\``), s)
})

test('every command in the guides exists, with the actions and options it is shown with', async () => {
  const files = readdirSync(GUIDES).filter((f) => f.endsWith('.md'))
  assert.deepEqual(files.sort(), ['README.md', 'active.md', 'faq.md', 'greenfield.md', 'maintenance.md', 'spec-first.md'])
  let seen = 0
  for (const f of files) {
    for (const words of guideCommands(readFileSync(join(GUIDES, f), 'utf8'))) {
      seen++
      const [name, ...rest] = words
      const c = COMMANDS.find((x) => x.name === name)
      assert.ok(c?.load, `${f}: agent-os ${name} is not an implemented command`)
      const m = await c.load()
      const known = { ...GLOBAL_OPTIONS, ...(m.options ?? {}) }
      for (const w of rest.filter((x) => x.startsWith('--'))) assert.ok(known[w.slice(2).split('=')[0]], `${f}: agent-os ${name} has no option ${w}`)
      const action = rest.find((x) => !x.startsWith('-'))
      if (action && !/^<.*>$/.test(action) && /^[a-z][a-z-]*$/.test(action) && m.usage && rest.indexOf(action) === 0) assert.match(String(m.usage), new RegExp(`\\b${action}\\b`), `${f}: agent-os ${name} ${action} is not in its usage`)
    }
  }
  assert.ok(seen >= 25, `the guides show ${seen} commands`)
})

test('given a new user, the greenfield guide works end to end', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-greenfield-'))
  const created = []
  const tracker = new Proxy({
    create: (spec) => { created.push(spec); return { number: created.length } },
    milestones: () => [],
    createMilestone: () => ({}),
    warnings: [],
    whoami: () => 'ana',
  }, { get: (t, k) => (k in t ? t[k] : typeof k === 'string' ? () => [] : undefined) })
  const gh = () => ({ status: 1, stdout: '', stderr: 'offline in tests' })
  try {
    const text = readFileSync(join(GUIDES, 'greenfield.md'), 'utf8')
    assert.match(text, /^git init -b development$/m)
    spawnSync('git', ['init', '-q', '-b', 'development'], { cwd })
    const values = { '<owner/name>': 'acme/shop', '<level>': '2', '<name>': 'Shop' }
    const steps = guideCommands(text)
    assert.deepEqual(steps.map((s) => s.slice(0, 2).join(' ')), ['init --profile', 'init --me', 'stack propose', 'stack new', 'stack check', 'ingest plan', 'ingest apply', 'doctor', 'next'])
    for (const words of steps) {
      if (words[0] === 'ingest' && words[1] === 'plan') {
        // What /kickoff writes in step 2, with the person.
        mkdirSync(join(cwd, 'docs'), { recursive: true })
        writeFileSync(join(cwd, 'docs/product.md'), '# Shop\n\n## Catalog\n\n- Visitors can browse products by category.\n- Products show their price and stock.\n\n## Checkout\n\n- Customers can pay by card.\n')
      }
      const argv = words.map((w) => values[w] ?? w)
      let out = ''
      const code = await run(argv, { stdout: (s) => { out += s }, stderr: (s) => { out += s }, cwd, env: {}, gh, tracker, now: new Date('2026-11-18T10:00:00Z') })
      if (words[0] === 'stack' && words[1] === 'propose') values['<blueprint>'] = (await (async () => { let j = ''; await run([...argv, '--json'], { stdout: (s) => { j += s }, stderr: () => {}, cwd, env: {} }); return JSON.parse(j).result[0].id })())
      assert.ok(words[0] === 'doctor' ? code <= 1 : code === 0, `agent-os ${argv.join(' ')} exited ${code}:\n${out}`)
    }
    for (const f of ['agent-os.json', 'AGENTS.md', 'CLAUDE.md', '.claude/settings.json', '.agent-os/local.json', 'stack.yaml']) assert.ok(existsSync(join(cwd, f)), f)
    assert.deepEqual(created.map((c) => c.title), ['Catalog', 'Catalog: Visitors can browse products by category', 'Catalog: Products show their price and stock', 'Checkout', 'Checkout: Customers can pay by card'])
    assert.ok(created.every((c) => c.milestone === 'MVP'))
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
