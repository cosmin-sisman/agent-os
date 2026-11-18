// Tests for `agent-os gate` locally and in CI: the same diff selects the same suites; a db-only change runs only the
// db suite; a push runs everything; the results land in the job summary.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from '../cli/main.mjs'

const CONFIG = { gate: { unit: 'unit-cmd', db: 'db-cmd', docs: 'docs-cmd' }, gatePaths: { 'src/**': ['unit'], 'db/**': ['db'], 'docs/**': ['docs'] } }
function setup(files) {
  const dir = mkdtempSync(join(tmpdir(), 'aos-gateci-'))
  writeFileSync(join(dir, 'agent-os.json'), JSON.stringify(CONFIG))
  const git = (args) => {
    const k = args.join(' ')
    if (/^diff --name-only origin\/(development|main)\.\.\.HEAD$/.test(k)) return { status: 0, stdout: files.join('\n'), stderr: '' }
    if (k === 'rev-parse HEAD') return { status: 0, stdout: 'abc', stderr: '' }
    return { status: 0, stdout: '', stderr: '' }
  }
  return { dir, git }
}
async function gate(dir, git, argv, env = {}) {
  const ran = []
  let stdout = ''
  const code = await run(['gate', ...argv], { stdout: (s) => { stdout += s }, stderr: () => {}, cwd: dir, env, git, exec: (c) => { ran.push(c); return { status: 0, output: '', durationMs: 1 } } })
  return { code, ran, stdout }
}

test('given a change in db/ only, only the db suite runs, locally and in CI alike', async () => {
  const { dir, git } = setup(['db/migrations/1.sql'])
  try {
    writeFileSync(join(dir, 'event.json'), JSON.stringify({ pull_request: { body: '', user: { login: 'ana' }, base: { ref: 'development' } } }))
    const local = await gate(dir, git, [])
    const ci = await gate(dir, git, ['--from-ci'], { GITHUB_EVENT_PATH: join(dir, 'event.json'), GITHUB_STEP_SUMMARY: join(dir, 'summary.md') })
    assert.deepEqual(local.ran, ['db-cmd'])
    assert.deepEqual(ci.ran, local.ran, 'the same diff selects the same suites in CI')
    assert.match(readFileSync(join(dir, 'summary.md'), 'utf8'), /## agent-os gate\n\nAgainst development: 1 changed file\(s\)\.\n\n\| Suite \| Command \| Result \| Time \|/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('in CI the base comes from the event (a PR into main compares with main); a push runs every suite', async () => {
  const { dir, git } = setup(['src/a.mjs'])
  try {
    writeFileSync(join(dir, 'pr.json'), JSON.stringify({ pull_request: { body: '', user: { login: 'ana' }, base: { ref: 'main' } } }))
    const pr = await gate(dir, git, ['--from-ci'], { GITHUB_EVENT_PATH: join(dir, 'pr.json') })
    assert.deepEqual(pr.ran, ['unit-cmd'])
    writeFileSync(join(dir, 'push.json'), JSON.stringify({ ref: 'refs/heads/development', sender: { login: 'ana' } }))
    const push = await gate(dir, git, ['--from-ci'], { GITHUB_EVENT_PATH: join(dir, 'push.json') })
    assert.deepEqual(push.ran, ['unit-cmd', 'db-cmd', 'docs-cmd'])
    const gl = await gate(dir, git, ['--from-ci'], { GITLAB_CI: 'true', CI_MERGE_REQUEST_IID: '3', CI_MERGE_REQUEST_TARGET_BRANCH_NAME: 'development' })
    assert.deepEqual(gl.ran, ['unit-cmd'])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
