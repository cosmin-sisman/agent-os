// Tests for `agent-os setup` and `agent-os lang set` against an in-memory GitHub repository.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from '../cli/main.mjs'
import { fakeGitHubRepo } from '../platform/__fixtures__/fake-github-repo.mjs'

function repo(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'aos-setup-'))
  writeFileSync(join(dir, 'agent-os.json'), JSON.stringify({ platform: { type: 'github', project: 'acme/app' }, ...extra }))
  return dir
}
async function cli(cwd, argv, gh) {
  let stdout = ''
  let stderr = ''
  const code = await run(argv, { stdout: (s) => { stdout += s }, stderr: (s) => { stderr += s }, cwd, env: {}, gh: gh.run })
  return { code, stdout, stderr }
}

test('setup --dry-run lists every change and changes nothing, remote or local', async () => {
  const dir = repo()
  const gh = fakeGitHubRepo()
  try {
    const r = await cli(dir, ['setup', '--dry-run'], gh)
    assert.equal(r.code, 0)
    assert.match(r.stdout, /would create branch development from main/)
    assert.match(r.stdout, /would make development the default branch \(now main\)/)
    assert.match(r.stdout, /would protect main and development/)
    assert.match(r.stdout, /would create label type:bug/)
    assert.match(r.stdout, /would install \.github\/pull_request_template\.md/)
    assert.deepEqual(gh.writes, [])
    assert.equal(existsSync(join(dir, '.github')), false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('setup applies, then a second run has nothing to change', async () => {
  const dir = repo()
  const gh = fakeGitHubRepo()
  try {
    assert.equal((await cli(dir, ['setup'], gh)).code, 0)
    assert.equal(gh.state.defaultBranch, 'development')
    assert.ok(existsSync(join(dir, '.github/ISSUE_TEMPLATE/bug.yml')))
    const again = await cli(dir, ['setup'], gh)
    assert.equal(again.stdout.trim(), 'nothing to change: the repository is already set up')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('--only limits the areas; unknown areas exit 2', async () => {
  const dir = repo()
  const gh = fakeGitHubRepo()
  try {
    const r = await cli(dir, ['setup', '--only', 'labels', '--dry-run', '--json'], gh)
    const out = JSON.parse(r.stdout).result
    assert.ok(out.steps.every((s) => s.area === 'labels'))
    assert.equal(out.files, null)
    assert.equal((await cli(dir, ['setup', '--only', 'wiki'], gh)).code, 2)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('lang set labels ro saves the language and renames the labels in place', async () => {
  const dir = repo()
  const gh = fakeGitHubRepo({ issues: { 3: { labels: ['type:feature'] } } })
  try {
    await cli(dir, ['setup', '--only', 'labels'], gh)
    const r = await cli(dir, ['lang', 'set', 'labels', 'ro'], gh)
    assert.equal(r.code, 0)
    assert.match(r.stdout, /rename label type:feature → tip:functionalitate/)
    assert.equal(JSON.parse(readFileSync(join(dir, 'agent-os.json'), 'utf8')).languages.labels, 'ro')
    assert.deepEqual(gh.state.issues[3].labels, ['tip:functionalitate'])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('lang set for a text area only saves it; chat goes to the personal file', async () => {
  const dir = repo()
  const gh = fakeGitHubRepo()
  try {
    assert.match((await cli(dir, ['lang', 'set', 'issues', 'ro'], gh)).stdout, /set issues to ro in agent-os\.json/)
    assert.match((await cli(dir, ['lang', 'set', 'chat', 'ro'], gh)).stdout, /set chat to ro in \.agent-os\/local\.json/)
    assert.deepEqual(gh.writes, [])
    assert.equal((await cli(dir, ['lang', 'set', 'issues', 'fr'], gh)).code, 2)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
