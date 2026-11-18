// Tests for `agent-os journal` from the command line: add (author from the platform login, dry run, errors), list,
// show and check.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from '../cli/main.mjs'
import { fakeGh } from '../tracker/__fixtures__/fake-gh.mjs'

async function cli(dir, argv, gh = fakeGh({ 'GET user': { login: 'ana' } })) {
  let stdout = ''
  let stderr = ''
  const code = await run(argv, { stdout: (s) => { stdout += s }, stderr: (s) => { stderr += s }, cwd: dir, env: {}, gh })
  return { code, stdout, stderr }
}
const repo = (config = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'aos-jcli-'))
  writeFileSync(join(dir, 'agent-os.json'), JSON.stringify(config))
  return dir
}

test('add takes the author from the platform login; list and show read it back', async () => {
  const dir = repo()
  try {
    writeFileSync(join(dir, 'b.md'), 'Why: one file per entry.\n')
    const add = await cli(dir, ['journal', 'add', '--type', 'decision', '--title', 'One file per entry', '--area', 'knowledge', '--ref', '#22', '--body-file', 'b.md', '--at', '2026-11-18T14:02:00Z'])
    assert.equal(add.code, 0, add.stderr)
    assert.match(add.stdout, /wrote \.agent-os\/journal\/2026\/11\/2026-11-18T14-02-ana-one-file-per-entry\.md/)
    const list = JSON.parse((await cli(dir, ['journal', 'list', '--json'])).stdout).result.entries
    assert.deepEqual(list.map((e) => [e.type, e.title, e.author, e.refs]), [['decision', 'One file per entry', 'ana', ['#22']]])
    const show = await cli(dir, ['journal', 'show', 'ana-one-file-per-entry'])
    assert.match(show.stdout, /# One file per entry\n\nWhy: one file per entry\./)
    assert.equal((await cli(dir, ['journal', 'check'])).code, 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('add --dry-run writes nothing; a missing type, area or author is a usage error', async () => {
  const dir = repo()
  try {
    const r = await cli(dir, ['journal', 'add', '--type', 'note', '--title', 'x', '--area', 'ci', '--dry-run'])
    assert.equal(r.code, 0)
    assert.equal(existsSync(join(dir, '.agent-os')), false)
    assert.equal((await cli(dir, ['journal', 'add', '--type', 'memo', '--title', 'x', '--area', 'ci'])).code, 2)
    assert.equal((await cli(dir, ['journal', 'add', '--type', 'note', '--title', 'x'])).code, 2)
    const noLogin = await cli(dir, ['journal', 'add', '--type', 'note', '--title', 'x', '--area', 'ci'], fakeGh({}))
    assert.equal(noLogin.code, 2)
    assert.match(noLogin.stderr, /--author/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('check exits 1 and names the file and the problem; the journal language comes from the config', async () => {
  const dir = repo({ languages: { journal: 'ro' } })
  try {
    mkdirSync(join(dir, '.agent-os/journal/2026/11'), { recursive: true })
    writeFileSync(join(dir, '.agent-os/journal/2026/11/2026-11-18T14-02-ana-x.md'), '---\ntype: note\nrefs: []\nareas: [ci]\nauthor: ana\n---\n\n# Decizie: fișier\n')
    const r = await cli(dir, ['journal', 'check'])
    assert.equal(r.code, 1)
    assert.match(r.stdout, /2026-11-18T14-02-ana-x\.md: line 8: "ș"/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
