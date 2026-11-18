// Tests for publishing: the npm package holds only what ships (no fixtures, tests, .agent-os or docs), the publish
// workflow publishes exactly the tagged commit with provenance, and refuses a tag that does not match package.json or
// is not on main.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { publishProblems } from './check-publish.mjs'
import { run } from '../../src/cli/main.mjs'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

test('the npm package holds only what ships: no fixtures, tests, .agent-os or docs', (t) => {
  assert.equal(pkg.private, undefined, 'publishable')
  assert.deepEqual(pkg.publishConfig, { access: 'public', provenance: true })
  const r = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' })
  assert.equal(r.status, 0, r.stderr)
  const [packed] = JSON.parse(r.stdout)
  const files = packed.files.map((f) => f.path.split('\\').join('/'))
  t.diagnostic(`${files.length} files, ${packed.size} bytes packed, ${packed.unpackedSize} bytes unpacked`)
  const leaked = files.filter((f) => /(^|\/)__fixtures__\/|\.test\.mjs$|^\.agent-os\/|^docs\/|^scripts\/|^artifacts\/|^\.github\//.test(f))
  assert.deepEqual(leaked, [], 'nothing from tests, fixtures, the repository state or its docs')
  for (const f of ['bin/agent-os.mjs', 'src/cli/main.mjs', 'templates/core/.claude/skills/ship/SKILL.md', 'catalog/layers.yaml', 'schema/agent-os.schema.json', 'changelog.yaml', 'manifest.json', 'LICENSE', 'README.md', 'package.json']) assert.ok(files.includes(f), f)
  assert.ok(files.some((f) => f.startsWith('migrations/')), 'migrations')
  assert.ok(packed.unpackedSize < 3_000_000, `unpacked size ${packed.unpackedSize}`)
})

test('given a tag, the workflow publishes exactly that commit: the tag matches package.json and is on main', () => {
  const git = (onMain = true) => (args) => (args[0] === 'fetch' ? { status: 0 } : args[0] === 'merge-base' ? { status: onMain ? 0 : 1 } : { status: 1 })
  assert.deepEqual(publishProblems('v0.2.0', { version: '0.2.0', git: git() }), [])
  assert.deepEqual(publishProblems('v0.2.0', { version: '0.1.0', git: git() }), ["the tag v0.2.0 does not match package.json's version 0.1.0: release open bumps it in the release commit"])
  assert.deepEqual(publishProblems('v0.2.0', { version: '0.2.0', git: git(false) }), ['the tagged commit is not on main: only a release merged into main is published'])
  assert.match(publishProblems('v0.2', { version: '0.2.0', git: git() })[0], /not a release tag/)
})

test('the publish workflow: tags only, provenance, pinned actions, least privilege, a clear error without the token', async () => {
  const wf = readFileSync(join(ROOT, '.github/workflows/publish.yml'), 'utf8')
  assert.match(wf, /^on:\n {2}push:\n {4}tags: \['v\*'\]\n/m, 'only release tags trigger it')
  assert.match(wf, /^permissions:\n {2}contents: read\n/m)
  assert.match(wf, /permissions:\n {6}contents: read\n {6}id-token: write\n/, 'id-token for provenance, on the job only')
  for (const u of wf.match(/uses: \S+/g)) assert.match(u, /@[0-9a-f]{40}$/, `${u} is pinned to a commit`)
  const steps = ['node scripts/release/check-publish.mjs', 'NPM_TOKEN secret is not set', 'npm test', 'npm publish --provenance --access public']
  const at = steps.map((s) => wf.indexOf(s))
  assert.ok(at.every((i) => i > 0) && at.every((i, k) => k === 0 || i > at[k - 1]), 'checks, token, tests, then publish')
  assert.match(wf, /NODE_AUTH_TOKEN: \$\{\{ secrets\.NPM_TOKEN \}\}/)
  let out = ''
  assert.equal(await run(['ci', 'review', '.github/workflows/publish.yml', '--strict'], { stdout: (s) => { out += s }, stderr: (s) => { out += s }, cwd: ROOT, env: {} }), 0, out)
})
