// Tests for the artifact site: two artifacts listed with their verification status, by type and by linked item, the
// index built only into its output folder (never committed), and the Pages workflow installed only when asked for.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from '../cli/main.mjs'
import { refLink, webUrlOf } from './site.mjs'
import { planInstall } from '../managed/install.mjs'
import { withDefaults } from '../config/config.mjs'
import { SCHEMA } from '../config/schema.mjs'
import { reviewText } from '../ci/review.mjs'

const sha = (s) => createHash('sha256').update(s).digest('hex')
function repo() {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-site2-'))
  writeFileSync(join(cwd, 'agent-os.json'), JSON.stringify({ platform: { type: 'gitlab', host: 'https://git.corp', project: 'team/app' } }))
  writeFileSync(join(cwd, 'data.csv'), 'a\n')
  const add = (id, type, extra) => {
    mkdirSync(join(cwd, 'artifacts', id), { recursive: true })
    writeFileSync(join(cwd, 'artifacts', id, 'artifact.yaml'), `id: ${id}\ntitle: "${id} title"\ntype: ${type}\nkind: snapshot\nstatus: current\nsummary: "About ${id}"\n${extra}`)
    writeFileSync(join(cwd, 'artifacts', id, 'index.html'), '<p>page</p>')
    writeFileSync(join(cwd, 'artifacts', id, 'template.html'), '<p>__DATA__</p>')
  }
  add('2026-11-17-queues', 'comparison', `refs: ["#12", "!4"]\nareas: [background-workers]\nsources:\n  - path: data.csv\n    sha256: ${sha('a\n')}\n`)
  add('2026-11-18-auth', 'analysis', `refs: ["#12"]\nsources:\n  - path: data.csv\n    sha256: "${'0'.repeat(64)}"\n`)
  return cwd
}
async function cli(cwd, argv) {
  let stdout = ''
  let stderr = ''
  const code = await run(argv, { stdout: (s) => { stdout += s }, stderr: (s) => { stderr += s }, cwd, env: {} })
  return { code, stdout, stderr }
}

test('given two artifacts, the index lists both with their verification status, by type and by linked item', async () => {
  const cwd = repo()
  try {
    const r = await cli(cwd, ['artifact', 'site', '_site'])
    assert.equal(r.code, 0, r.stderr)
    assert.match(r.stdout, /site: 2 artifact\(s\), 1 stale → _site\//)
    const index = readFileSync(join(cwd, '_site/index.html'), 'utf8')
    assert.match(index, /<h2>analysis <small>1<\/small><\/h2>[\s\S]*stale: 1 source\(s\) changed[\s\S]*2026-11-18-auth title/)
    assert.match(index, /<h2>comparison <small>1<\/small><\/h2>[\s\S]*background-workers[\s\S]*sources verified/)
    assert.match(index, /href="https:\/\/git\.corp\/team\/app\/merge_requests\/4">!4/)
    assert.match(index, /By linked item[\s\S]*#12<\/a>: <a href="#2026-11-18-auth">2026-11-18-auth title<\/a>, <a href="#2026-11-17-queues">/, "newest first")
    assert.doesNotMatch(index, /<script|https?:\/\/(?!git\.corp)/, 'self-contained')
    assert.ok(existsSync(join(cwd, '_site/2026-11-17-queues/index.html')))
    assert.equal(existsSync(join(cwd, '_site/2026-11-17-queues/template.html')), false, 'build-only files stay out')
    assert.equal((await cli(cwd, ['artifact', 'site', '_site2', '--strict'])).code, 1, 'strict fails on a stale artifact')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('the index is never committed: it goes to its output folder (by default the ignored cache), never into artifacts/', async () => {
  const cwd = repo()
  try {
    const before = readdirSync(join(cwd, 'artifacts')).map((d) => readdirSync(join(cwd, 'artifacts', d)).join(',')).join('|')
    assert.match((await cli(cwd, ['artifact', 'site'])).stdout, /→ \.agent-os\/cache\/site\//)
    assert.ok(existsSync(join(cwd, '.agent-os/cache/site/index.html')))
    assert.equal(readdirSync(join(cwd, 'artifacts')).map((d) => readdirSync(join(cwd, 'artifacts', d)).join(',')).join('|'), before, 'artifacts/ untouched')
    assert.equal(existsSync(join(cwd, 'index.html')), false)
    assert.match((await cli(cwd, ['artifact', 'site', 'artifacts/site'])).stderr, /cannot be built inside artifacts\//)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('the Pages workflow is installed only with artifacts.pages, on each platform, and passes its own review', () => {
  for (const type of ['github', 'gitlab']) {
    const key = type === 'github' ? '.github/workflows/agent-os-pages.yml' : '.gitlab/agent-os-pages.yml'
    assert.equal(planInstall(withDefaults(SCHEMA, { platform: { type } })).items.some((i) => i.key === key), false, `${type}: not by default`)
    const item = planInstall(withDefaults(SCHEMA, { platform: { type }, version: '0.4.2', artifacts: { pages: true } })).items.find((i) => i.key === key)
    assert.ok(item, `${type}: installed when asked`)
    assert.match(item.content, /artifact build --living[\s\S]*artifact site (_site|public)/)
    assert.deepEqual(reviewText(item.content, key).filter((f) => f.level !== 'info'), [])
  }
  assert.equal(webUrlOf({ platform: { type: 'github', project: 'o/r' } }), 'https://github.com/o/r')
  assert.equal(refLink('#3', 'https://github.com/o/r'), 'https://github.com/o/r/issues/3')
  assert.equal(refLink('2026-01-01-x', 'https://github.com/o/r'), null)
})
