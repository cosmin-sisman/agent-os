// Tests for reporting safely: a confirmed injection bug becomes a draft advisory on GitHub and a confidential issue
// on GitLab, never a public issue; issue new and issue create refuse a vulnerability; hardening is filed with the
// security label; a failed private report never falls back to a public one.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vulnerabilityIn } from './report.mjs'
import { GitLabTracker } from '../tracker/gitlab.mjs'
import { glabClient } from '../platform/glab.mjs'
import { fakeGlab } from '../tracker/__fixtures__/fake-glab.mjs'
import { fakeGh } from '../tracker/__fixtures__/fake-gh.mjs'
import { run } from '../cli/main.mjs'

const R = 'repos/acme/shop'
const INJECTION = { title: 'Search: SQL injection in the q parameter', body: 'GET /search?q=1%27%20OR%201=1 returns every row; the query is built by concatenation.' }

function project() {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-report-'))
  writeFileSync(join(cwd, 'agent-os.json'), JSON.stringify({ platform: { type: 'github', project: 'acme/shop' } }))
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: '@acme/shop', version: '1.2.0' }))
  writeFileSync(join(cwd, 'report.md'), INJECTION.body)
  return cwd
}
const cli = async (cwd, argv, gh) => { let out = ''; const code = await run(argv, { stdout: (s) => { out += s }, stderr: (s) => { out += s }, cwd, env: {}, gh }); return { code, out } }

test('given a confirmed injection bug, a draft advisory is created, not an issue', async () => {
  const cwd = project()
  const gh = fakeGh({
    [`POST ${R}/security-advisories`]: { ghsa_id: 'GHSA-xxxx-yyyy-zzzz', html_url: 'https://github.com/acme/shop/security/advisories/GHSA-xxxx-yyyy-zzzz', state: 'draft' },
  })
  try {
    const r = await cli(cwd, ['security', 'report', '--title', INJECTION.title, '--body-file', 'report.md', '--severity', 'high'], gh)
    assert.equal(r.code, 0, r.out)
    assert.match(r.out, /reported privately as a draft security advisory \(GHSA-xxxx-yyyy-zzzz\)/)
    const post = gh.calls.find((c) => c.key === `POST ${R}/security-advisories`)
    assert.deepEqual([post.body.summary, post.body.severity, post.body.vulnerabilities[0].package], [INJECTION.title, 'high', { ecosystem: 'npm', name: '@acme/shop' }])
    assert.equal(gh.calls.some((c) => c.key.startsWith(`POST ${R}/issues`)), false, 'no issue')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('no code path files a vulnerability publicly: issue new and issue create refuse it; a failed report does not fall back', async () => {
  const cwd = project()
  const gh = fakeGh({ 'GET user': { login: 'ana' }, [`POST ${R}/issues`]: { number: 1, html_url: 'u/1' }, [`POST ${R}/security-advisories`]: { status: 1, stderr: 'HTTP 403: Must have admin rights' } })
  try {
    for (const argv of [['issue', 'new', '--title', INJECTION.title, '--body-file', 'report.md', '--label', 'type:bug', '--label', 'priority:p0', '--label', 'area:api', '--milestone', 'v1'], ['issue', 'create', '--title', INJECTION.title, '--body-file', 'report.md']]) {
      const r = await cli(cwd, argv, gh)
      assert.equal(r.code, 2, argv[1])
      assert.match(r.out, /reads as a vulnerability \(injection\): it is never filed as a public issue[\s\S]*agent-os security report/)
    }
    const failed = await cli(cwd, ['security', 'report', '--title', INJECTION.title, '--body-file', 'report.md'], gh)
    assert.equal(failed.code, 2)
    assert.match(failed.out, /the draft security advisory was not created[\s\S]*nothing was filed publicly/)
    assert.equal(gh.calls.some((c) => c.key.startsWith(`POST ${R}/issues`)), false, 'never a public issue')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('on GitLab a vulnerability becomes a confidential issue; one the platform left public is reported loudly', () => {
  const P = encodeURIComponent('team/app')
  const glab = fakeGlab({ [`POST projects/${P}/issues`]: (body) => ({ iid: 7, web_url: 'https://gitlab.example.com/team/app/-/issues/7', confidential: body.confidential }) })
  const t = new GitLabTracker({ project: 'team/app', host: 'gitlab.example.com' }, glabClient(glab, { host: 'gitlab.example.com', backoffMs: 1 }))
  const r = t.reportVulnerability({ title: INJECTION.title, body: INJECTION.body, severity: 'high' })
  assert.deepEqual([r.channel, r.id], ['confidential issue', 7])
  assert.deepEqual([glab.calls[0].body.confidential, glab.calls[0].body.labels], [true, 'security,severity::high'])
  const ignored = fakeGlab({ [`POST projects/${P}/issues`]: { iid: 8, web_url: 'u/8', confidential: false } })
  const t2 = new GitLabTracker({ project: 'team/app', host: 'gitlab.example.com' }, glabClient(ignored, { host: 'gitlab.example.com', backoffMs: 1 }))
  assert.throws(() => t2.reportVulnerability({ title: 'x' }), /issue #8 was created but is not confidential/)
})

test('hardening that reveals nothing exploitable is a normal issue with the security label', async () => {
  assert.equal(vulnerabilityIn({ title: 'Auth: require MFA for admins' }), null)
  assert.equal(vulnerabilityIn({ title: 'Deps: update lodash', body: 'GHSA-1 is known exploited (KEV)' }), null, 'public advisories about dependencies are not our vulnerability')
  for (const t of ['XSS in the comment preview', 'Login bypass with an empty password', 'Path traversal in /files', 'Leaked API key in a commit']) assert.ok(vulnerabilityIn({ title: t }), t)
  const cwd = project()
  const gh = fakeGh({ [`POST ${R}/issues`]: (body) => ({ number: 5, html_url: 'u/5', labels: body.labels }) })
  try {
    const r = await cli(cwd, ['issue', 'create', '--title', 'Search: prevent SQL injection with parameterized queries', '--hardening', '--label', 'security'], gh)
    assert.equal(r.code, 0, r.out)
    assert.ok(gh.calls.some((c) => c.key === `POST ${R}/issues`))
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
