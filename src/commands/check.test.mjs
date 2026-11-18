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
