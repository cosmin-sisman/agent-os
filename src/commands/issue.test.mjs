// Tests for `agent-os issue` from the command line: --json, --dry-run, warnings on stderr, argument errors.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from '../cli/main.mjs'
import { fakeGh } from '../tracker/__fixtures__/fake-gh.mjs'

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'aos-issue-'))
  writeFileSync(join(dir, 'agent-os.json'), JSON.stringify({ platform: { type: 'github', project: 'acme/app', board: { owner: 'acme', number: 3 } } }))
  writeFileSync(join(dir, 'body.md'), 'Steps to reproduce')
  return dir
}
async function cli(cwd, argv, gh = fakeGh({})) {
  let stdout = ''
  let stderr = ''
  const code = await run(argv, { stdout: (s) => { stdout += s }, stderr: (s) => { stderr += s }, cwd, env: {}, gh })
  return { code, stdout, stderr, gh }
}

test('create --dry-run --json shows the requests and calls nothing', async () => {
  const dir = repo()
  try {
    const r = await cli(dir, ['issue', 'create', '--title', 'Bug', '--body-file', 'body.md', '--label', 'type:bug', '--label', 'priority:p1', '--parent', '#10', '--blocked-by', '3', '--dry-run', '--json'])
    assert.equal(r.code, 0)
    const out = JSON.parse(r.stdout)
    assert.equal(out.result.dryRun, true)
    assert.deepEqual(out.result.requests[0].body.labels, ['type:bug', 'priority:p1'])
    assert.equal(out.result.requests[0].body.body, 'Steps to reproduce')
    assert.equal(r.gh.calls.length, 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a board skipped for a missing scope is a warning on stderr, and the command succeeds', async () => {
  const dir = repo()
  try {
    const gh = fakeGh({ 'GET repos/acme/app/issues/5': { number: 5, id: 1, node_id: 'I_5', title: 't', state: 'open', html_url: 'u', labels: [], assignees: [] }, 'graphql:repositoryOwner': { status: 1, stderr: 'INSUFFICIENT_SCOPES: read:project' } })
    const r = await cli(dir, ['issue', 'status', '5', 'Todo', '--json'], gh)
    assert.equal(r.code, 0)
    assert.match(r.stderr, /warning: the board was skipped: the token lacks the "project" scope/)
    assert.equal(JSON.parse(r.stdout).result.skipped, true)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('argument mistakes exit 2 with usage', async () => {
  const dir = repo()
  try {
    for (const argv of [['issue'], ['issue', 'get', 'abc'], ['issue', 'block', '3'], ['issue', 'assign', '3'], ['issue', 'branch', '3'], ['issue', 'update', '3', '--state', 'done'], ['issue', 'fly']]) {
      const r = await cli(dir, argv)
      assert.equal(r.code, 2, argv.join(' '))
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('get returns the issue as JSON', async () => {
  const dir = repo()
  try {
    const gh = fakeGh({ 'GET repos/acme/app/issues/8': { number: 8, id: 9, node_id: 'I_8', title: 'Eight', state: 'open', html_url: 'u8', labels: [{ name: 'type:bug' }], milestone: { title: 'v0.2' }, assignees: [{ login: 'ana' }] } })
    const out = JSON.parse((await cli(dir, ['issue', 'get', '8', '--json'], gh)).stdout)
    assert.deepEqual(out.result, { number: 8, title: 'Eight', body: '', state: 'open', url: 'u8', labels: ['type:bug'], milestone: 'v0.2', assignees: ['ana'], isPullRequest: false })
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
