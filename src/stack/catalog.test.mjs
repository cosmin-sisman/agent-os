// Tests for the catalog: the shipped files are valid (this test is how a broken entry fails CI, naming file and id),
// a broken reference, duplicates and text rules are reported, and project overlays add or adjust entries that the
// stack commands then use.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from '../cli/main.mjs'
import { CATALOG, catalogFiles, loadCatalog, problemText, validateCatalog } from './catalog.mjs'

test('the shipped catalog is valid: unique ids, references resolve, en and ro present, ro ASCII only', () => {
  const problems = validateCatalog(catalogFiles())
  assert.deepEqual(problems.map(problemText), [])
})

function copy() {
  const dir = mkdtempSync(join(tmpdir(), 'aos-catalog-'))
  cpSync(CATALOG, dir, { recursive: true })
  return dir
}

test('a broken reference is reported with the file and the id', () => {
  const dir = copy()
  try {
    writeFileSync(join(dir, 'technologies.yaml'), '- id: astro\n  name: "Astro"\n  layer: public-frontend\n  language: typescript\n  provider: vercell\n', { flag: 'w' })
    writeFileSync(join(dir, 'blueprints.yaml'), '- id: tiny\n  level: 1\n  name: { en: "Tiny", ro: "Mic" }\n  layers:\n    - layer: public-frontend\n      tech: astro\n    - layer: data-layr\n')
    const problems = validateCatalog(catalogFiles({ catalogDir: dir })).map(problemText)
    assert.ok(problems.includes('catalog/technologies.yaml: astro: provider "vercell" is not in providers.yaml'), problems.join('\n'))
    assert.ok(problems.includes('catalog/blueprints.yaml: tiny layers[1]: layer "data-layr" is not in layers.yaml'))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('duplicates, a missing language and non-ASCII ro text are reported', () => {
  const dir = copy()
  try {
    writeFileSync(join(dir, 'runtimes.yaml'), '- id: ubuntu\n  name: "Ubuntu"\n  when: { en: "Servers" }\n- id: ubuntu\n  name: "Ubuntu"\n  when: { en: "Servers", ro: "Servere în cloud" }\n')
    const problems = validateCatalog(catalogFiles({ catalogDir: dir })).map(problemText)
    assert.ok(problems.includes('catalog/runtimes.yaml: ubuntu: is listed twice'))
    assert.ok(problems.includes('catalog/runtimes.yaml: ubuntu: ubuntu.when: missing its ro text'))
    assert.ok(problems.some((p) => /ubuntu\.when\.ro: non-ASCII î; ro text is ASCII only/.test(p)), problems.join('\n'))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

async function cli(cwd, argv) {
  let stdout = ''
  let stderr = ''
  const code = await run(argv, { stdout: (s) => { stdout += s }, stderr: (s) => { stderr += s }, cwd, env: {} })
  return { code, stdout, stderr }
}

test('given an overlay adding a technology, stack show can use it; overlays adjust existing entries too', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-overlay-'))
  try {
    mkdirSync(join(cwd, '.agent-os/catalog'), { recursive: true })
    writeFileSync(join(cwd, '.agent-os/catalog/providers.yaml'), '- id: hetzner-eu\n  name: "Hetzner (EU)"\n  ease: 3\n  cost: 1\n  euRegions: "yes"\n  role: { en: "Our own servers", ro: "Serverele noastre" }\n- id: resend\n  euRegions: "yes"\n')
    writeFileSync(join(cwd, '.agent-os/catalog/technologies.yaml'), '- id: in-house-api\n  name: "In-house API framework"\n  layer: internal-api\n  language: go\n  provider: hetzner-eu\n  complexity: 3\n  aiFriendly: 2\n  note: { en: "Ours", ro: "Al nostru" }\n')
    writeFileSync(join(cwd, 'stack.yaml'), 'compliance:\n  euOnly: true\nlayers:\n  internal-api: { tech: in-house-api }\n  email-notifications: { tech: resend }\n')
    const cat = loadCatalog({ cwd })
    assert.equal(cat.technologies.get('in-house-api')._file, '.agent-os/catalog/technologies.yaml')
    assert.equal(cat.providers.get('resend').name, 'Resend', 'an overlay keeps the fields it does not set')
    assert.equal((await cli(cwd, ['stack', 'check'])).code, 0)
    const show = await cli(cwd, ['stack', 'show'])
    assert.equal(show.code, 0, show.stderr)
    assert.match(show.stdout, /internal-api\s+In-house API framework\s+go\s+hetzner-eu/)
    assert.match(show.stdout, /EU only: every provider has EU regions/, 'the overlay marked resend as EU')
    const check = await cli(cwd, ['stack', 'catalog', 'check'])
    assert.equal(check.code, 0, check.stdout)
    assert.match(check.stdout, /overlays: \.agent-os\/catalog\/technologies\.yaml, \.agent-os\/catalog\/providers\.yaml/)
    writeFileSync(join(cwd, '.agent-os/catalog/technologies.yaml'), '- id: in-house-api\n  name: "X"\n  layer: internal-api\n  provider: nowhere\n')
    const bad = await cli(cwd, ['stack', 'catalog', 'check'])
    assert.equal(bad.code, 1)
    assert.match(bad.stdout, /\.agent-os\/catalog\/technologies\.yaml: in-house-api: provider "nowhere" is not in providers\.yaml/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
