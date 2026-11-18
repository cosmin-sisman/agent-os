// Tests for `agent-os ship` from the command line with a fake gh: the merge request it sends and the exit codes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from '../cli/main.mjs'
import { fakeGh } from '../tracker/__fixtures__/fake-gh.mjs'

const R = 'repos/acme/app'
const pr = (over = {}) => ({ repository: { pullRequest: { number: 160, title: 'feat(x): y [#4]', body: 'Closes #4', url: 'u', state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: 'APPROVED', baseRefName: 'development', headRefName: 'feat/4-y', isCrossRepository: false, author: { login: 'ana' }, commits: { nodes: [{ commit: { oid: 'abc', statusCheckRollup: { state: 'SUCCESS', contexts: { nodes: [{ __typename: 'CheckRun', name: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS' }] } } } }] }, ...over } } })
const issue = { number: 4, id: 1, node_id: 'I_4', title: 't', state: 'open', html_url: 'u', labels: [], assignees: [] }

async function cli(argv, gh) {
  const dir = mkdtempSync(join(tmpdir(), 'aos-ship-'))
  writeFileSync(join(dir, 'agent-os.json'), JSON.stringify({ platform: { type: 'github', project: 'acme/app' } }))
  let stdout = ''
  try {
    const code = await run(argv, { stdout: (s) => { stdout += s }, stderr: () => {}, cwd: dir, env: {}, gh, git: () => ({ status: 1, stdout: '', stderr: '' }) })
    return { code, stdout }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

test('ship merges with the checked head sha, closes the issue and deletes the remote branch', async () => {
  const gh = fakeGh({
    'graphql:repository': pr(),
    [`PUT ${R}/pulls/160/merge`]: { merged: true, sha: 'fff' },
    [`GET ${R}/issues/4`]: issue,
    [`PATCH ${R}/issues/4`]: {},
    [`POST ${R}/issues/4/comments`]: {},
    [`DELETE ${R}/git/refs/heads/feat/4-y`]: {},
  })
  const r = await cli(['ship', '160'], gh)
  assert.equal(r.code, 0, r.stdout)
  assert.deepEqual(gh.calls.find((c) => c.key.startsWith('PUT')).body, { merge_method: 'squash', sha: 'abc', commit_title: 'feat(x): y [#4] (#160)' })
  assert.deepEqual(gh.calls.find((c) => c.key === `PATCH ${R}/issues/4`).body, { state: 'closed' })
  assert.match(r.stdout, /shipped PR #160 \(fff\)\n {2}#4: closed\n {2}deleted origin\/feat\/4-y/)
})

test('ship on a PR with failing checks exits 1 and sends nothing that writes', async () => {
  const gh = fakeGh({ 'graphql:repository': pr({ commits: { nodes: [{ commit: { oid: 'abc', statusCheckRollup: { state: 'FAILURE', contexts: { nodes: [{ __typename: 'CheckRun', name: 'ci', status: 'COMPLETED', conclusion: 'FAILURE' }] } } } }] } }) })
  const r = await cli(['ship', '160'], gh)
  assert.equal(r.code, 1)
  assert.match(r.stdout, /PR #160 is not ready:\n {2}- failing checks: ci/)
  assert.equal(gh.calls.some((c) => !c.key.startsWith('GET') && !c.key.startsWith('graphql:repository')), false)
})
