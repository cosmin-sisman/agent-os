// Tests for artifacts: the schema (id equals the folder and starts with a date), scaffolding by type, listing with
// stale sources, and the command (new, list, check, log).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '../yaml/yaml.mjs'
import { run } from '../cli/main.mjs'
import { TYPES, listArtifacts, scaffoldPage, validateArtifact } from './artifact.mjs'

const NOW = new Date('2026-11-18T10:00:00Z')
const tmp = () => mkdtempSync(join(tmpdir(), 'aos-artifact-'))
async function cli(cwd, argv, extra = {}) {
  let stdout = ''
  let stderr = ''
  const code = await run(argv, { stdout: (s) => { stdout += s }, stderr: (s) => { stderr += s }, cwd, env: {}, now: NOW, gh: () => ({ status: 1, stdout: '', stderr: 'offline' }), ...extra })
  return { code, stdout, stderr }
}

test('the id equals the folder name and starts with a date', () => {
  const ok = { id: '2026-11-18-auth-options', title: 'T', type: 'analysis', kind: 'snapshot', status: 'draft', summary: 'S' }
  assert.deepEqual(validateArtifact(ok, '2026-11-18-auth-options'), [])
  assert.ok(validateArtifact(ok, '2026-11-19-auth-options').some((p) => /must equal the folder name/.test(p)))
  assert.ok(validateArtifact({ ...ok, id: 'auth-options' }, 'auth-options').some((p) => /must be <YYYY-MM-DD>-<slug>/.test(p)))
  assert.ok(validateArtifact({ ...ok, id: '2026-02-30-x' }, '2026-02-30-x').some((p) => /invalid date/.test(p)))
})

test('types, kinds, statuses, lists and sources are checked; unknown keys name the closest one', () => {
  const p = validateArtifact({ id: '2026-11-18-x', title: 'T', type: 'analisys', kind: 'frozen', status: 'current', summary: 'S', languages: ['fr'], refs: [7], sourcs: [], sources: [{ path: 'a', sha256: 'nope' }] }, '2026-11-18-x')
  assert.ok(p.some((x) => /type must be one of .*did you mean "analysis"/.test(x)), p.join('\n'))
  assert.ok(p.some((x) => /kind must be one of snapshot, living/.test(x)))
  assert.ok(p.some((x) => /languages must be a list of en, ro/.test(x)))
  assert.ok(p.some((x) => /refs must be a list of strings/.test(x)))
  assert.ok(p.includes('unknown key "sourcs" (did you mean "sources"?)'))
  assert.ok(p.some((x) => /sources\[0\] needs a sha256/.test(x)))
})

test('given new analysis "auth-options", artifacts/<date>-auth-options/ is created with valid metadata and a page', async () => {
  const cwd = tmp()
  try {
    const r = await cli(cwd, ['artifact', 'new', 'analysis', 'auth-options', '--ref', '#82', '--author', 'ana'])
    assert.equal(r.code, 0, r.stderr)
    const dir = join(cwd, 'artifacts/2026-11-18-auth-options')
    const meta = parse(readFileSync(join(dir, 'artifact.yaml'), 'utf8'))
    assert.deepEqual([meta.id, meta.type, meta.kind, meta.status, meta.authors, meta.refs], ['2026-11-18-auth-options', 'analysis', 'snapshot', 'draft', ['ana'], ['#82']])
    assert.deepEqual(validateArtifact(meta, '2026-11-18-auth-options'), [])
    const page = readFileSync(join(dir, 'index.html'), 'utf8')
    const data = JSON.parse(readFileSync(join(dir, 'data.json'), 'utf8'))
    assert.equal(data.title, 'Auth options')
    assert.deepEqual(data.sections.map((x) => x.heading), ['Question', 'Options', 'Findings', 'Recommendation'])
    assert.match(page, /"heading":"Recommendation"/, 'built from the data')
    assert.ok(existsSync(join(dir, 'template.html')))
    assert.match((await cli(cwd, ['artifact', 'new', 'analysis', 'auth-options'])).stderr, /already exists/)
    assert.match((await cli(cwd, ['artifact', 'new', 'analisys', 'x'])).stderr, /did you mean "analysis"/)
    assert.match((await cli(cwd, ['artifact', 'new', 'analysis', 'Bad Slug'])).stderr, /lowercase words/)
    await cli(cwd, ['artifact', 'new', 'dashboard', 'velocity', '--dry-run'])
    assert.equal(existsSync(join(cwd, 'artifacts/2026-11-18-velocity')), false)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('every type scaffolds a self-contained page: no scripts, no external URLs', () => {
  for (const type of TYPES) {
    const page = scaffoldPage({ title: 'X <y>', type })
    assert.doesNotMatch(page, /<script|https?:\/\/|<link /, type)
    assert.match(page, /X &lt;y&gt;/)
  }
})

test('list shows each artifact with its problems and stale sources; check fails on problems', async () => {
  const cwd = tmp()
  try {
    writeFileSync(join(cwd, 'data.csv'), 'a,b\n')
    await cli(cwd, ['artifact', 'new', 'architecture', 'queues'])
    const file = join(cwd, 'artifacts/2026-11-18-queues/artifact.yaml')
    writeFileSync(file, readFileSync(file, 'utf8').replace('sources: []', `sources:\n  - path: data.csv\n    sha256: "${'0'.repeat(64)}"`))
    mkdirSync(join(cwd, 'artifacts/2026-11-17-broken'))
    writeFileSync(join(cwd, 'artifacts/2026-11-17-broken/artifact.yaml'), 'id: 2026-11-17-other\ntitle: "B"\ntype: retro\nkind: snapshot\nstatus: draft\nsummary: "S"\n')
    const all = listArtifacts(cwd)
    assert.deepEqual(all.map((a) => a.folder), ['2026-11-18-queues', '2026-11-17-broken'])
    assert.deepEqual(all[0].stale, ['data.csv'])
    const list = await cli(cwd, ['artifact', 'list'])
    assert.match(list.stdout, /2026-11-18-queues {2}architecture {2}snapshot {2}draft {2}stale \(1 source\(s\) changed\)/)
    const check = await cli(cwd, ['artifact', 'check'])
    assert.equal(check.code, 1)
    assert.match(check.stdout, /2026-11-17-broken:\n {2}- id "2026-11-17-other" must equal the folder name/)
    assert.equal((await cli(cwd, ['artifact', 'list', '--type', 'retro', '--json'])).code, 0)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('log reads the git history of the artifact folder', async () => {
  const cwd = tmp()
  try {
    await cli(cwd, ['artifact', 'new', 'retro', 'sprint-3'])
    const calls = []
    const git = (args) => { calls.push(args); return { status: 0, stdout: 'abc1234\t2026-11-18\tAna\tdocs: retro board [#29]\n' } }
    const r = await cli(cwd, ['artifact', 'log', '2026-11-18-sprint-3', '--json'], { git })
    assert.equal(r.code, 0, r.stderr)
    assert.deepEqual(JSON.parse(r.stdout).result, [{ commit: 'abc1234', date: '2026-11-18', author: 'Ana', subject: 'docs: retro board [#29]' }])
    assert.deepEqual(calls[0].slice(-2), ['--', 'artifacts/2026-11-18-sprint-3'])
    assert.match((await cli(cwd, ['artifact', 'log', 'nope'])).stderr, /no artifact "nope"/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test("this repository's artifacts are valid", () => {
  const all = listArtifacts(fileURLToPath(new URL('../..', import.meta.url)))
  assert.ok(all.length >= 1)
  assert.deepEqual(all.filter((a) => a.problems.length).map((a) => [a.folder, a.problems]), [])
})
