// Tests for `agent-os lang`: show, check (exit codes, --area, --text, --json) and rule.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from '../cli/main.mjs'

async function cli(cwd, ...argv) {
  let stdout = ''
  let stderr = ''
  const code = await run(argv, { stdout: (s) => { stdout += s }, stderr: (s) => { stderr += s }, cwd, env: {} })
  return { code, stdout, stderr }
}
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'aos-lang-'))
  writeFileSync(join(dir, 'agent-os.json'), JSON.stringify({ languages: { issues: 'ro' } }))
  writeFileSync(join(dir, 'body.md'), 'Descriere\nProblema e în modul de plată\n')
  writeFileSync(join(dir, 'clean.md'), 'Descriere\nProblema e in modul de plata\n')
  return dir
}

test('show lists every area and its language', async () => {
  const dir = repo()
  try {
    const { code, stdout } = await cli(dir, 'lang')
    assert.equal(code, 0)
    assert.match(stdout, /^chat\s+en\s+\(personal\)$/m)
    assert.match(stdout, /^issues\s+ro$/m)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a ro issue body with diacritics fails with file:line:col; a clean one passes', async () => {
  const dir = repo()
  try {
    const bad = await cli(dir, 'lang', 'check', 'body.md', 'clean.md', '--area', 'issues')
    assert.equal(bad.code, 1)
    assert.match(bad.stdout, /body\.md:2:12: "î" is a diacritic; write "i"/)
    assert.match(bad.stdout, /body\.md:2:28: "ă" is a diacritic; write "a"/)
    assert.doesNotMatch(bad.stdout, /clean\.md/)
    assert.equal((await cli(dir, 'lang', 'check', 'clean.md', '--area', 'issues')).code, 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('an area written in English has nothing to check', async () => {
  const dir = repo()
  try {
    const r = await cli(dir, 'lang', 'check', 'body.md', '--area', 'prs')
    assert.equal(r.code, 0)
    assert.match(r.stdout, /prs is written in en: nothing to check/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('--text checks a string, and --json returns the findings', async () => {
  const dir = repo()
  try {
    const r = await cli(dir, 'lang', 'check', '--text', 'Titlu: plată', '--json')
    assert.equal(r.code, 1)
    const out = JSON.parse(r.stdout)
    assert.deepEqual(out.result.findings, [{ file: '<text>', line: 1, col: 12, char: 'ă', ascii: 'a' }])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('check without input and unknown areas exit 2', async () => {
  const dir = repo()
  try {
    assert.equal((await cli(dir, 'lang', 'check')).code, 2)
    assert.match((await cli(dir, 'lang', 'check', 'body.md', '--area', 'tickets')).stderr, /unknown language area/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('rule prints the language rule for this configuration', async () => {
  const dir = repo()
  try {
    const { code, stdout } = await cli(dir, 'lang', 'rule')
    assert.equal(code, 0)
    assert.match(stdout, /^# Language/)
    assert.match(stdout, /\| issues \| .* \| Romanian without diacritics/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
