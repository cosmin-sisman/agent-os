// Tests for stack.yaml against the catalog: validation with the closest id for unknown ones, the show summary and its
// EU check, every blueprint making a valid stack, and the stack command (show, check, new --from).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from '../yaml/yaml.mjs'
import { run } from '../cli/main.mjs'
import { loadCatalog, stackFromBlueprint, stackSummary, validateStack } from './stack.mjs'

const catalog = loadCatalog()
const example = parse(readFileSync(new URL('../../examples/stack.yaml', import.meta.url), 'utf8'))

test('the example stack is valid against the catalog', () => {
  assert.deepEqual(validateStack(example, catalog), { problems: [], warnings: [] })
})

test('unknown ids are reported with the closest match', () => {
  const v = validateStack({ project: 'x', levle: 2, blueprint: 'b2b-sass', layers: { 'data-layr': { tech: 'drizle-supabase-postgres' }, auth: { tech: 'supabase-auth', provider: 'vercell', status: 'maybe' } } }, catalog)
  assert.ok(v.problems.includes('unknown key "levle" (did you mean "level"?)'), v.problems.join('\n'))
  assert.ok(v.problems.includes('unknown blueprint "b2b-sass" (did you mean "b2b-saas"?)'))
  assert.ok(v.problems.includes('layers.data-layr: unknown layer "data-layr" (did you mean "data-layer"?)'))
  assert.ok(v.problems.includes('layers.data-layr.tech: unknown technology "drizle-supabase-postgres" (did you mean "drizzle-supabase-postgres"?)'))
  assert.ok(v.problems.includes('layers.auth.provider: unknown provider "vercell" (did you mean "vercel"?)'))
  assert.ok(v.problems.some((p) => /layers\.auth\.status: must be chosen/.test(p)))
})

test('given compliance.euOnly and a provider marked verify, show flags it', () => {
  const { summary } = stackSummary(example, catalog)
  assert.equal(summary.eu.euOnly, true)
  assert.deepEqual(summary.eu.flagged, [{ layer: 'email-notifications', provider: 'resend', euRegions: 'verify' }])
  const off = stackSummary({ ...example, compliance: { euOnly: false } }, catalog).summary
  assert.deepEqual(off.eu.flagged, [], 'nothing to flag without euOnly')
})

test('the summary counts the layers in use: distinct languages and providers, averages, steepest learning curve', () => {
  const s = stackSummary({ layers: { 'public-frontend': { tech: 'astro' }, 'data-layer': { tech: 'drizzle-supabase-postgres' }, mobile: { tech: 'expo-react-native', status: 'evaluating' }, 'backend-services': { language: 'go', provider: 'railway' } } }, catalog).summary
  assert.equal(s.layers, 3)
  assert.deepEqual(s.languages, ['go', 'typescript'])
  assert.deepEqual(s.providers, ['railway', 'supabase', 'vercel'])
  assert.equal(s.steepestLearningCurve.language, catalog.languages.get('go').learningCurve >= catalog.languages.get('typescript').learningCurve ? 'go' : 'typescript')
  assert.equal(typeof s.averageComplexity, 'number')
  assert.equal(typeof s.averageProviderCost, 'number')
})

test('every blueprint in the catalog makes a valid stack', () => {
  for (const [id, bp] of catalog.blueprints) assert.deepEqual(validateStack(parse(stackFromBlueprint(bp)), catalog).problems, [], id)
})

async function cli(cwd, argv, extra = {}) {
  let stdout = ''
  let stderr = ''
  const code = await run(argv, { stdout: (s) => { stdout += s }, stderr: (s) => { stderr += s }, cwd, env: {}, ...extra })
  return { code, stdout, stderr }
}

test('stack new --from writes stack.yaml, asks per layer, refuses to overwrite; show and check read it', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-stack-'))
  try {
    assert.match((await cli(cwd, ['stack', 'show'])).stderr, /no stack\.yaml[\s\S]*stack new --from/)
    assert.match((await cli(cwd, ['stack', 'new', '--from', 'b2b-sass'])).stderr, /did you mean "b2b-saas"/)
    const dry = await cli(cwd, ['stack', 'new', '--from', 'b2b-saas', '--dry-run'])
    assert.match(dry.stdout, /blueprint: b2b-saas/)
    assert.equal(existsSync(join(cwd, 'stack.yaml')), false)
    let n = 0
    assert.equal((await cli(cwd, ['stack', 'new', '--from', 'b2b-saas', '--project', 'Invoices'], { ask: async () => (n++ === 0 ? 'n' : 'y') })).code, 0)
    const text = readFileSync(join(cwd, 'stack.yaml'), 'utf8')
    assert.match(text, /^project: "Invoices"$/m)
    assert.match(text, /public-frontend:\n    tech: astro\n    status: optional/)
    assert.match((await cli(cwd, ['stack', 'new', '--from', 'b2b-saas'])).stderr, /already exists/)
    const show = await cli(cwd, ['stack', 'show', '--json'])
    assert.equal(show.code, 0)
    assert.equal(JSON.parse(show.stdout).result.summary.languages.includes('typescript'), true)
    assert.equal((await cli(cwd, ['stack', 'check'])).code, 0)
    writeFileSync(join(cwd, 'stack.yaml'), 'layers:\n  auth: { tech: supabase-auht }\n')
    const bad = await cli(cwd, ['stack', 'check'])
    assert.equal(bad.code, 1)
    assert.match(bad.stdout, /did you mean "supabase-auth"/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
