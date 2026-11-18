// Tests for stack detection and drift: detections cite their evidence file, drift between stack.yaml and the code
// (the stack says drizzle, the code imports prisma), layers the stack does not list, empty paths, the doctor check,
// the area map per layer and gate suites per layer.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { detectStack, stackDrift } from './detect.mjs'
import { run } from '../cli/main.mjs'
import { runDoctor } from '../doctor/doctor.mjs'
import { loadConfig } from '../config/config.mjs'
import { runGate } from '../gate/gate.mjs'

function repo(files) {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-detect-'))
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(cwd, p)), { recursive: true }); writeFileSync(join(cwd, p), typeof c === 'string' ? c : JSON.stringify(c)) }
  return cwd
}
const CODE = {
  'apps/web/package.json': { dependencies: { next: '15', '@sentry/nextjs': '8' } },
  'packages/db/package.json': { dependencies: { '@prisma/client': '6' }, devDependencies: { prisma: '6' } },
  'packages/db/prisma/schema.prisma': 'datasource db {}',
  'services/ml/requirements.txt': 'fastapi>=0.110\nuvicorn\n',
  '.github/workflows/ci.yml': 'on: push',
  'vercel.json': '{}',
  'node_modules/drizzle-orm/package.json': { name: 'drizzle-orm' },
  'test/__fixtures__/app/package.json': { dependencies: { nuxt: '3' } },
}
async function cli(cwd, argv) {
  let stdout = ''
  let stderr = ''
  const code = await run(argv, { stdout: (s) => { stdout += s }, stderr: (s) => { stderr += s }, cwd, env: {} })
  return { code, stdout, stderr }
}

test('each detection cites its evidence file; dependencies and fixtures are skipped', () => {
  const cwd = repo(CODE)
  try {
    const { detections, providers } = detectStack(cwd)
    const by = Object.fromEntries(detections.map((d) => [d.tech, d]))
    assert.deepEqual(Object.keys(by).sort(), ['fastapi', 'github-actions', 'next-js', 'prisma-neon-postgres', 'sentry'])
    assert.deepEqual(by['prisma-neon-postgres'].evidence, [{ file: 'packages/db/package.json', detail: '@prisma/client, prisma' }, { file: 'packages/db/prisma/schema.prisma', detail: 'file' }])
    assert.deepEqual(by['prisma-neon-postgres'].paths, ['packages/db/**', 'packages/db/prisma/**'])
    assert.equal(by.fastapi.evidence[0].file, 'services/ml/requirements.txt')
    assert.equal(by.sentry.evidence[0].detail, '@sentry/nextjs')
    assert.ok(detections.every((d) => d.evidence.length && d.evidence.every((e) => e.file)), 'every detection has evidence')
    assert.deepEqual(providers, [{ provider: 'vercel', evidence: [{ file: 'vercel.json' }] }])
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('given stack.yaml says drizzle and the code imports prisma, drift reports it; unlisted layers and empty paths too', async () => {
  const cwd = repo({ ...CODE, 'stack.yaml': 'layers:\n  data-layer:\n    tech: drizzle-supabase-postgres\n    paths: ["packages/db/**"]\n  public-frontend:\n    tech: next-js\n    paths: ["apps/site/**"]\n  monitoring: { tech: sentry }\n' })
  try {
    const { drift } = stackDrift(cwd)
    const mismatch = drift.find((d) => d.kind === 'mismatch')
    assert.match(mismatch.message, /stack\.yaml says drizzle-supabase-postgres for data-layer, but the code uses Prisma \+ Neon Postgres: packages\/db\/package\.json \(@prisma\/client, prisma\)/)
    assert.equal(mismatch.fix, 'agent-os stack set data-layer prisma-neon-postgres, or remove Prisma + Neon Postgres from the code')
    assert.ok(drift.some((d) => d.kind === 'empty-path' && d.path === 'apps/site/**'))
    assert.ok(drift.some((d) => d.kind === 'unlisted' && d.code === 'fastapi' && /services\/ml\/requirements\.txt/.test(d.message)))
    assert.equal(drift.some((d) => d.code === 'sentry' || d.code === 'next-js'), false, 'what matches is not drift')
    const r = await cli(cwd, ['stack', 'drift'])
    assert.equal(r.code, 1)
    assert.match(r.stdout, /mismatch {3}stack\.yaml says drizzle/)
    const doctor = runDoctor({ cwd, config: loadConfig(cwd).merged, running: '0.0.0' }, { offline: true, only: ['stack'] }).checks[0].findings
    assert.ok(doctor.length >= 3 && doctor.every((f) => f.level === 'warn'), 'doctor warns, it does not fail')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('stack detect --write drafts stack.yaml with the evidence in each note, and never overwrites one', async () => {
  const cwd = repo(CODE)
  try {
    const listed = await cli(cwd, ['stack', 'detect'])
    assert.match(listed.stdout, /data-layer +Prisma \+ Neon Postgres {2}← packages\/db\/package\.json \(@prisma\/client, prisma\)/)
    assert.match(listed.stdout, /provider vercel {2}← vercel\.json/)
    assert.equal((await cli(cwd, ['stack', 'detect', '--write'])).code, 0)
    const text = readFileSync(join(cwd, 'stack.yaml'), 'utf8')
    assert.match(text, /data-layer:\n {4}tech: prisma-neon-postgres\n {4}status: chosen\n {4}paths: \["packages\/db\/\*\*", "packages\/db\/prisma\/\*\*"\]\n {4}note: "detected from packages\/db\/package\.json/)
    assert.equal((await cli(cwd, ['stack', 'check'])).code, 0, 'what detect writes is valid')
    assert.match((await cli(cwd, ['stack', 'detect', '--write'])).stderr, /never overwrites/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('the area map check names a layer in use that AGENTS.md does not mention', () => {
  const cwd = repo({ 'AGENTS.md': '# A\n\n| Path | What |\n|---|---|\n| `apps/` | apps |\n', 'apps/web/x.ts': '', 'stack.yaml': 'layers:\n  internal-frontend: { tech: next-js-app, paths: ["apps/web/**"] }\n  data-layer: { tech: prisma-neon-postgres, paths: ["db/**"] }\n', 'db/schema.sql': '' })
  try {
    const f = runDoctor({ cwd, config: loadConfig(cwd).merged, running: '0.0.0' }, { offline: true, only: ['area-map'] }).checks[0].findings
    assert.ok(f.some((x) => /does not mention the data-layer layer \(db\)/.test(x.message)))
    assert.equal(f.some((x) => /internal-frontend/.test(x.message)), false, 'apps/ covers apps/web')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('gate suites attached to a layer run when the diff touches it', () => {
  const cwd = repo({ 'stack.yaml': 'layers:\n  data-layer: { tech: prisma-neon-postgres, paths: ["packages/db/**"] }\n' })
  try {
    const config = { branches: { integration: 'development' }, gate: { unit: 'u', migrations: 'm' }, gatePaths: { 'src/**': ['unit'] }, gateLayers: { 'data-layer': ['migrations', 'not-defined'] } }
    const git = (args) => (args[0] === 'diff' && args[2]?.startsWith('origin/') ? { status: 0, stdout: 'packages/db/schema.prisma' } : { status: 0, stdout: '' })
    const r = runGate({ config, git, cwd }, { dryRun: true })
    assert.deepEqual(r.suites, ['migrations'])
    assert.deepEqual(r.reasons.migrations, ['layer data-layer'])
    assert.deepEqual(r.unmatched, [], 'the layer covers the file')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
