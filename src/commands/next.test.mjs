// Tests for `agent-os next` from the command line, with a fake gh: the queries it sends and the output.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from '../cli/main.mjs'
import { fakeGh } from '../tracker/__fixtures__/fake-gh.mjs'

const R = 'repos/acme/app'
async function cli(argv, gh) {
  const dir = mkdtempSync(join(tmpdir(), 'aos-next-'))
  writeFileSync(join(dir, 'agent-os.json'), JSON.stringify({ platform: { type: 'github', project: 'acme/app' } }))
  let stdout = ''
  try {
    const code = await run(argv, { stdout: (s) => { stdout += s }, stderr: () => {}, cwd: dir, env: {}, gh, git: () => ({ status: 0, stdout: '', stderr: '' }) })
    return { code, stdout }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
const gh = () => fakeGh({
  'GET user': { login: 'me' },
  'graphql:search': (body) => ({ search: { nodes: body.variables.q.includes('author:me') ? [{ number: 41, title: 'my PR', url: 'u41', isDraft: false, reviewDecision: 'CHANGES_REQUESTED', commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] } }] : [] } }),
  [`GET ${R}/issues?state=open&per_page=100&page=1`]: [
    { number: 7, title: 'Mine', state: 'open', html_url: 'u7', labels: [{ name: 'priority:p1' }], milestone: { title: 'v0.2 Core workflow', due_on: null }, assignees: [{ login: 'me' }] },
    { number: 9, title: 'A PR', state: 'open', html_url: 'u9', labels: [], assignees: [], pull_request: {} },
  ],
  [`GET ${R}/milestones?state=all&per_page=100`]: [{ number: 2, title: 'v0.2 Core workflow', state: 'open', due_on: null }],
  [`GET ${R}/issues/7/dependencies/blocking?per_page=100`]: [],
  [`GET ${R}/issues/7/dependencies/blocked_by?per_page=100`]: [],
  [`GET ${R}/issues?state=closed&assignee=me&sort=updated&direction=desc&per_page=20`]: [],
})

test('next --json ranks my PR with requested changes first, then my issue; pull requests are not issues', async () => {
  const g = gh()
  const r = await cli(['next', '--json'], g)
  assert.equal(r.code, 0)
  const out = JSON.parse(r.stdout).result
  assert.deepEqual(out.recommendations.map((p) => p.number), [41, 7])
  assert.equal(g.calls.filter((c) => c.key === 'graphql:search').length, 2)
  assert.equal(g.calls.some((c) => !c.key.startsWith('GET') && c.key !== 'graphql:search'), false, 'next only reads')
})

test('next explains each recommendation in one line and names the action', async () => {
  const r = await cli(['next'], gh())
  assert.match(r.stdout, /1\. #41 my PR\n {3}your PR has requested changes {2}→ {2}address the review on #41/)
  assert.match(r.stdout, /2\. #7 Mine\n {3}assigned to you, in v0\.2 Core workflow, p1 {2}→ {2}agent-os start 7/)
})

test('--limit must be a whole number', async () => {
  assert.equal((await cli(['next', '--limit', '0'], gh())).code, 2)
})
