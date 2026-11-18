// Tests for the security pass: a new public endpoint without rate limiting is flagged with the layer checklist item;
// every finding has the fix and the reason; the checklists follow the layers the diff touches; scanner reports are
// read (never run), secrets never copied; /env reports a missing scanner.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { readScanResults, securityPass } from './pass.mjs'
import { checkScanners } from '../env/checks.mjs'
import { fakeProbe } from '../env/__fixtures__/fake-probe.mjs'
import { run } from '../cli/main.mjs'

function repo(files) {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-pass-'))
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(cwd, p)), { recursive: true }); writeFileSync(join(cwd, p), typeof c === 'string' ? c : JSON.stringify(c)) }
  return cwd
}
const BASE = { 'package.json': { dependencies: { hono: '4', react: '19' } }, 'stack.yaml': 'layers:\n  public-api-webhooks: { tech: hono-zod-openapi, paths: ["apps/api/**"] }\n  data-layer: { tech: drizzle-supabase-postgres, paths: ["packages/db/**"] }\n' }

test('given a new public endpoint without rate limiting, the pass flags it with the layer checklist item', () => {
  const cwd = repo({ ...BASE, 'apps/api/src/signup.ts': "app.post('/signup', async (c) => c.json(await createUser(await c.req.json())))\n" })
  try {
    const r = securityPass(cwd, ['apps/api/src/signup.ts'])
    assert.deepEqual(r.groups, ['api'])
    const f = r.findings[0]
    assert.deepEqual([f.level, f.layer, f.item, f.file, f.line], ['warn', 'api', 'V11.1.4 public endpoints are rate limited (anti-automation)', 'apps/api/src/signup.ts', 1])
    assert.match(f.problem, /POST \/signup is a new endpoint with no rate limiting/)
    assert.match(f.fix, /rate limiter/)
    assert.match(f.why, /brute-forced/)
    writeFileSync(join(cwd, 'apps/api/src/signup.ts'), "app.post('/signup', rateLimit({ limit: 5 }), async (c) => c.json({}))\n")
    assert.deepEqual(securityPass(cwd, ['apps/api/src/signup.ts']).findings, [], 'a rate limiter passes')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('every finding has the fix and the reason, across layers', () => {
  const cwd = repo({
    ...BASE,
    'apps/api/src/hooks.ts': "app.post('/webhooks/stripe', async (c) => handle(await c.req.json()))\n",
    'packages/db/src/users.ts': 'export const byName = (n) => db.query(`SELECT * FROM users WHERE name = \'${n}\'`)\n',
    'apps/web/src/Bio.tsx': 'export const Bio = ({ html }) => <div dangerouslySetInnerHTML={{ __html: html }} />\nconst key = process.env.NEXT_PUBLIC_STRIPE_SECRET_KEY\n',
    'apps/auth/session.ts': "jwt.verify(token, key, { algorithms: ['none'] })\nres.cookie('sid', id, { httpOnly: false })\n",
    'Dockerfile': 'FROM node:latest\nCOPY . .\n',
    'infra/main.tf': 'cidr_blocks = ["0.0.0.0/0"]\n',
    '.github/workflows/x.yml': 'on: [pull_request]\npermissions:\n  contents: read\nconcurrency:\n  group: x\n  cancel-in-progress: true\njobs:\n  a:\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    steps:\n      - run: echo "${{ github.event.pull_request.title }}"\n',
  })
  try {
    const files = ['apps/api/src/hooks.ts', 'packages/db/src/users.ts', 'apps/web/src/Bio.tsx', 'apps/auth/session.ts', 'Dockerfile', 'infra/main.tf', '.github/workflows/x.yml']
    const r = securityPass(cwd, files)
    assert.ok(r.findings.length >= 9, JSON.stringify(r.findings.map((f) => f.item)))
    for (const f of r.findings) {
      assert.ok(f.fix && f.why && f.item && f.file, `${f.item}: fix, reason, checklist item and file`)
      assert.match(f.item, /^V\d+\.\d+\.\d+ /)
    }
    const items = new Set(r.findings.map((f) => f.item.split(' ')[0]))
    for (const id of ['V13.2.1', 'V5.3.4', 'V5.3.3', 'V14.1.1', 'V3.5.3', 'V3.4.1', 'V14.1.2', 'V14.1.3', 'V14.1.5']) assert.ok(items.has(id), id)
    assert.deepEqual(r.groups, ['api', 'auth', 'ci', 'data', 'frontend', 'infra'])
    assert.ok(r.checklists.data.some((i) => i.id === 'V4.2.1'), 'the layer checklist is listed for review by hand')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('scanner reports are read, never run; findings outside the diff are left out; secrets are never copied', async () => {
  const cwd = repo({
    ...BASE,
    'apps/api/src/a.ts': "app.get('/a', requireAuth, h)\n",
    'reports/semgrep.sarif': { runs: [{ tool: { driver: { name: 'Semgrep' } }, results: [{ ruleId: 'js.xss', level: 'error', message: { text: 'XSS sink' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'apps/api/src/a.ts' }, region: { startLine: 1 } } }] }, { ruleId: 'old', level: 'warning', message: { text: 'elsewhere' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'other.ts' } } }] }] }] },
    'reports/gitleaks.json': [{ RuleID: 'stripe-key', File: 'apps/api/src/a.ts', StartLine: 1, Description: 'Stripe key', Secret: 'sk_live_REALSECRET' }],
    'agent-os.json': { security: { reports: ['reports/semgrep.sarif'] } },
  })
  try {
    const scans = readScanResults(cwd, ['reports/semgrep.sarif', 'reports/gitleaks.json', 'reports/missing.sarif'])
    assert.equal(JSON.stringify(scans).includes('REALSECRET'), false, 'the secret value is never copied')
    assert.deepEqual(scans.map((s) => [s.scanner, s.level, s.file]), [['Semgrep', 'error', 'apps/api/src/a.ts'], ['Semgrep', 'warn', 'other.ts'], ['gitleaks', 'error', 'apps/api/src/a.ts'], ['reports/missing.sarif', 'warn', undefined]])
    const r = securityPass(cwd, ['apps/api/src/a.ts'], { scanResults: ['reports/semgrep.sarif', 'reports/gitleaks.json'] })
    assert.deepEqual(r.scans.map((s) => s.rule), ['js.xss', 'stripe-key'], 'only findings on the changed files')
    const git = (args) => (args[0] === 'diff' && args[2]?.startsWith('origin/') ? { status: 0, stdout: 'apps/api/src/a.ts' } : { status: 0, stdout: '' })
    let out = ''
    assert.equal(await run(['security', 'pass', '--report', 'reports/gitleaks.json'], { stdout: (s) => { out += s }, stderr: () => {}, cwd, env: {}, git }), 1)
    assert.match(out, /FAIL {2}\[Semgrep\] apps\/api\/src\/a\.ts:1: XSS sink \(js\.xss\)/)
    assert.match(out, /FAIL {2}\[gitleaks\] apps\/api\/src\/a\.ts:1: possible secret \(Stripe key\); value not shown/)
    assert.match(out, /check by hand for the layers this change touches:[\s\S]*V4\.1\.3/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('/env reports missing scanners; agent-os only asks for their version, it never runs a scan', () => {
  const probe = fakeProbe({ commands: { 'gitleaks --version': { stdout: 'v8.18.0' } } })
  const f = checkScanners({ security: { scanners: ['gitleaks', 'osv-scanner'] } }, { probe })
  assert.deepEqual(f.map((x) => [x.level, x.message]), [['ok', 'scanner gitleaks is installed'], ['warn', 'scanner osv-scanner is not installed, so the security pass has no osv-scanner results']])
  assert.deepEqual(probe.calls, ['gitleaks --version', 'osv-scanner --version'])
})
