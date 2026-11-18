// Tests for the maintenance profile: a known vulnerable dependency gives one p0/p1 proposal; the upkeep audit is
// read-only (no platform call, nothing written); secrets and licenses are proposed with evidence and no secret value;
// /runbook writes deploy, rollback, restore and the takeover dossier from the release flow, keeping existing ones.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dependencyProposals, upkeep } from './upkeep.mjs'
import { exercise } from '../security/threats.mjs'
import { run } from '../cli/main.mjs'

const repo = (files) => { const cwd = mkdtempSync(join(tmpdir(), 'aos-maint-')); for (const [p, c] of Object.entries(files)) { mkdirSync(join(cwd, p, '..'), { recursive: true }); writeFileSync(join(cwd, p), typeof c === 'string' ? c : JSON.stringify(c)) } return cwd }
const item = (id, severity, extra = {}) => ({ id, aliases: [`CVE-${id}`], severity, kev: false, fixed: '4.17.21', summary: 'prototype pollution', touched: [{ name: 'lodash', version: '4.17.15', direct: true, dev: false }], shipped: true, direct: true, accepted: false, ...extra })

test('given a known vulnerable dependency, one p0/p1 issue is proposed', () => {
  const p = dependencyProposals({ items: [item('GHSA-1', 'high'), item('GHSA-2', 'moderate')] })
  assert.equal(p.length, 1, 'one proposal per package, however many advisories')
  assert.deepEqual([p[0].priority, p[0].labels], ['priority:p1', ['type:bug', 'priority:p1', 'area:security']])
  assert.equal(p[0].title, 'Dependencies: update lodash 4.17.15 to 4.17.21 (2 advisories)')
  assert.deepEqual(p[0].evidence, ['GHSA-1 (CVE-GHSA-1): high: prototype pollution', 'GHSA-2 (CVE-GHSA-2): moderate: prototype pollution'])
  assert.equal(dependencyProposals({ items: [item('GHSA-3', 'moderate', { kev: true })] })[0].priority, 'priority:p0', 'known exploited is p0')
  assert.deepEqual(dependencyProposals({ items: [item('GHSA-4', 'critical', { accepted: true })] }), [], 'an accepted risk is not proposed')
})

test('the upkeep audit is read-only until issues are confirmed', async () => {
  const cwd = repo({
    '.agent-os/cache/security.json': { at: '2026-11-18', items: [item('GHSA-1', 'critical')] },
    'reports/gitleaks.json': [{ RuleID: 'aws-key', File: 'src/config.js', StartLine: 3, Description: 'AWS key', Secret: 'AKIAREALSECRET' }],
    'package-lock.json': { packages: { '': { name: 'app' }, 'node_modules/gpl-lib': { version: '1.0.0', license: 'GPL-3.0' }, 'node_modules/dual': { version: '1.0.0', license: '(MIT OR GPL-2.0)' }, 'node_modules/nolic': { version: '2.0.0' }, 'node_modules/devonly': { version: '1.0.0', dev: true, license: 'AGPL-3.0' } } },
  })
  const calls = []
  try {
    const tracked = ['src/config.js', '.env', '.env.example', 'package-lock.json']
    const r = upkeep(cwd, { reports: ['reports/gitleaks.json'], tracked })
    assert.deepEqual(r.proposals.map((p) => [p.id, p.priority]), [['dep:lodash', 'priority:p0'], ['secret:src/config.js:3', 'priority:p0'], ['secret:.env', 'priority:p0'], ['license:copyleft', 'priority:p1'], ['license:unknown', 'priority:p3']])
    assert.deepEqual(r.proposals.find((p) => p.id === 'license:copyleft').evidence, ['gpl-lib@1.0.0 (GPL-3.0)'], 'dual licenses and dev-only packages are fine')
    assert.equal(JSON.stringify(r).includes('AKIAREALSECRET'), false, 'the secret value is never copied')
    const before = readdirSync(cwd).sort()
    let out = ''
    const git = (a) => (a[0] === 'ls-files' ? { status: 0, stdout: tracked.join('\n') } : { status: 1, stdout: '' })
    const code = await run(['audit', 'upkeep', '--report', 'reports/gitleaks.json'], { stdout: (s) => { out += s }, stderr: () => {}, cwd, env: {}, git, gh: (a) => { calls.push(a); return { status: 1, stdout: '' } } })
    assert.equal(code, 1, 'p0 and p1 proposals fail the check')
    assert.match(out, /5 proposal\(s\), read-only: nothing is filed until the person confirms/)
    assert.match(out, /\[p0\] Secrets: stop tracking \.env/)
    assert.deepEqual(calls, [], 'no platform call')
    assert.deepEqual(readdirSync(cwd).sort(), before, 'nothing written')
    assert.match(upkeep(repo({}), {}).notes[0], /no advisory watch yet/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('/runbook writes deploy, rollback, restore and the takeover dossier from the release flow', async () => {
  const cwd = repo({
    'agent-os.json': { branches: { integration: 'develop', production: 'main', requiredChecks: ['ci'], mergeMethod: 'squash' } },
    'stack.yaml': 'layers:\n  data-layer: { tech: drizzle-supabase-postgres, paths: ["db/**"] }\n  infrastructure: { tech: fly-io, paths: ["fly.toml"] }\n',
    '.github/workflows/deploy.yml': 'on: push\n',
    '.github/CODEOWNERS': '* @ana @dan\n',
    'docs/decisions/2026-11-01-db.md': '# db\n',
  })
  const git = (a) => (a[0] === 'tag' ? { status: 0, stdout: 'v1.2.0\nv1.1.0\nv1.0.0\n' } : { status: 1, stdout: '' })
  const cli = async (argv) => { let out = ''; const code = await run(argv, { stdout: (s) => { out += s }, stderr: () => {}, cwd, env: {}, git }); return { code, out } }
  try {
    let r = await cli(['runbook', '--dry-run'])
    assert.equal(r.code, 0)
    assert.equal(existsSync(join(cwd, 'docs/runbooks')), false, 'a dry run writes nothing')
    r = await cli(['runbook'])
    assert.match(r.out, /written docs\/runbooks\/deploy\.md/)
    const read = (f) => readFileSync(join(cwd, 'docs/runbooks', f), 'utf8')
    assert.match(read('deploy.md'), /integrated on `develop` \(squash\)[\s\S]*the checks \(`ci`\)[\s\S]*CI \(`\.github\/workflows\/deploy\.yml`\) deploys to `fly-io`/)
    assert.match(read('rollback.md'), /Redeploy the previous tag \(`v1\.1\.0`\)[\s\S]*data: `drizzle-supabase-postgres`/)
    assert.match(read('restore.md'), /_to fill: location, retention, who has access_/)
    assert.match(read('takeover.md'), /Owners \(CODEOWNERS\): @ana, @dan[\s\S]*\[2026-11-01-db\.md\]\(\.\.\/\.\.\/docs\/decisions\/2026-11-01-db\.md\)/)
    writeFileSync(join(cwd, 'docs/runbooks/deploy.md'), '# Ours\n')
    r = await cli(['runbook'])
    assert.match(r.out, /kept docs\/runbooks\/deploy\.md \(exists: --force replaces it\)/)
    assert.equal(read('deploy.md'), '# Ours\n', 'the team\'s runbook is kept')
    assert.ok(exercise(cwd, 'vulnerable-dependency').steps.find((s) => s.step === 'deploy the fix').covered, 'security exercises find the deploy runbook')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
