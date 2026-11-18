// Tests for `agent-os check` from the command line: exit codes, --body-file, --pr (fake gh), commits.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { run } from '../cli/main.mjs'
import { fakeGh } from '../tracker/__fixtures__/fake-gh.mjs'

async function cli(cwd, argv, gh) {
  let stdout = ''
  let stderr = ''
  const code = await run(argv, { stdout: (s) => { stdout += s }, stderr: (s) => { stderr += s }, cwd, env: {}, gh })
  return { code, stdout, stderr }
}
const tmp = () => mkdtempSync(join(tmpdir(), 'aos-check-'))

test('check title: 0 when it follows the rules, 1 with the problems and a suggestion, 2 without a title', async () => {
  const dir = tmp()
  try {
    writeFileSync(join(dir, 'body.md'), '## Why\n\nCloses #3')
    assert.equal((await cli(dir, ['check', 'title', 'feat(x): add y [#3]', '--body-file', 'body.md'])).code, 0)
    const bad = await cli(dir, ['check', 'title', 'feat(x): add y [#4]', '--body-file', 'body.md'])
    assert.equal(bad.code, 1)
    assert.match(bad.stdout, /title: 2 problem\(s\)[\s\S]*suggested: feat\(x\): add y \[#3\]/)
    assert.equal((await cli(dir, ['check', 'title'])).code, 2)
    assert.equal((await cli(dir, ['check', 'title', 'x', '--body-file', 'missing.md'])).code, 2)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('check title --pr reads the title and description from the platform', async () => {
  const dir = tmp()
  try {
    writeFileSync(join(dir, 'agent-os.json'), JSON.stringify({ platform: { type: 'github', project: 'acme/app' } }))
    const gh = fakeGh({ 'GET repos/acme/app/pulls/9': { title: 'fix(a): b [#5]', body: 'Refs #5' } })
    const r = await cli(dir, ['check', 'title', '--pr', '9', '--json'], gh)
    assert.equal(r.code, 0)
    assert.equal(JSON.parse(r.stdout).result.ok, true)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('check commit reads a message file or a commit', async () => {
  const dir = tmp()
  try {
    writeFileSync(join(dir, 'msg.txt'), 'Fixed stuff')
    assert.equal((await cli(dir, ['check', 'commit', '--message-file', 'msg.txt'])).code, 1)
    execFileSync('git', ['init', '-q'], { cwd: dir })
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@e.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'chore: start'], { cwd: dir })
    assert.match((await cli(dir, ['check', 'commit'])).stdout, /commit: ok/)
    assert.equal((await cli(dir, ['check', 'commit', '--ref', 'nope'])).code, 2)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('check loop --from-ci reads the GitHub event file and the GitLab variables; nothing is interpolated', async () => {
  const dir = tmp()
  const loop = async (env) => {
    let stdout = ''
    const code = await run(['check', 'loop', '--from-ci'], { stdout: (s) => { stdout += s }, stderr: () => {}, cwd: dir, env, git: () => ({ status: 0, stdout: '', stderr: '' }) })
    return { code, stdout }
  }
  try {
    writeFileSync(join(dir, '.gitignore'), '.agent-os/local.json\n.agent-os/cache/\n')
    const event = (body, login = 'ana') => { writeFileSync(join(dir, 'event.json'), JSON.stringify({ pull_request: { body, user: { login }, base: { ref: 'development' } } })); return { GITHUB_EVENT_PATH: join(dir, 'event.json') } }
    const ok = await loop(event('## Lessons\n\nNone: typo fix "$(rm -rf /)"\n'))
    assert.equal(ok.code, 0, ok.stdout)
    assert.match(ok.stdout, /^agent-os\/loop: ok/)
    const empty = await loop(event('## Lessons\n\n<!-- Required. -->\n'))
    assert.equal(empty.code, 1)
    assert.match(empty.stdout, /"## Lessons" is empty/)
    assert.match((await loop(event('', 'dependabot[bot]'))).stdout, /dependency bot/)
    const gl = await loop({ GITLAB_CI: 'true', CI_MERGE_REQUEST_IID: '4', CI_MERGE_REQUEST_DESCRIPTION: '## Lessons\n\nNone: rename\n', CI_MERGE_REQUEST_TARGET_BRANCH_NAME: 'development', GITLAB_USER_LOGIN: 'ana' })
    assert.equal(gl.code, 0, gl.stdout)
    assert.equal((await loop({ GITLAB_CI: 'true' })).code, 2, 'not a merge request pipeline')
    assert.equal((await loop({})).code, 2)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
