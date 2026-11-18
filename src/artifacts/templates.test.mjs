// Tests for the artifact templates: every type with a template, in en and ro, builds a page that passes doctor's
// artifact checks; a release report is built from the journal; data only ever reaches the page as text; ro skeletons
// are ASCII.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run } from '../cli/main.mjs'
import { runDoctor } from '../doctor/doctor.mjs'
import { loadConfig } from '../config/config.mjs'
import { findDiacritics } from '../i18n/i18n.mjs'
import { externalLoads } from './artifact.mjs'

const DIR = fileURLToPath(new URL('../../templates/artifacts/', import.meta.url))
const TYPES = ['discovery', 'analysis', 'comparison', 'release-report', 'retro', 'audit', 'threat-model']
const NOW = new Date('2026-11-18T10:00:00Z')
async function cli(cwd, argv) {
  let stdout = ''
  let stderr = ''
  const code = await run(argv, { stdout: (s) => { stdout += s }, stderr: (s) => { stderr += s }, cwd, env: {}, now: NOW, gh: () => ({ status: 1, stdout: '', stderr: 'offline' }) })
  return { code, stdout, stderr }
}

test('every template passes the doctor artifact checks, in en and in ro', async () => {
  for (const lang of ['en', 'ro']) {
    const cwd = mkdtempSync(join(tmpdir(), 'aos-tpl-'))
    try {
      writeFileSync(join(cwd, 'agent-os.json'), JSON.stringify({ languages: { docs: lang } }))
      for (const type of TYPES) {
        const r = await cli(cwd, ['artifact', 'new', type, `the-${type}`, '--author', 'ana'])
        assert.equal(r.code, 0, `${type}: ${r.stderr}`)
      }
      const findings = runDoctor({ cwd, config: loadConfig(cwd).merged, running: '0.0.0' }, { offline: true, only: ['artifacts'] }).checks[0].findings
      assert.deepEqual(findings.map((f) => f.level), ['ok'], `${lang}: ${findings.map((f) => f.message).join('; ')}`)
      for (const type of TYPES) {
        const page = readFileSync(join(cwd, `artifacts/2026-11-18-the-${type}/index.html`), 'utf8')
        assert.deepEqual(externalLoads(page), [], `${lang}/${type}: self-contained`)
        assert.match(page, new RegExp(`"lang":"${lang}"`))
      }
      assert.equal((await cli(cwd, ['artifact', 'verify', '--strict'])).code, 0, 'built pages are verified')
    } finally { rmSync(cwd, { recursive: true, force: true }) }
  }
})

test('given a release, a release-report artifact can be built from the journal', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-tpl-'))
  try {
    writeFileSync(join(cwd, 'agent-os.json'), '{}')
    for (const [type, title, at] of [['note', 'Stack import from builder sheets', '2026-11-17T09:00:00Z'], ['decision', 'Queue stays on pg-boss', '2026-11-17T10:00:00Z'], ['lesson', 'Quote hashes in YAML', '2026-11-18T08:00:00Z'], ['incident', 'Gate ran a path from a branch', '2026-11-18T08:05:00Z'], ['note', 'Too early', '2026-11-01T08:00:00Z']]) {
      assert.equal((await cli(cwd, ['journal', 'add', '--type', type, '--title', title, '--area', 'x', '--ref', '#9', '--author', 'ana', '--at', at, '--body', 'Why it matters.'])).code, 0)
    }
    const r = await cli(cwd, ['artifact', 'new', 'release-report', 'v0-5-0', '--title', 'Release 0.5.0', '--from-journal', '--since', '2026-11-17', '--until', '2026-11-18'])
    assert.equal(r.code, 0, r.stderr)
    const data = JSON.parse(readFileSync(join(cwd, 'artifacts/2026-11-18-v0-5-0/data.json'), 'utf8'))
    assert.equal(data.subtitle, 'From the journal: 4 entries, 2026-11-17 to 2026-11-18.')
    assert.deepEqual(data.sections.map((x) => [x.heading, x.items]), [
      ['What shipped', ['Stack import from builder sheets (#9), ana']],
      ['Fixes', ['Gate ran a path from a branch (#9), ana']],
      ['Decisions', ['Queue stays on pg-boss (#9), ana']],
      ['Lessons', ['Quote hashes in YAML (#9), ana']],
    ])
    assert.match(readFileSync(join(cwd, 'artifacts/2026-11-18-v0-5-0/index.html'), 'utf8'), /Queue stays on pg-boss/)
    assert.match((await cli(cwd, ['artifact', 'new', 'retro', 'x', '--from-journal'])).stderr, /builds a release-report/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('data only ever reaches the page as text', async () => {
  const page = readFileSync(join(DIR, 'page.html'), 'utf8')
  assert.doesNotMatch(page, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function|setAttribute\(\s*['"](href|src|on)/, 'the renderer never parses data as HTML')
  const cwd = mkdtempSync(join(tmpdir(), 'aos-tpl-'))
  try {
    writeFileSync(join(cwd, 'agent-os.json'), '{}')
    await cli(cwd, ['artifact', 'new', 'analysis', 'evil'])
    const data = join(cwd, 'artifacts/2026-11-18-evil/data.json')
    writeFileSync(data, JSON.stringify({ kind: 'analysis', lang: 'en', title: '</script><script>alert(1)</script>', sections: [{ heading: '<img src=x onerror=alert(2)>', items: ['javascript:alert(3)'] }] }))
    assert.equal((await cli(cwd, ['artifact', 'build', '2026-11-18-evil'])).code, 0)
    const html = readFileSync(join(cwd, 'artifacts/2026-11-18-evil/index.html'), 'utf8')
    assert.equal((html.match(/<script/g) ?? []).length, 2, 'only the data block and the renderer')
    assert.doesNotMatch(html, /<img/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('the ro skeletons are ASCII and every type has both languages', () => {
  for (const type of TYPES) for (const lang of ['en', 'ro']) {
    const text = readFileSync(join(DIR, `${type}.${lang}.json`), 'utf8')
    if (lang === 'ro') assert.deepEqual(findDiacritics(text), [], type)
    assert.equal(JSON.parse(text).kind, type)
  }
  assert.ok(readdirSync(DIR).includes('page.html'))
})
