// Tests for the Pages site builder: the artifact.yaml subset parser, staleness detection and the site build.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { parseArtifactYaml, collectArtifacts, buildSite } from './build.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sha = (s) => createHash('sha256').update(s).digest('hex')

/** A throwaway repository with one artifact built from one source file. */
function fixture({ source = 'v1', recorded = 'v1' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'aos-site-'))
  mkdirSync(join(root, 'data'))
  writeFileSync(join(root, 'data', 'src.yaml'), source)
  const dir = join(root, 'artifacts', '2026-01-01-demo')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'index.html'), '<p>demo</p>')
  writeFileSync(join(dir, 'template.html'), '<p>__DATA__</p>')
  writeFileSync(join(dir, 'artifact.yaml'), [
    '# metadata', 'id: 2026-01-01-demo', 'title: "Demo: one"', 'type: analysis', 'kind: snapshot',
    'refs: ["#1", "#2"]', 'sources:', '  - path: data/src.yaml', `    sha256: ${sha(recorded)}`, '',
  ].join('\r\n'))
  return root
}

test('parses scalars, quoted strings, inline lists and sources, ignoring comments and CRLF', () => {
  const meta = parseArtifactYaml('# c\nid: x-1\ntitle: "A: b"\nrefs: ["#1", "#2"]\nlanguages: [en, ro]\nsources:\n  - path: a.yaml\n    sha256: abc  # note\n')
  assert.equal(meta.id, 'x-1')
  assert.equal(meta.title, 'A: b')
  assert.deepEqual(meta.refs, ['#1', '#2'])
  assert.deepEqual(meta.languages, ['en', 'ro'])
  assert.deepEqual(meta.sources, [{ path: 'a.yaml', sha256: 'abc' }])
})

test('an empty inline list parses as an empty array', () => {
  assert.deepEqual(parseArtifactYaml('refs: []\n').refs, [])
})

test('an artifact whose sources match is not stale', () => {
  const root = fixture()
  try {
    const [a] = collectArtifacts(root)
    assert.equal(a.id, '2026-01-01-demo')
    assert.deepEqual(a.stale, [])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a changed or missing source marks the artifact stale', () => {
  const root = fixture({ source: 'v2', recorded: 'v1' })
  try {
    assert.deepEqual(collectArtifacts(root)[0].stale, ['data/src.yaml'])
    rmSync(join(root, 'data', 'src.yaml'))
    assert.deepEqual(collectArtifacts(root)[0].stale, ['data/src.yaml'])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('an id that does not match its folder is an error', () => {
  const root = fixture()
  try {
    const file = join(root, 'artifacts', '2026-01-01-demo', 'artifact.yaml')
    writeFileSync(file, readFileSync(file, 'utf8').replace('id: 2026-01-01-demo', 'id: other'))
    assert.throws(() => collectArtifacts(root), /artifact\.yaml id is "other"/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('the site has the artifact page and the index, and leaves build-only files out', () => {
  const root = fixture()
  const out = join(root, '_site')
  try {
    buildSite(root, out)
    assert.ok(existsSync(join(out, '2026-01-01-demo', 'index.html')))
    assert.ok(!existsSync(join(out, '2026-01-01-demo', 'template.html')))
    const index = readFileSync(join(out, 'index.html'), 'utf8')
    assert.match(index, /Demo: one/)
    assert.match(index, /sources verified/)
    assert.match(index, /issues\/2"/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("this repository's artifacts are up to date with their sources", () => {
  const stale = collectArtifacts(repoRoot).filter((a) => a.stale.length)
  assert.deepEqual(stale.map((a) => `${a.id}: ${a.stale.join(', ')}`), [], 'rebuild the stale artifacts (scripts/bootstrap/build_artifact.py)')
})
