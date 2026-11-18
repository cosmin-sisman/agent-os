// Tests for /upstream: nothing private leaves the project (paths, code, links, people, secrets, project names), the
// duplicate search sends only filtered words, an existing issue gets a reaction instead, approval before filing,
// upstream disabled writes a local draft, and a filed issue is recorded in the journal and the lesson card.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { draftUpstream, privateTerms, sanitize } from './upstream.mjs'
import { run } from '../cli/main.mjs'

function project(config = {}) {
  const root = mkdtempSync(join(tmpdir(), 'aos-up-'))
  const cwd = join(root, 'shopfront')
  mkdirSync(join(cwd, '.agent-os/lessons/inbox'), { recursive: true })
  writeFileSync(join(cwd, 'agent-os.json'), JSON.stringify({ platform: { type: 'github', project: 'acme-corp/shopfront' }, ...config }))
  writeFileSync(join(cwd, '.agent-os/lessons/inbox/2026-11-18T10-00-ana-gate.md'), '---\nareas: [ci]\nkeywords: [gate]\nsource: "#12"\n---\n\nThe gate skips suites for files under services/payments/stripe.ts when gatePaths has a trailing slash. Seen in /home/ana/work/shopfront. Example: `npm run test:payments`.\n')
  return { root, cwd }
}
const fakeUpstream = (existing = []) => { const calls = []; return { calls, search: (q) => { calls.push(['search', q]); return existing }, create: (spec) => { calls.push(['create', spec]); return { number: 300, url: `https://github.com/cosmin-sisman/agent-os/issues/300` } }, whoami: () => 'ana' } }
async function cli(cwd, argv, upstreamTracker) {
  let stdout = ''
  let stderr = ''
  const code = await run(['upstream', 'draft', ...argv], { stdout: (s) => { stdout += s }, stderr: (s) => { stderr += s }, cwd, env: {}, running: '0.2.0', upstreamTracker })
  return { code, stdout, stderr }
}

test('given a lesson mentioning a private path, the draft does not contain it, nor any other private detail', async () => {
  const p = project()
  try {
    const up = fakeUpstream()
    const r = await cli(p.cwd, ['--lesson', 'gate', '--where', 'agent-os gate', '--key', 'gatePaths'], up)
    assert.equal(r.code, 0, r.stderr)
    for (const secret of ['services/payments', 'stripe.ts', '/home/ana', 'shopfront', 'acme-corp', 'npm run test:payments']) assert.ok(!r.stdout.includes(secret), `leaked ${secret}`)
    assert.match(r.stdout, /The gate skips suites for files under \[path removed\] when gatePaths has a trailing slash/)
    assert.match(r.stdout, /configuration keys involved: `gatePaths`/)
    assert.match(r.stdout, /Removed before showing it: .*paths/)
    assert.deepEqual(up.calls.map((c) => c[0]), ['search'], 'nothing filed without --file --approve')
    const query = up.calls[0][1]
    for (const secret of ['shopfront', 'acme', 'payments', 'stripe', 'home']) assert.ok(!query.toLowerCase().includes(secret), `the search sent "${secret}"`)
  } finally { rmSync(p.root, { recursive: true, force: true }) }
})

test('given an existing upstream issue, it proposes a reaction or comment instead, and refuses to file a twin', async () => {
  const p = project()
  try {
    const up = fakeUpstream([{ number: 120, title: 'The gate skips suites for files when gatePaths has a trailing slash', state: 'open', url: 'u120' }])
    const shown = await cli(p.cwd, ['--title', 'The gate skips suites when gatePaths has a trailing slash', '--what', 'x'], up)
    assert.match(shown.stdout, /Similar upstream issues \(react with 👍 or comment there instead of filing a new one\):\n {2}#120/)
    const filed = await cli(p.cwd, ['--title', 'The gate skips suites when gatePaths has a trailing slash', '--what', 'x', '--file', '--approve'], up)
    assert.equal(filed.code, 2)
    assert.match(filed.stderr, /a similar upstream issue exists: #120/)
    assert.ok(!up.calls.some((c) => c[0] === 'create'))
  } finally { rmSync(p.root, { recursive: true, force: true }) }
})

test('the person approves the exact text: --file alone refuses; --file --approve files it and records the URL', async () => {
  const p = project()
  try {
    const up = fakeUpstream()
    const refused = await cli(p.cwd, ['--lesson', 'gate', '--file'], up)
    assert.equal(refused.code, 2)
    assert.match(refused.stderr, /until the exact text is approved/)
    const ok = await cli(p.cwd, ['--lesson', 'gate', '--file', '--approve'], up)
    assert.equal(ok.code, 0, ok.stderr)
    const spec = up.calls.find((c) => c[0] === 'create')[1]
    assert.deepEqual(spec.labels, ['type:feature', 'upstream'])
    assert.ok(!spec.body.includes('shopfront') && !spec.body.includes('services/payments'))
    assert.match(readFileSync(join(p.cwd, '.agent-os/lessons/inbox/2026-11-18T10-00-ana-gate.md'), 'utf8'), /^---\nupstream: "https:\/\/github\.com\/cosmin-sisman\/agent-os\/issues\/300"/)
    assert.ok(existsSync(join(p.cwd, '.agent-os/journal')))
  } finally { rmSync(p.root, { recursive: true, force: true }) }
})

test('with upstream.enabled false the draft is saved locally and nothing is sent', async () => {
  const p = project({ upstream: { enabled: false } })
  try {
    const up = fakeUpstream()
    const r = await cli(p.cwd, ['--lesson', 'gate', '--file', '--approve'], up)
    assert.equal(r.code, 0)
    assert.match(r.stdout, /upstream\.enabled is false: the draft is in \.agent-os\/cache\/upstream\//)
    assert.deepEqual(up.calls, [])
    assert.equal(readdirSync(join(p.cwd, '.agent-os/cache/upstream')).length, 1)
  } finally { rmSync(p.root, { recursive: true, force: true }) }
})

test('sanitize keeps agent-os commands, keys and skills, and removes the rest', () => {
  const terms = privateTerms({ cwd: '/w/shopfront', config: { platform: { project: 'acme-corp/shopfront', host: 'https://git.acme.io' } } })
  assert.deepEqual(terms.sort(), ['acme-corp', 'acme-corp/shopfront', 'git.acme.io', 'shopfront'])
  const s = sanitize('Run `agent-os doctor --ci` and `/pr`; `branches.integration` is fine; `SELECT * FROM users` is not; C:\\Users\\ana\\x.txt; token xoxb-1234567890-abc', { terms })
  assert.equal(s.text, 'Run `agent-os doctor --ci` and `/pr`; `branches.integration` is fine; [code removed] is not; [path removed]; token [secret removed]')
  const d = draftUpstream({ title: 'x', what: 'y', where: 'rm -rf /', configKeys: ['not.a.key'] }, { cwd: '/w/shopfront', config: { platform: {} }, version: '0.2.0' })
  assert.match(d.body, /### Skill or command\n\n_not given_/)
  assert.doesNotMatch(d.body, /not\.a\.key/)
})
