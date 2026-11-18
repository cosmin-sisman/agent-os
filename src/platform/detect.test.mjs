// Tests for platform detection: remote parsing, known hosts, probing unknown hosts with a fake network.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRemote, probeHost, detectPlatform, loginCommand } from './detect.mjs'
import { fakeFetch } from './__fixtures__/fake-fetch.mjs'

test('remotes in every common form parse to host and project', () => {
  assert.deepEqual(parseRemote('https://github.com/cosmin-sisman/agent-os.git'), { scheme: 'https', host: 'github.com', project: 'cosmin-sisman/agent-os' })
  assert.deepEqual(parseRemote('git@gitlab.com:group/sub/app.git'), { scheme: 'ssh', host: 'gitlab.com', project: 'group/sub/app' })
  assert.deepEqual(parseRemote('ssh://git@git.company.internal:2222/team/app.git'), { scheme: 'ssh', host: 'git.company.internal', project: 'team/app' })
  assert.deepEqual(parseRemote('https://oauth2:glpat-SECRETSECRET@Git.Example.com/a/b'), { scheme: 'https', host: 'git.example.com', project: 'a/b' })
  assert.equal(parseRemote('not a remote'), null)
})

test('github.com and gitlab.com are recognized without any request', async () => {
  const fetchFn = fakeFetch({})
  assert.deepEqual((await detectPlatform({ remote: 'git@github.com:o/r.git', fetchFn })).platform, { type: 'github', project: 'o/r' })
  assert.deepEqual((await detectPlatform({ remote: 'https://gitlab.com/g/s/r', fetchFn })).platform, { type: 'gitlab', project: 'g/s/r' })
  assert.equal(fetchFn.calls.length, 0)
})

test('a remote on git.company.internal is probed at /api/v4/version and proposed as GitLab self-managed', async () => {
  const fetchFn = fakeFetch({ 'https://git.company.internal/api/v3/meta': { status: 404, body: { message: '404 Not Found' } }, 'https://git.company.internal/api/v4/version': { status: 200, body: { version: '17.5.1-ee', revision: 'abc' } } })
  const r = await detectPlatform({ remote: 'git@git.company.internal:team/app.git', fetchFn })
  assert.ok(fetchFn.calls.includes('https://git.company.internal/api/v4/version'))
  assert.deepEqual(r.platform, { type: 'gitlab', host: 'https://git.company.internal', project: 'team/app' })
  assert.equal(r.edition, 'self-managed')
  assert.equal(r.version, '17.5.1-ee')
})

test('GitLab without a token (401) is still recognized; the version waits for login', async () => {
  const r = await probeHost('git.x', { fetchFn: fakeFetch({ 'https://git.x/api/v3/meta': { status: 404 }, 'https://git.x/api/v4/version': { status: 401, body: { message: '401 Unauthorized' } } }) })
  assert.equal(r.type, 'gitlab')
  assert.equal(r.version, null)
})

test('GitHub Enterprise Server is recognized from /api/v3/meta', async () => {
  const r = await probeHost('ghe.corp', { fetchFn: fakeFetch({ 'https://ghe.corp/api/v3/meta': { status: 200, body: { installed_version: '3.14.2', verifiable_password_authentication: false } } }) })
  assert.deepEqual([r.type, r.edition, r.version], ['github', 'enterprise-server', '3.14.2'])
})

test('an unknown host is reported with what it answered, never guessed', async () => {
  for (const routes of [{}, { 'https://h/api/v3/meta': { status: 200 }, 'https://h/api/v4/version': { status: 404 } }, { 'https://h/api/v3/meta': { status: 401, body: { message: 'Requires authentication' } }, 'https://h/api/v4/version': { status: 401, body: { error: 'other' } } }]) {
    const r = await detectPlatform({ remote: 'https://h/a/b', fetchFn: fakeFetch(routes) })
    assert.equal(r.ok, false)
    assert.equal(r.platform, undefined)
    assert.match(r.evidence, /neither GitHub nor GitLab as far as it answered \(\/api\/v3\/meta: .*, \/api\/v4\/version: .*\)/)
  }
})

test('no remote, or an unreadable one, is reported; credentials in it are masked', async () => {
  assert.match((await detectPlatform({ remote: null })).evidence, /no "origin" remote/)
  const r = await detectPlatform({ remote: 'https://user:tok3n@:bad', fetchFn: fakeFetch({}) })
  assert.equal(r.ok, false)
  assert.ok(!r.evidence.includes('tok3n'))
})

test('login commands delegate to gh and glab', () => {
  assert.equal(loginCommand({ type: 'github' }), 'gh auth login --hostname github.com')
  assert.equal(loginCommand({ type: 'gitlab', host: 'https://git.company.internal' }), 'glab auth login --hostname git.company.internal')
})
