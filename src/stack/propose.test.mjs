// Tests for recommendations from the catalog: /kickoff's blueprints for a level with the scores behind each, the
// comparison of two technologies, and the "read the docs first" rule for layers agents know poorly in a language
// with no rule template.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadCatalog } from './catalog.mjs'
import { compareTech, proposeBlueprints } from './propose.mjs'
import { planInstall } from '../managed/install.mjs'
import { withDefaults } from '../config/config.mjs'
import { SCHEMA } from '../config/schema.mjs'
import { run } from '../cli/main.mjs'

const catalog = loadCatalog()

test('given a level 2 product, /kickoff proposes booking-app or membership-monolith and explains why with catalog scores', async () => {
  const list = proposeBlueprints(catalog, { level: 2 })
  assert.deepEqual(list.map((x) => x.id).sort(), ['booking-app', 'membership-monolith'])
  for (const x of list) {
    assert.match(x.why, /Catalog scores: \d+ layers, average complexity [\d.]+\/5, AI-friendliness [\d.]+\/5, provider cost [\d.]+\/5/)
    assert.equal(typeof x.scores.averageAiFriendly, 'number')
  }
  assert.deepEqual(proposeBlueprints(catalog, { level: 2, family: 'polyglot' }).map((x) => x.id), ['membership-monolith'])
  let out = ''
  assert.equal(await run(['stack', 'propose', '--level', '2'], { stdout: (s) => { out += s }, stderr: () => {}, cwd: tmpdir(), env: {} }), 0)
  assert.match(out, /booking-app[\s\S]*agent-os stack new --from booking-app/)
})

test('every recommendation cites catalog scores: compare names the scores that decide it', () => {
  const r = compareTech(catalog, 'drizzle-supabase-postgres', 'prisma-neon-postgres')
  assert.match(r.table, /\| complexity \(1 simple, 5 complex\) \| 3 \| 2 \|/)
  assert.deepEqual(r.reasons, ['Prisma + Neon Postgres is simpler (complexity 2 vs 3)'])
  assert.ok(compareTech(catalog, 'astro', 'pg-boss').reasons.some((x) => /different layers/.test(x)))
})

test('a layer agents know poorly, in a language with no rule template, gets "read the docs first" scoped to its paths', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-docsfirst-'))
  try {
    writeFileSync(join(cwd, 'stack.yaml'), 'layers:\n  game-servers: { tech: cpp-lua, paths: ["server/**"] }\n  public-frontend: { tech: astro, paths: ["site/**"] }\n')
    const item = planInstall(withDefaults(SCHEMA, { platform: { type: 'github' } }), { cwd }).items.find((i) => i.key === '.claude/rules/stack/read-the-docs.md')
    assert.ok(item, 'the generic rule is installed')
    assert.match(item.content, /^---\npaths:\n {2}- "server\/\*\*"\n---\n\n# Read the docs first/)
    assert.match(item.content, /- \*\*C\+\+ \+ Lua\*\* \(game-servers: `server\/\*\*`\)/)
    assert.doesNotMatch(item.content, /Astro/, 'well-known technologies are not listed')
    const ro = planInstall(withDefaults(SCHEMA, { platform: { type: 'github' }, languages: { docs: 'ro' } }), { cwd }).items.find((i) => i.key === '.claude/rules/stack/read-the-docs.md')
    assert.match(ro.content, /# Citeste documentatia intai/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
