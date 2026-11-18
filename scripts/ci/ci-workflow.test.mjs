// Tests for this repository's CI workflow: pull requests run macOS on Node 22 only, while Linux and Windows keep every
// Node version; a push runs the full matrix; and the ci aggregator passes whatever subset of the matrix ran.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const wf = readFileSync(fileURLToPath(new URL('../../.github/workflows/ci.yml', import.meta.url)), 'utf8')

/** The matrix jobs GitHub would run for an event, from the workflow's os, node and exclude expression. */
function jobsFor(event) {
  const os = JSON.parse(wf.match(/^ {8}os: (\[.+\])$/m)[1].replace(/([a-z][\w-]+)/g, '"$1"'))
  const node = JSON.parse(wf.match(/^ {8}node: (\[.+\])$/m)[1])
  const expr = wf.match(/^ {8}exclude: \$\{\{ github\.event_name == 'pull_request' && fromJSON\('(.+?)'\) \|\| fromJSON\('\[\]'\) \}\}$/m)
  assert.ok(expr, 'exclude depends on the event only')
  const exclude = event === 'pull_request' ? JSON.parse(expr[1]) : []
  return os.flatMap((o) => node.map((n) => ({ os: o, node: n }))).filter((j) => !exclude.some((e) => e.os === j.os && e.node === j.node))
}

test('given a pull request, macOS runs only Node 22, Linux and Windows keep every version; a push runs the full matrix', () => {
  const pr = jobsFor('pull_request')
  assert.equal(pr.length, 7)
  assert.deepEqual(pr.filter((j) => j.os === 'macos-latest').map((j) => j.node), [22])
  for (const os of ['ubuntu-latest', 'windows-latest']) assert.deepEqual(pr.filter((j) => j.os === os).map((j) => j.node), [22, 24, 26], os)
  assert.equal(jobsFor('push').length, 9)
})

test('ci still passes when every job that ran passed, and the job timeout is unchanged', () => {
  assert.match(wf, /^ {2}ci:\n {4}if: always\(\)\n {4}needs: \[test, actionlint, pr-title\]/m, 'the aggregator needs the test job as a whole, not single matrix jobs')
  assert.match(wf, /\[ "\$r" = "success" \] \|\| \[ "\$r" = "skipped" \] \|\| exit 1/)
  assert.match(wf, /^ {2}test:\n[\s\S]*?timeout-minutes: 10\n/m)
})
