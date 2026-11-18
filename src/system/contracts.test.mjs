// Tests for contract diffs: a removed field is always breaking, a renamed endpoint is breaking, stricter inputs are
// breaking and additions are not (OpenAPI, AsyncAPI, GraphQL); pr create labels contract:breaking and requests reviews
// from the consumers' owners, including a consumer in another repository read at its pinned ref; the adapters' calls.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { diffContract } from './contracts.mjs'
import { openChangeRequest } from '../workflow/pr.mjs'
import { saveResult } from '../gate/gate.mjs'
import { vocabularyFor } from '../platform/vocabulary.mjs'
import { GitHubTracker } from '../tracker/github.mjs'
import { ghClient } from '../tracker/gh.mjs'
import { fakeGh } from '../tracker/__fixtures__/fake-gh.mjs'

const api = (paths) => JSON.stringify({ openapi: '3.1.0', paths, components: { schemas: { User: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, email: { type: 'string' }, address: { type: 'object', properties: { city: { type: 'string' } } } } } } } })
const usersOp = { get: { parameters: [{ in: 'query', name: 'q' }], responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } } } } }

test('a removed field is always breaking, in a response, a nested object, an event payload or a GraphQL type', () => {
  const after = JSON.parse(api({ '/users': usersOp }))
  delete after.components.schemas.User.properties.address
  assert.deepEqual(diffContract(api({ '/users': usersOp }), JSON.stringify(after), 'openapi.json').breaking, ['removed GET /users response address', 'removed GET /users response address.city'])
  const ev = (props) => `asyncapi: "2.6.0"\nchannels:\n  order.created:\n    subscribe:\n      message:\n        payload:\n          type: object\n          properties: { ${props} }\n`
  assert.deepEqual(diffContract(ev('id: { type: string }, total: { type: number }'), ev('id: { type: string }'), 'asyncapi.yaml').breaking, ['removed channel order.created payload total'])
  assert.deepEqual(diffContract('type User {\n  id: ID!\n  email: String\n}\n', 'type User {\n  id: ID!\n}\n', 'schema.graphql').breaking, ['removed type User.email'])
})

test('stricter inputs are breaking; additions are not', () => {
  const strict = { get: { ...usersOp.get, parameters: [{ in: 'query', name: 'q', required: true }] } }
  assert.deepEqual(diffContract(api({ '/users': usersOp }), api({ '/users': strict }), 'o.json').breaking, ['GET /users param query:q is now required'])
  const more = { get: { ...usersOp.get, parameters: [...usersOp.get.parameters, { in: 'query', name: 'page' }] } }
  const d = diffContract(api({ '/users': usersOp }), api({ '/users': more, '/teams': usersOp }), 'o.json')
  assert.deepEqual(d.breaking, [])
  assert.ok(d.other.includes('added GET /teams') && d.other.includes('added GET /users param query:page'))
  assert.deepEqual(diffContract('input NewUser {\n  name: String\n}\n', 'input NewUser {\n  name: String\n  email: String!\n}\n', 'schema.graphql').breaking, ['added required input NewUser.email'])
})

const SYSTEM = `components:
  api:
    kind: service
    path: apps/api
    provides:
      - http: { spec: apps/api/openapi.json, base: /api }
  web:
    kind: app
    path: apps/web
    consumes: [api]
    owners: [ana, "acme/frontend"]
  mobile:
    kind: app
    repo: acme/mobile
    ref: v2.3.0
    consumes: [api]
  docs:
    kind: app
    path: apps/docs
`
function project() {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-contracts-'))
  mkdirSync(join(cwd, 'apps/api'), { recursive: true })
  writeFileSync(join(cwd, 'system.yaml'), SYSTEM)
  writeFileSync(join(cwd, 'apps/api/openapi.json'), api({ '/members': usersOp }))
  saveResult(cwd, { head: 'abc1234', clean: true, ok: true, suites: [{ name: 'unit', passed: true }] })
  return cwd
}
const git = (args) => {
  const k = args.join(' ')
  if (k === 'rev-parse --abbrev-ref HEAD') return { status: 0, stdout: 'feat/9-rename\n', stderr: '' }
  if (k === 'rev-parse HEAD') return { status: 0, stdout: 'abc1234\n', stderr: '' }
  if (k === 'diff --name-only --diff-filter=A origin/development...HEAD') return { status: 0, stdout: '.agent-os/journal/2026/11/2026-11-18T10-00-dan-x.md', stderr: '' }
  if (k === 'diff --name-only origin/development...HEAD') return { status: 0, stdout: 'apps/api/openapi.json\n.agent-os/journal/2026/11/2026-11-18T10-00-dan-x.md', stderr: '' }
  if (k === 'show origin/development:apps/api/openapi.json') return { status: 0, stdout: api({ '/users': usersOp }), stderr: '' }
  if (args[0] === 'push') return { status: 0, stdout: '', stderr: '' }
  return { status: 1, stdout: '', stderr: `unexpected ${k}` }
}
const BODY = '## What\n\nRename users to members.\n\n## Why\n\nCloses #9\n\n## How it was tested\n\nnpm test\n\n## Lessons\n\nNone: routine.\n'
const CONFIG = { branches: { integration: 'development', production: 'main' }, conventions: { types: ['feat'], maxTitleLength: 72, exempt: [] }, languages: { labels: 'en' } }

test('given a renamed endpoint consumed by web, the PR is labelled contract:breaking and web owners are requested', () => {
  const cwd = project()
  try {
    const calls = []
    const tracker = {
      warnings: [], whoami: () => 'dan', pullRequestFor: () => null, openPullRequests: () => [],
      get: (n) => ({ number: n, labels: ['type:feature'] }),
      createPullRequest: () => ({ number: 31, url: 'u' }),
      labelChangeRequest: (n, l) => calls.push(['labels', n, l]),
      requestReviewers: (n, o) => calls.push(['reviewers', n, o]),
      fileAt: (repo, path, ref) => { calls.push(['fileAt', repo, path, ref]); return 'components:\n  app:\n    kind: app\n    path: .\n    consumes: [api]\n    owners: [mira]\n' },
      comment: () => {},
    }
    const dry = openChangeRequest({ config: CONFIG, git, cwd, tracker, vocab: vocabularyFor('github') }, { title: 'feat(api): rename users to members [#9]', body: BODY, dryRun: true })
    assert.ok(dry.steps.some((s) => /request reviews from ana, acme\/frontend, mira/.test(s)), dry.steps.join('\n'))
    assert.deepEqual(calls.filter((c) => c[0] !== 'fileAt'), [], 'a dry run changes nothing')
    const r = openChangeRequest({ config: CONFIG, git, cwd, tracker, vocab: vocabularyFor('github') }, { title: 'feat(api): rename users to members [#9]', body: BODY })
    assert.equal(r.opened, true, JSON.stringify(r.problems))
    assert.ok(r.contracts.changes[0].breaking.includes('removed GET /users'))
    assert.deepEqual(calls.find((c) => c[0] === 'labels'), ['labels', 31, ['type:feature', 'contract:breaking']])
    assert.deepEqual(calls.find((c) => c[0] === 'reviewers'), ['reviewers', 31, ['ana', 'acme/frontend', 'mira']])
    assert.deepEqual(calls.find((c) => c[0] === 'fileAt'), ['fileAt', 'acme/mobile', 'system.yaml', 'v2.3.0'], 'the other repository is read at its pinned ref')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('the GitHub adapter requests people and teams, and reads another repository at a ref', () => {
  const gh = fakeGh({
    'POST repos/acme/app/pulls/31/requested_reviewers': (body) => body,
    'GET repos/acme/mobile/contents/system.yaml?ref=v2.3.0': { content: Buffer.from('components: {}\n').toString('base64'), encoding: 'base64' },
    'GET repos/acme/other/contents/system.yaml': { status: 1, stderr: 'gh: Not Found (HTTP 404)' },
  })
  const t = new GitHubTracker({ repo: 'acme/app' }, ghClient(gh, { retries: 0 }))
  assert.deepEqual(t.requestReviewers(31, ['@ana', 'acme/frontend']), { number: 31, reviewers: ['ana'], teams: ['frontend'] })
  assert.deepEqual(gh.calls.find((c) => c.key.startsWith('POST')).body, { reviewers: ['ana'], team_reviewers: ['frontend'] })
  assert.equal(t.fileAt('acme/mobile', 'system.yaml', 'v2.3.0'), 'components: {}\n')
  assert.equal(t.fileAt('acme/other', 'system.yaml'), null)
})

test('the GitLab adapter keeps existing reviewers, resolves usernames to ids and reports groups', async () => {
  const { GitLabTracker } = await import('../tracker/gitlab.mjs')
  const calls = []
  const api = { rest: (m, path, body) => { calls.push([m, path, body]); if (path.endsWith('merge_requests/31') && m === 'GET') return { reviewers: [{ id: 5 }] }; if (path.startsWith('users?username=ana')) return [{ id: 7 }]; return {} } }
  const t = new GitLabTracker({ project: 'team/app' }, api)
  assert.deepEqual(t.requestReviewers(31, ['ana', 'team/frontend']), { number: 31, reviewers: ['ana'], groups: ['team/frontend'] })
  assert.deepEqual(calls.at(-1), ['PUT', 'projects/team%2Fapp/merge_requests/31', { reviewer_ids: [5, 7] }])
  assert.match(t.warnings[0], /no group reviewers: mention team\/frontend/)
})
