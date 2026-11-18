// Tests for building and verifying artifacts: data embedded safely, the skeleton added to fragments, source hashes
// recorded, staleness after a source change (the stack map after a catalog change, on a copy), and --strict.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '../yaml/yaml.mjs'
import { run } from '../cli/main.mjs'
import { embedJson, pageFrom, withSources } from './build.mjs'

const REPO = fileURLToPath(new URL('../..', import.meta.url))
async function cli(cwd, argv) {
  let stdout = ''
  let stderr = ''
  const code = await run(argv, { stdout: (s) => { stdout += s }, stderr: (s) => { stderr += s }, cwd, env: {} })
  return { code, stdout, stderr }
}

test('embedded data is ASCII and cannot close its script element', () => {
  const s = embedJson({ t: 'Programări </script><script>alert(1)</script>' })
  assert.doesNotMatch(s, /<\/script>/i)
  assert.match(s, /^[\x00-\x7f]*$/)
  assert.deepEqual(JSON.parse(s), { t: 'Programări </script><script>alert(1)</script>' })
})

test('a fragment template gets the document skeleton; a full document is left as it is', () => {
  const page = pageFrom('<title>T</title><style>b{}</style><script type="application/json">__DATA__</script>', { a: 1 })
  assert.match(page, /^<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">[\s\S]*<style>b\{\}<\/style>\n<\/head>\n<body>\n<script type="application\/json">\{"a":1\}<\/script>\n<\/body>/)
  assert.equal(pageFrom('<!doctype html><p>__DATA__</p>', [1]), '<!doctype html><p>[1]</p>')
})

test('the sources block is replaced and the rest of artifact.yaml kept', () => {
  const text = '# c\nid: x\nsources:\n  - path: a\n    sha256: old\nrefs: ["#1"]\n'
  assert.equal(withSources(text, [{ path: 'a', sha256: 'new' }]), '# c\nid: x\nsources:\n  - path: a\n    sha256: "new"\nrefs: ["#1"]\n')
  assert.equal(withSources('id: x\n', [{ path: 'a', sha256: 'h' }]), 'id: x\nsources:\n  - path: a\n    sha256: "h"\n')
})

test('given a catalog change, the stack map shows as stale until rebuilt; verify fails only with --strict', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-build-'))
  try {
    cpSync(join(REPO, 'catalog'), join(cwd, 'catalog'), { recursive: true })
    mkdirSync(join(cwd, 'artifacts'))
    cpSync(join(REPO, 'artifacts/2026-11-18-stack-map'), join(cwd, 'artifacts/2026-11-18-stack-map'), { recursive: true })
    assert.match((await cli(cwd, ['artifact', 'verify'])).stdout, /2026-11-18-stack-map {2}living {2}sources verified/)
    appendFileSync(join(cwd, 'catalog/runtimes.yaml'), '\n- id: fixture-os\n  name: "Fixture OS"\n  kind: "Test"\n  when: { en: "Only in this test", ro: "Doar in acest test" }\n')
    const stale = await cli(cwd, ['artifact', 'verify'])
    assert.equal(stale.code, 0, 'stale is reported, not a failure, without --strict')
    assert.match(stale.stdout, /STALE: catalog\/runtimes\.yaml changed; agent-os artifact build 2026-11-18-stack-map/)
    assert.equal((await cli(cwd, ['artifact', 'verify', '--strict'])).code, 1)
    assert.match((await cli(cwd, ['artifact', 'list'])).stdout, /stale \(1 source\(s\) changed\)/)
    const built = await cli(cwd, ['artifact', 'build', '--living'])
    assert.equal(built.code, 0, built.stderr)
    assert.match(built.stdout, /built 2026-11-18-stack-map: \d+ bytes, 7 source hash\(es\) recorded/)
    const page = readFileSync(join(cwd, 'artifacts/2026-11-18-stack-map/index.html'), 'utf8')
    const data = JSON.parse(page.match(/<script id="catalog-data" type="application\/json">([\s\S]*?)<\/script>/)[1])
    assert.ok(data.runtimes.some((r) => r.id === 'fixture-os'), 'the page holds the new catalog')
    assert.equal(parse(readFileSync(join(cwd, 'artifacts/2026-11-18-stack-map/artifact.yaml'), 'utf8')).title, 'Stack Map', 'metadata kept')
    assert.equal((await cli(cwd, ['artifact', 'verify', '--strict'])).code, 0)
    assert.equal((await cli(cwd, ['artifact', 'check'])).code, 0)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('build refuses a hand-written page, a template without the placeholder, and an unknown artifact', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-build-'))
  try {
    await run(['artifact', 'new', 'analysis', 'notes'], { stdout: () => {}, stderr: () => {}, cwd, env: {}, now: new Date('2026-11-18T10:00:00Z'), gh: () => ({ status: 1, stdout: '', stderr: 'offline' }) })
    assert.match((await cli(cwd, ['artifact', 'build', '2026-11-18-notes'])).stderr, /written by hand/)
    writeFileSync(join(cwd, 'artifacts/2026-11-18-notes/template.html'), '<p>no data</p>')
    assert.match((await cli(cwd, ['artifact', 'build', '2026-11-18-notes'])).stderr, /no __DATA__ placeholder/)
    assert.match((await cli(cwd, ['artifact', 'build', 'nope'])).stderr, /no artifact "nope"/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
