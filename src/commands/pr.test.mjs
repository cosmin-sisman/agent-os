// Tests for `agent-os pr status|threads|reply` and `gate` from the command line, with a fake gh.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from '../cli/main.mjs'
import { fakeGh } from '../tracker/__fixtures__/fake-gh.mjs'

async function cli(argv, { gh = fakeGh({}), config = {}, files = {}, exec, git } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'aos-prcli-'))
  writeFileSync(join(dir, 'agent-os.json'), JSON.stringify({ platform: { type: 'github', project: 'acme/app' }, ...config }))
  for (const [f, c] of Object.entries(files)) writeFileSync(join(dir, f), c)
  let stdout = ''
  try {
    const code = await run(argv, { stdout: (s) => { stdout += s }, stderr: () => {}, cwd: dir, env: {}, gh, exec, sleep: async () => {}, git: git ?? (() => ({ status: 0, stdout: 'feat/15-pr\n', stderr: '' })) })
    return { code, stdout }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
const status = (rollup) => ({ repository: { pullRequest: { number: 160, url: 'u', state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', reviewDecision: null, commits: { nodes: [{ commit: { oid: 'abc', statusCheckRollup: rollup } }] } } } })

test('pr status --watch waits while checks are pending, then reports a failing check with exit 1', async () => {
  const states = [
    status({ state: 'PENDING', contexts: { nodes: [{ __typename: 'CheckRun', name: 'ci', status: 'IN_PROGRESS', conclusion: null }] } }),
    status({ state: 'FAILURE', contexts: { nodes: [{ __typename: 'CheckRun', name: 'ci', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://x/run' }, { __typename: 'StatusContext', context: 'lint', state: 'SUCCESS' }] } }),
  ]
  const gh = fakeGh({ 'graphql:repository': (_, k) => states[Math.min(k - 1, 1)] })
  const r = await cli(['pr', 'status', '160', '--watch'], { gh })
  assert.equal(r.code, 1)
  assert.match(r.stdout, /PR #160: open, checks failure, review none yet\n {2}failing: ci https:\/\/x\/run/)
  assert.equal(gh.calls.length, 2)
})

test('pr status without a number finds the open PR of the current branch', async () => {
  const gh = fakeGh({ 'GET repos/acme/app/pulls?state=open&head=acme%3Afeat%2F15-pr&per_page=1': [{ number: 160, html_url: 'u' }], 'graphql:repository': status({ state: 'SUCCESS', contexts: { nodes: [{ __typename: 'CheckRun', name: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS' }] } }) })
  const r = await cli(['pr', 'status', '--json'], { gh })
  assert.equal(r.code, 0)
  assert.equal(JSON.parse(r.stdout).result.checks, 'success')
})

test('pr threads lists open review threads; reply --resolve answers and resolves; --dry-run sends nothing', async () => {
  const threads = { repository: { pullRequest: { reviewThreads: { nodes: [
    { id: 'T1', isResolved: false, isOutdated: false, path: 'src/a.mjs', line: 4, comments: { nodes: [{ author: { login: 'dan' }, body: 'De ce nu folosim map?\nmai mult', url: 'c1' }] } },
    { id: 'T2', isResolved: true, isOutdated: false, path: 'b', line: 1, comments: { nodes: [] } },
  ] } } } }
  const gh = fakeGh({ 'graphql:repository': threads, 'graphql:addPullRequestReviewThreadReply': { addPullRequestReviewThreadReply: { comment: { url: 'c2' } } }, 'graphql:resolveReviewThread': { resolveReviewThread: { thread: { isResolved: true } } } })
  const list = await cli(['pr', 'threads', '160'], { gh })
  assert.equal(list.stdout, "T1  src/a.mjs:4\n  @dan: De ce nu folosim map?\n")
  const dry = await cli(['pr', 'reply', 'T1', '--body-file', 'r.md', '--resolve', '--dry-run'], { gh, files: { 'r.md': 'Am schimbat in map.' } })
  assert.match(dry.stdout, /would reply to T1 and resolve it/)
  assert.equal(gh.calls.filter((c) => c.key.startsWith('graphql:add') || c.key.startsWith('graphql:resolve')).length, 0)
  const r = await cli(['pr', 'reply', 'T1', '--body-file', 'r.md', '--resolve'], { gh, files: { 'r.md': 'Am schimbat in map.' } })
  assert.match(r.stdout, /replied and resolved: c2/)
  assert.deepEqual(gh.calls.find((c) => c.key === 'graphql:addPullRequestReviewThreadReply').body.variables, { t: 'T1', b: 'Am schimbat in map.' })
})

test('gate from the command line runs only what the diff needs and exits 1 on a failure', async () => {
  const git = (args) => {
    const k = args.join(' ')
    if (k === 'diff --name-only origin/development...HEAD') return { status: 0, stdout: 'docs/a.md', stderr: '' }
    if (k === 'rev-parse HEAD') return { status: 0, stdout: 'abc', stderr: '' }
    return { status: 0, stdout: '', stderr: '' }
  }
  const ran = []
  const exec = (c) => { ran.push(c); return { status: c === 'docs-check' ? 1 : 0, output: 'broken link', durationMs: 5 } }
  const r = await cli(['gate'], { config: { gate: { unit: 'unit-cmd', docs: 'docs-check' }, gatePaths: { 'src/**': ['unit'], 'docs/**': ['docs'] } }, git, exec })
  assert.equal(r.code, 1)
  assert.deepEqual(ran, ['docs-check'])
  assert.match(r.stdout, /gate: failed \(docs\)/)
})
