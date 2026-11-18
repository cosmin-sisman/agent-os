// Tests for the audit outputs: a second audit lists fixed, new and worse findings separately; nothing is filed
// without confirmation (propose drafts only, and never calls the platform); the artifact records and verifies the
// commit it audited, and its page passes the artifact checks.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compareAudits, lensScores, proposeIssues } from './outputs.mjs'
import { mergeFindings } from './audit.mjs'
import { externalLoads } from '../artifacts/artifact.mjs'
import { run } from '../cli/main.mjs'

const F = (title, severity, evidence = [`${title}.ts:1`]) => ({ title, severity, confidence: 'confirmed', evidence, recommendation: `fix ${title}` })
const answer = (lens, findings) => ({ lens, findings, strengths: ['CI runs on every PR (.github/workflows/ci.yml)'] })

test('given a second audit, fixed, new and worse findings are listed separately', () => {
  const first = mergeFindings([answer('architecture', [F('No index on orders', 'medium'), F('Shared mutable cache', 'low'), F('Backups untested', 'high')])])
  const second = mergeFindings([answer('architecture', [F('no index on orders', 'critical'), F('Backups untested', 'medium'), F('Secrets in .env.example', 'high')])])
  const c = compareAudits(first, second)
  assert.deepEqual(c.fixed.map((f) => f.title), ['Shared mutable cache'])
  assert.deepEqual(c.new.map((f) => f.title), ['Secrets in .env.example'])
  assert.deepEqual(c.worse.map((f) => [f.title, f.was, f.severity]), [['no index on orders', 'medium', 'critical']])
  assert.deepEqual(c.better.map((f) => [f.title, f.was, f.severity]), [['Backups untested', 'high', 'medium']])
  assert.deepEqual(lensScores(second, ['architecture', 'delivery']).map((s) => [s.lens, s.findings, s.worst, s.score]), [['architecture', 3, 'critical', 30], ['delivery', 0, null, 100]])
})

test('nothing is filed without confirmation: propose drafts only the accepted findings', () => {
  const audit = { subject: 'project', input: '.', commit: 'a'.repeat(40), findings: mergeFindings([answer('security-privacy', [F('Token in logs', 'critical'), F('Old lodash', 'low')])]).findings }
  const none = proposeIssues(audit, {})
  assert.equal(none.confirmed, false)
  assert.deepEqual(none.drafts, [])
  const r = proposeIssues(audit, { accept: [1], artifact: '2026-11-18-audit-project' })
  assert.deepEqual(r.drafts.map((d) => [d.title, d.labels]), [['Security privacy: Token in logs', ['type:bug', 'priority:p0', 'area:audit']]])
  assert.match(r.drafts[0].body, /## Evidence\n\n- Token in logs\.ts:1/)
  assert.match(r.drafts[0].body, /artifact `2026-11-18-audit-project` at aaaaaaaaaaaa/)
  assert.equal(r.epic, null)
  assert.throws(() => proposeIssues(audit, { accept: [3] }), /there is no finding 3/)
  const many = { ...audit, findings: Array.from({ length: 6 }, (_, i) => F(`f${i}`, 'medium')).map((f) => ({ ...f, lenses: ['delivery'], alternatives: [] })) }
  assert.deepEqual(proposeIssues(many, { accept: [1, 2, 3, 4, 5, 6] }).epic.children, [1, 2, 3, 4, 5, 6], 'a larger audit becomes one epic')
})

test('agent-os audit report, propose and verify: the artifact at the audited commit, compared with the previous one', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-audit-out-'))
  const calls = []
  const gh = (args) => { calls.push(args); return { status: 1, stdout: '', stderr: 'offline' } }
  const HEAD = 'c0ffee'.padEnd(40, '0')
  const git = (args) => (args[0] === 'rev-parse' ? { status: 0, stdout: `${HEAD}\n` } : args[0] === 'cat-file' ? { status: args[2].startsWith(HEAD) ? 0 : 1, stdout: '' } : args[0] === 'rev-list' ? { status: 0, stdout: '2\n' } : { status: 1, stdout: '' })
  const cli = async (argv, now) => { let out = ''; let err = ''; const code = await run(argv, { stdout: (s) => { out += s }, stderr: (s) => { err += s }, cwd, env: {}, gh, git, now }); return { code, out, err } }
  try {
    mkdirSync(join(cwd, 'answers'))
    writeFileSync(join(cwd, 'plan.json'), JSON.stringify({ ok: true, result: { input: '.', subject: 'project', lenses: ['architecture', 'delivery'] } }))
    writeFileSync(join(cwd, 'answers/a.json'), JSON.stringify(answer('architecture', [F('No index on orders', 'medium'), F('Shared mutable cache', 'low')])))
    let r = await cli(['audit', 'report', '--plan', 'plan.json', 'answers/a.json'], new Date('2026-11-01T10:00:00Z'))
    assert.equal(r.code, 0, r.err)
    assert.match(r.out, /created artifacts\/2026-11-01-audit-project\/ \(audit at c0ffee000000\): 2 finding\(s\)/)
    assert.match(r.out, /the first audit of this subject/)
    const page = readFileSync(join(cwd, 'artifacts/2026-11-01-audit-project/index.html'), 'utf8')
    assert.deepEqual(externalLoads(page), [], 'self-contained')

    writeFileSync(join(cwd, 'answers/a.json'), JSON.stringify(answer('architecture', [F('No index on orders', 'high'), F('Secrets in .env.example', 'high', ['.env.example:3'])])))
    r = await cli(['audit', 'report', '--plan', 'plan.json', 'answers/a.json', '--json'], new Date('2026-11-18T10:00:00Z'))
    const res = JSON.parse(r.out).result
    assert.equal(res.previous, '2026-11-01-audit-project')
    assert.deepEqual([res.comparison.fixed, res.comparison.new, res.comparison.worse].map((l) => l.map((f) => f.title)), [['Shared mutable cache'], ['Secrets in .env.example'], ['No index on orders']])
    const data = JSON.parse(readFileSync(join(cwd, 'artifacts/2026-11-18-audit-project/data.json'), 'utf8'))
    assert.deepEqual(data.sections.at(-1).items, ['Fixed: Shared mutable cache', 'New: Secrets in .env.example (high)', 'Worse: No index on orders (medium → high)'])

    r = await cli(['audit', 'propose', '2026-11-18-audit-project'])
    assert.equal(r.code, 0)
    assert.match(r.out, /nothing is proposed until the person picks/)
    r = await cli(['audit', 'propose', '2026-11-18-audit-project', '--accept', '2'])
    assert.match(r.out, /#2 → Architecture: Secrets in \.env\.example \[type:chore, priority:p1, area:audit\]/)
    assert.deepEqual(calls, [], 'nothing is filed: the platform is never called')

    r = await cli(['audit', 'verify', '2026-11-18-audit-project'])
    assert.equal(r.code, 0, r.err)
    assert.match(r.out, /audited at c0ffee000000, 2 commit\(s\) since/)
    const other = JSON.parse(readFileSync(join(cwd, 'artifacts/2026-11-01-audit-project/data.json'), 'utf8'))
    other.audit.commit = 'deadbeef'
    writeFileSync(join(cwd, 'artifacts/2026-11-01-audit-project/data.json'), JSON.stringify(other))
    r = await cli(['audit', 'verify', '2026-11-01-audit-project'])
    assert.equal(r.code, 1)
    assert.match(r.out, /the audited commit is not in this repository/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
