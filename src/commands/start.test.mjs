// Tests for `agent-os start` from the command line, with a fake gh and a fake git.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from '../cli/main.mjs'
import { fakeGh } from '../tracker/__fixtures__/fake-gh.mjs'

const issue = (extra = {}) => ({ number: 14, id: 1014, node_id: 'I_14', title: 'Workflow: /start claims an issue', state: 'open', html_url: 'u', labels: [{ name: 'type:feature' }], assignees: [], ...extra })
const routes = (extra = {}) => ({ 'GET user': { login: 'me' }, 'GET repos/acme/app/issues/14': issue(), 'GET repos/acme/app/issues/14/sub_issues?per_page=100': [], ...extra })

async function cli(argv, gh) {
  const dir = mkdtempSync(join(tmpdir(), 'aos-start-'))
  writeFileSync(join(dir, 'agent-os.json'), JSON.stringify({ platform: { type: 'github', project: 'acme/app' } }))
  const gitCalls = []
  let stdout = ''
  try {
    const code = await run(argv, { stdout: (s) => { stdout += s }, stderr: () => {}, cwd: dir, env: {}, gh, git: (args) => { gitCalls.push(args); return { status: 0, stdout: '', stderr: '' } } })
    return { code, stdout, gitCalls }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

test('start links the branch with gh issue develop --base development', async () => {
  const gh = fakeGh(routes({ 'POST repos/acme/app/issues/14/assignees': {}, 'issue develop': { status: 0, stdout: 'github.com/acme/app/tree/feat/14-start-claims-issue\n' } }))
  const r = await cli(['start', '#14', '--json'], gh)
  assert.equal(r.code, 0)
  const develop = gh.calls.find((c) => c.key === 'issue develop')
  assert.deepEqual(develop.args, ['issue', 'develop', '14', '--repo', 'acme/app', '--name', 'feat/14-start-claims-issue', '--base', 'development'])
  assert.equal(JSON.parse(r.stdout).result.branch, 'feat/14-start-claims-issue')
  assert.deepEqual(r.gitCalls.at(-1), ['switch', 'feat/14-start-claims-issue'])
})

test('start on an issue assigned to someone else exits 1 and writes nothing', async () => {
  const gh = fakeGh(routes({ 'GET repos/acme/app/issues/14': issue({ assignees: [{ login: 'ana' }] }) }))
  const r = await cli(['start', '14'], gh)
  assert.equal(r.code, 1)
  assert.match(r.stdout, /Ask in its comments/)
  assert.equal(gh.calls.some((c) => c.key.startsWith('POST') || c.key === 'issue develop'), false)
  assert.deepEqual(r.gitCalls, [])
})

test('start --dry-run reads but sends nothing', async () => {
  const gh = fakeGh(routes())
  const r = await cli(['start', '14', '--dry-run'], gh)
  assert.equal(r.code, 0)
  assert.match(r.stdout, /would start #14 on feat\/14-start-claims-issue \(from development\)/)
  assert.equal(gh.calls.some((c) => !c.key.startsWith('GET')), false)
  assert.deepEqual(r.gitCalls, [])
})

test('start without an issue number is a usage error', async () => {
  const r = await cli(['start'], fakeGh({}))
  assert.equal(r.code, 2)
})
