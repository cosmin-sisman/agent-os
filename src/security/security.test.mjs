// Tests for the advisory watch, with an injected fetch only (no real request is sent): packages come from lockfiles;
// only package names, ecosystems and versions leave the project, and --dry-run shows exactly that; a KEV entry for a
// direct dependency comes first in the digest; the one digest issue is updated, not duplicated; the watch is off on a
// self-managed host; the SBOM; SessionStart's warning; the child process gets the CA and proxy.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { inventory, sbom } from './packages.mjs'
import { plannedRequests, queryAdvisories, watchSettings } from './advisories.mjs'
import { digestBody, prioritize, readCache, sessionWarning } from './digest.mjs'
import { run } from '../cli/main.mjs'

function repo(files) {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-security-'))
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(cwd, p)), { recursive: true }); writeFileSync(join(cwd, p), typeof c === 'string' ? c : JSON.stringify(c)) }
  return cwd
}
const FILES = {
  'agent-os.json': { platform: { type: 'github', project: 'acme/secret-project' } },
  'package.json': { name: 'secret-project', dependencies: { express: '^4.19.0' }, devDependencies: { vitest: '^1.0.0' } },
  'package-lock.json': { lockfileVersion: 3, packages: { '': { name: 'secret-project' }, 'node_modules/express': { version: '4.19.1' }, 'node_modules/qs': { version: '6.11.0' }, 'node_modules/vitest': { version: '1.0.0', dev: true } } },
  'services/ml/requirements.txt': 'fastapi==0.110.0\nrequests>=2\n',
  'src/app.js': "const key = 'sk_live_this_is_code_and_must_not_leave'\n",
}
const OSV = { results: [{ vulns: [{ id: 'GHSA-aaaa', aliases: ['CVE-2026-0001'], summary: 'Open redirect', database_specific: { severity: 'MODERATE' }, affected: [{ package: { name: 'express' }, ranges: [{ events: [{ introduced: '0' }, { fixed: '4.19.2' }] }] }] }] }, { vulns: [{ id: 'GHSA-bbbb', aliases: ['CVE-2026-0002'], summary: 'Prototype pollution', database_specific: { severity: 'HIGH' } }] }, { vulns: [] }, { vulns: [{ id: 'PYSEC-1', aliases: [], severity: [{ type: 'CVSS_V3', score: '9.8' }] }] }] }
const KEV = { vulnerabilities: [{ cveID: 'CVE-2026-0001' }] }
function fakeFetch() {
  const sent = []
  const fetch = async (req) => { sent.push(req); return req.method === 'POST' ? OSV : KEV }
  return { fetch, sent }
}

test('packages come from the lockfiles: names, versions, direct and dev', () => {
  const cwd = repo(FILES)
  try {
    assert.deepEqual(inventory(cwd).map((p) => [p.ecosystem, p.name, p.version, p.direct, p.dev]), [
      ['npm', 'express', '4.19.1', true, false], ['npm', 'qs', '6.11.0', false, false], ['npm', 'vitest', '1.0.0', true, true], ['PyPI', 'fastapi', '0.110.0', true, false],
    ])
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('only package names and versions leave the project, and --dry-run shows exactly that, sending nothing', async () => {
  const cwd = repo(FILES)
  try {
    const { fetch, sent } = fakeFetch()
    let out = ''
    assert.equal(await run(['security', 'watch', '--dry-run', '--json'], { stdout: (s) => { out += s }, stderr: () => {}, cwd, env: {}, fetch }), 0)
    assert.deepEqual(sent, [], 'a dry run sends nothing')
    const reqs = JSON.parse(out).result.requests
    assert.deepEqual(reqs.map((r) => `${r.method} ${r.url}`), ['POST https://api.osv.dev/v1/querybatch', 'GET https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json'])
    await run(['security', 'watch'], { stdout: () => {}, stderr: () => {}, cwd, env: {}, fetch })
    const wire = JSON.stringify(sent)
    for (const secret of ['secret-project', 'acme', 'sk_live', 'src/app.js', 'package-lock', cwd]) assert.equal(wire.includes(secret), false, `${secret} never leaves`)
    assert.deepEqual(sent[0].body.queries[0], { package: { name: 'express', ecosystem: 'npm' }, version: '4.19.1' }, 'name, ecosystem and version only')
    assert.deepEqual(Object.keys(sent[0].body.queries[0]).sort(), ['package', 'version'])
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('given a KEV entry for a direct dependency, the digest lists it first; dev-only and accepted items are apart', async () => {
  const cwd = repo(FILES)
  try {
    const packages = inventory(cwd)
    const { vulns } = await queryAdvisories(packages, { fetch: fakeFetch().fetch, settings: watchSettings({}) })
    const items = prioritize(vulns, packages)
    assert.deepEqual(items.map((i) => [i.id, i.kev, i.severity]), [['GHSA-aaaa', true, 'moderate'], ['PYSEC-1', false, 'critical'], ['GHSA-bbbb', false, 'high']], 'KEV first even when its severity is lower')
    assert.equal(items[0].fixed, '4.19.2')
    const body = digestBody(items, { at: '2026-11-18', packages: packages.length })
    assert.match(body.split('\n')[3], /^- \*\*KNOWN EXPLOITED \(KEV\)\*\* \*\*GHSA-aaaa\*\* \(CVE-2026-0001\), moderate: express@4\.19\.1 direct → fixed in 4\.19\.2/)
    const accepted = prioritize(vulns, packages, { accepted: [{ id: 'CVE-2026-0001', reason: 'not reachable', by: 'ana' }] })
    assert.match(digestBody(accepted, { at: 'x', packages: 1 }), /### Accepted risks\n- \*\*KNOWN EXPLOITED \(KEV\)\*\* \*\*GHSA-aaaa/)
    assert.match(digestBody(items, { at: 'x', packages: 1, lang: 'ro' }), /EXPLOATAT ACTIV \(KEV\)/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('the watch keeps one Security digest issue: created once, then edited; KEV exits 1; SessionStart warns from the cache', async () => {
  const cwd = repo(FILES)
  try {
    const issues = []
    const tracker = {
      search: () => issues.map((i) => ({ ...i })),
      create: ({ title, body, labels }) => { const i = { number: issues.length + 1, title, body, labels, state: 'open' }; issues.push(i); return { number: i.number } },
      update: (n, { body }) => { issues.find((i) => i.number === n).body = body; return { number: n } },
    }
    const io = { stdout: () => {}, stderr: () => {}, cwd, env: {}, fetch: fakeFetch().fetch, tracker, now: new Date('2026-11-18T05:17:00Z') }
    assert.equal(await run(['security', 'watch', '--issue'], io), 1, 'a known-exploited advisory is a failing check')
    assert.equal(await run(['security', 'watch', '--issue'], io), 1)
    assert.equal(issues.length, 1, 'the same issue, edited')
    assert.deepEqual(issues[0].labels, ['security'])
    assert.equal(readCache(cwd).items[0].id, 'GHSA-aaaa')
    assert.match(sessionWarning(cwd), /^Security: 2 known-exploited or critical advisories in the dependencies \(GHSA-aaaa in express, PYSEC-1 in fastapi\)/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('off by default on a self-managed host, with a visible reason; a mirror replaces the public endpoints', async () => {
  assert.equal(watchSettings({ platform: { host: 'https://git.corp' } }).enabled, false)
  assert.match(watchSettings({ platform: { host: 'https://git.corp' } }).why, /self-managed/)
  const s = watchSettings({ platform: { host: 'https://git.corp' }, security: { advisories: { enabled: true, osvUrl: 'https://osv.corp/v1/querybatch', kevUrl: 'https://osv.corp/kev.json' } } })
  assert.deepEqual(plannedRequests([{ ecosystem: 'npm', name: 'a', version: '1' }], s).map((r) => r.url), ['https://osv.corp/v1/querybatch', 'https://osv.corp/kev.json'])
  const cwd = repo({ ...FILES, 'agent-os.json': { platform: { type: 'gitlab', host: 'https://git.corp', project: 'team/app' } } })
  try {
    const { fetch, sent } = fakeFetch()
    let out = ''
    assert.equal(await run(['security', 'watch'], { stdout: (x) => { out += x }, stderr: () => {}, cwd, env: {}, fetch }), 0)
    assert.match(out, /advisory watch: off by default on a self-managed host/)
    assert.deepEqual(sent, [])
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('agent-os sbom writes CycloneDX with purls, scopes and direct flags', async () => {
  const cwd = repo(FILES)
  try {
    assert.equal(await run(['sbom', '--out', 'sbom.json'], { stdout: () => {}, stderr: () => {}, cwd, env: {} }), 0)
    const doc = JSON.parse(readFileSync(join(cwd, 'sbom.json'), 'utf8'))
    assert.equal(doc.bomFormat, 'CycloneDX')
    assert.equal(doc.metadata.component.name, 'secret-project')
    const express = doc.components.find((c) => c.name === 'express')
    assert.deepEqual([express.purl, express.scope], ['pkg:npm/express@4.19.1', 'required'])
    assert.equal(doc.components.find((c) => c.name === 'vitest').scope, 'excluded')
    assert.deepEqual(sbom([{ ecosystem: 'npm', name: '@scope/x', version: '1.0.0', direct: false, dev: false, source: 'l' }]).components[0].purl, 'pkg:npm/%40scope/x@1.0.0')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('the requests run in a child process that carries the project CA and proxy', async () => {
  const { childFetch } = await import('./advisories.mjs')
  const src = childFetch.toString()
  assert.match(src, /networkEnv\(config, cwd\)/, 'CA and proxy from #95')
  assert.match(src, /NODE_USE_ENV_PROXY: '1'/)
  assert.match(src, /spawnSync\(process\.execPath/, 'a Node child, not a shell')
  assert.doesNotMatch(src, /shell:\s*true/)
})
