// Tests for `agent-os issue new` with a fake gh: refusals, the duplicate search, --extend, full creation with the
// dependencies API, and dry runs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from '../cli/main.mjs'
import { fakeGh } from '../tracker/__fixtures__/fake-gh.mjs'

const BODY = '## Context\n\nThe session ends after five minutes.\n\n## Test scenarios\n\n- Given a login, when 6 minutes pass, then the user is still signed in\n'
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'aos-ticket-'))
  writeFileSync(join(dir, 'agent-os.json'), JSON.stringify({ platform: { type: 'github', project: 'acme/app' } }))
  writeFileSync(join(dir, 'body.md'), BODY)
  return dir
}
const issue = (n) => ({ number: n, id: 1000 + n, node_id: `I_${n}`, title: `t${n}`, state: 'open', html_url: `https://github.com/acme/app/issues/${n}`, labels: [], assignees: [] })
const ARGS = ['issue', 'new', '--title', 'Login: the session expires after five minutes', '--body-file', 'body.md', '--label', 'type:bug', '--label', 'priority:p1', '--label', 'area:auth', '--milestone', 'v0.2']
async function cli(cwd, argv, gh) {
  let stdout = ''
  let stderr = ''
  const code = await run(argv, { stdout: (s) => { stdout += s }, stderr: (s) => { stderr += s }, cwd, env: {}, gh })
  return { code, stdout, stderr }
}

test('a request overlapping an open issue proposes extending it and creates nothing', async () => {
  const dir = repo()
  const gh = fakeGh({ 'GET search/issues*': { items: [{ number: 4, title: 'Session expires after five minutes on login', state: 'open', html_url: 'u4' }] } })
  try {
    const r = await cli(dir, ARGS, gh)
    assert.equal(r.code, 1)
    assert.match(r.stdout, /#4 \(open, \d+% alike\): Session expires/)
    assert.match(r.stdout, /--extend 4/)
    assert.ok(!gh.calls.some((c) => c.key === 'POST repos/acme/app/issues'))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('--extend adds the request as a comment on the existing issue', async () => {
  const dir = repo()
  const gh = fakeGh({ 'POST repos/acme/app/issues/4/comments': { html_url: 'c1' } })
  try {
    const r = await cli(dir, [...ARGS, '--extend', '4'], gh)
    assert.equal(r.code, 0)
    assert.equal(gh.calls[0].body.body, BODY)
    assert.match(r.stdout, /added the request as a comment on #4/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('an issue without a milestone or type is refused before anything is sent', async () => {
  const dir = repo()
  const gh = fakeGh({})
  try {
    const r = await cli(dir, ['issue', 'new', '--title', 'Login: x y', '--body-file', 'body.md', '--label', 'priority:p1', '--label', 'area:auth'], gh)
    assert.equal(r.code, 1)
    assert.match(r.stdout, /a milestone is required/)
    assert.match(r.stdout, /exactly one type label/)
    assert.equal(gh.calls.length, 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a new issue is created with all its labels, then blocked-by goes through the dependencies API', async () => {
  const dir = repo()
  const gh = fakeGh({
    'GET search/issues*': { items: [] },
    'GET repos/acme/app/milestones?state=all&per_page=100': [{ number: 2, title: 'v0.2' }],
    'POST repos/acme/app/issues': issue(50),
    'POST repos/acme/app/issues/10/sub_issues': {},
    'GET repos/acme/app/issues/3': issue(3),
    'POST repos/acme/app/issues/50/dependencies/blocked_by': {},
    'POST repos/acme/app/issues/50/assignees': {},
  })
  try {
    const r = await cli(dir, [...ARGS, '--parent', '10', '--blocked-by', '3', '--assignee', 'ana', '--assignee', 'dan'], gh)
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /created #50/)
    const post = gh.calls.find((c) => c.key === 'POST repos/acme/app/issues')
    assert.deepEqual(post.body.labels, ['type:bug', 'priority:p1', 'area:auth'])
    assert.equal(post.body.milestone, 2)
    assert.deepEqual(gh.calls.find((c) => c.key === 'POST repos/acme/app/issues/50/dependencies/blocked_by').body, { issue_id: 1003 })
    assert.deepEqual(gh.calls.find((c) => c.key.endsWith('/assignees')).body, { assignees: ['ana', 'dan'] })
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('--dry-run plans the issue and its relationships and sends nothing but the duplicate search', async () => {
  const dir = repo()
  const gh = fakeGh({ 'GET search/issues*': { items: [] } })
  try {
    const r = await cli(dir, [...ARGS, '--blocked-by', '3', '--dry-run'], gh)
    assert.equal(r.code, 0)
    assert.match(r.stdout, /would create "Login: the session expires after five minutes" with type:bug, priority:p1, area:auth in v0\.2, then: link blocked-by/)
    assert.ok(gh.calls.every((c) => c.key.startsWith('GET search/issues')))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
