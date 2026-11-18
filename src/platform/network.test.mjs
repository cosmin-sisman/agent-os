// Tests for self-managed and on-premise support, with fixtures only (a fake CA file, a fake proxy URL, fake probes):
// the CA, proxy and registry reach child tools through this process's environment and nothing else; values never
// show; credentials in the config are refused; hooks and CI jobs work from an internal registry or a tarball; version
// gates; /upstream off by default on a self-managed host.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyNetwork, networkEnv, networkProblems } from './network.mjs'
import { versionAtLeast, probeGitLab, probeGitHub } from './capabilities.mjs'
import { planInstall } from '../managed/install.mjs'
import { withDefaults } from '../config/config.mjs'
import { SCHEMA } from '../config/schema.mjs'
import { parse } from '../yaml/yaml.mjs'
import { hookCommand } from '../version/pin.mjs'
import { run } from '../cli/main.mjs'

const cfg = (extra) => withDefaults(SCHEMA, extra)

test('the CA, proxy and registry become environment variables; values already set win; only names are reported', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-net-'))
  try {
    const config = { platform: { caFile: 'certs/ca.pem' }, machine: { proxy: 'http://proxy.corp:3128', noProxy: ['gitlab.corp', '.internal'] }, npmRegistry: 'https://npm.corp/' }
    const vars = networkEnv(config, cwd)
    assert.equal(vars.NODE_EXTRA_CA_CERTS, join(cwd, 'certs/ca.pem'))
    assert.equal(vars.SSL_CERT_FILE, vars.GIT_SSL_CAINFO)
    assert.equal(vars.HTTPS_PROXY, 'http://proxy.corp:3128')
    assert.equal(vars.NO_PROXY, 'gitlab.corp,.internal')
    assert.equal(vars.npm_config_registry, 'https://npm.corp/')
    const env = { HTTPS_PROXY: 'http://mine:8080' }
    const applied = applyNetwork(config, cwd, env)
    assert.equal(env.HTTPS_PROXY, 'http://mine:8080', 'what the laptop already sets wins')
    assert.ok(!applied.includes('HTTPS_PROXY'))
    assert.ok(applied.includes('NODE_EXTRA_CA_CERTS'))
    assert.ok(applied.every((k) => /^[A-Za-z_]+$/.test(k)), 'names only')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('a missing CA file and credentials in a proxy or registry URL are problems, without showing the value', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-net-'))
  try {
    const p = networkProblems({ platform: { caFile: 'certs/missing.pem' }, machine: { proxy: 'http://ana:s3cret@proxy.corp:3128' }, npmRegistry: 'https://npm.corp/' }, cwd)
    assert.match(p[0].message, /certs\/missing\.pem does not exist/)
    assert.match(p[1].message, /machine\.proxy holds credentials \(value not shown\)/)
    assert.equal(JSON.stringify(p).includes('s3cret'), false)
    writeFileSync(join(cwd, 'ca.pem'), '-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----\n')
    assert.deepEqual(networkProblems({ platform: { caFile: 'ca.pem' } }, cwd), [])
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('given an air-gapped runner, the gate job runs from the internal registry image, on the runner tags', () => {
  const config = cfg({ platform: { type: 'gitlab', host: 'https://gitlab.corp', project: 'team/app' }, version: '0.4.2', npmRegistry: 'https://npm.corp/', ci: { image: 'registry.corp:5000/tools/node-agent-os:22', tags: ['internal', 'docker'] } })
  const gate = planInstall(config).items.find((i) => i.key === '.gitlab/agent-os-gate.yml').content
  const job = parse(gate)['agent-os/gate']
  assert.equal(job.image, 'registry.corp:5000/tools/node-agent-os:22')
  assert.deepEqual(job.tags, ['internal', 'docker'])
  assert.equal(job.variables.npm_config_registry, 'https://npm.corp/')
  assert.equal(job.script.at(-1), 'npx -y --registry https://npm.corp/ @cosmin-sisman/agent-os@0.4.2 gate --from-ci')
  const gh = cfg({ platform: { type: 'github' }, ci: { image: 'ghcr.corp/node:22', tags: ['self-hosted', 'linux'] }, npmRegistry: 'https://npm.corp/' })
  const wf = parse(planInstall(gh).items.find((i) => i.key === '.github/workflows/agent-os-gate.yml').content)
  assert.deepEqual(wf.jobs.gate['runs-on'], ['self-hosted', 'linux'])
  assert.equal(wf.jobs.gate.container, 'ghcr.corp/node:22')
  assert.equal(wf.jobs.gate.env.npm_config_registry, 'https://npm.corp/')
  const plain = parse(planInstall(cfg({ platform: { type: 'gitlab' } })).items.find((i) => i.key === '.gitlab/agent-os-gate.yml').content)['agent-os/gate']
  assert.deepEqual([plain.image, plain.tags], ['node:22', undefined], 'defaults unchanged without ci settings')
})

test('works with no internet access after install: hooks call the vendored tarball or the internal registry, never the public one', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-net-'))
  try {
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ devDependencies: { '@cosmin-sisman/agent-os': 'file:vendor/agent-os-0.4.2.tgz' } }))
    assert.equal(hookCommand({ version: '0.4.2' }, { cwd }), 'npx --no-install agent-os')
    assert.equal(hookCommand({ version: '0.4.2', npmRegistry: 'https://npm.corp/' }), 'npx -y --registry https://npm.corp/ @cosmin-sisman/agent-os@0.4.2')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('version gates: features a self-managed instance is too old for use their fallback', async () => {
  assert.equal(versionAtLeast('17.5.1-ee', '17.0'), true)
  assert.equal(versionAtLeast('16.11.2', '17.0'), false)
  assert.equal(versionAtLeast(null, '17.0'), false)
  const glab = (ver) => ({ get: (path) => { if (path === 'version') { if (!ver) throw new Error('HTTP 404'); return { version: ver } } throw new Error('HTTP 404') } })
  const old = await probeGitLab({ project: 'team/app' }, glab('16.4.0'))
  assert.deepEqual([old.ciComponents.value, old.idTokens.value], [false, true])
  assert.match(old.ciComponents.note, /GitLab 16\.4\.0; needs 17\.0/)
  const unknown = await probeGitLab({ project: 'team/app' }, glab(null))
  assert.equal(unknown.ciComponents.value, null)
  const ghes = await probeGitHub({ host: 'https://ghe.corp', project: 'o/r' }, { rest: (m, path) => { if (path === 'meta') return { installed_version: '3.4.9' }; throw new Error('HTTP 404') } })
  assert.equal(ghes.idTokens.value, false)
})

test('on a self-managed host, /upstream is off by default and only writes the draft', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-net-'))
  try {
    writeFileSync(join(cwd, 'agent-os.json'), JSON.stringify({ platform: { type: 'gitlab', host: 'https://gitlab.corp', project: 'team/app' } }))
    let stdout = ''
    const calls = []
    const upstreamTracker = new Proxy({}, { get: (_, k) => (...a) => { calls.push(k); return [] } })
    const code = await run(['upstream', 'draft', '--title', 'gate: x', '--what', 'y', '--dry-run'], { stdout: (s) => { stdout += s }, stderr: () => {}, cwd, env: {}, upstreamTracker })
    assert.equal(code, 0)
    assert.match(stdout, /upstream is off by default on a self-managed host/)
    assert.deepEqual(calls, [], 'nothing asked of the public repository')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('nothing in the package reaches the network by itself: every request goes through gh, glab, git or npx', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const root = fileURLToPath(new URL('..', import.meta.url))
  const files = []
  const walk = (d) => { for (const n of readdirSync(d)) { const f = join(d, n); if (statSync(f).isDirectory()) walk(f); else if (n.endsWith('.mjs') && !n.endsWith('.test.mjs')) files.push(f) } }
  walk(root)
  const offenders = files.filter((f) => /from 'node:(https?|net|tls|dgram|http2)'|globalThis\.fetch|\bawait fetch\(|new WebSocket\(/.test(readFileSync(f, 'utf8')))
  assert.deepEqual(offenders, [])
})
