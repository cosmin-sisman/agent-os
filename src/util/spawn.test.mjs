// Tests for child-process limits (#265): output past Node's 1 MB default is read whole, a cut-off or timed-out process
// is a short error, and a platform error never carries a whole response.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAX_ERROR, excerpt, spawnProblem } from './spawn.mjs'
import { systemGit } from '../workflow/start.mjs'
import { ghClient } from '../tracker/gh.mjs'
import { glabClient } from '../platform/glab.mjs'

test('output larger than 1 MB is read whole', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-spawn-'))
  try {
    spawnSync('git', ['init', '-q'], { cwd })
    writeFileSync(join(cwd, 'big.json'), `[${'{"body":"x"},'.repeat(200000)}{}]`)
    const sha = spawnSync('git', ['hash-object', '-w', 'big.json'], { cwd, encoding: 'utf8' }).stdout.trim()
    const r = systemGit(cwd)(['cat-file', '-p', sha])
    assert.equal(r.status, 0, r.stderr)
    assert.ok(r.stdout.length > 2_000_000, `read ${r.stdout.length} characters`)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('a process cut off or timed out is a short, clear error', () => {
  assert.match(spawnProblem({ error: { code: 'ENOBUFS' } }, 'gh'), /gh's output was larger than 256 MB and was cut off/)
  assert.match(spawnProblem({ error: { code: 'ETIMEDOUT' } }, 'glab'), /glab did not answer in time/)
  assert.equal(spawnProblem({ status: 0 }, 'git'), null)
})

test('a platform error never carries a whole response: its text is capped', () => {
  const huge = `[${'{"url":"https://api.github.com/repos/a/b/pulls/1"},'.repeat(20000)}{}]`
  for (const [client, label] of [[ghClient(() => ({ status: 1, stdout: huge, stderr: '' }), { retries: 0 }), 'GitHub'], [glabClient(() => ({ status: 1, stdout: huge, stderr: '' }), { retries: 0 }), 'GitLab']]) {
    assert.throws(() => client.rest('GET', 'x'), (err) => {
      assert.ok(err.message.length <= MAX_ERROR + 40, `${label}: ${err.message.length} characters`)
      assert.match(err.message, new RegExp(`^${label} API: \\[\\{"url"[\\s\\S]*… \\(\\d+ characters\\)$`))
      return true
    })
  }
  assert.equal(excerpt('first\nsecond'), 'first')
})
