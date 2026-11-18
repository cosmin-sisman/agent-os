// Tests for stack changes as decisions: stack.yaml edited in place (block, inline and missing layers, comments kept),
// the decision record citing the old and new scores, proposed follow-up issues, and the refusals.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '../yaml/yaml.mjs'
import { run } from '../cli/main.mjs'
import { checkDecisions } from '../decisions/decisions.mjs'
import { setLayerKey } from './change.mjs'

const EXAMPLE = fileURLToPath(new URL('../../examples/stack.yaml', import.meta.url))
const NOW = new Date('2026-11-18T10:00:00Z')
function project() {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-stackset-'))
  copyFileSync(EXAMPLE, join(cwd, 'stack.yaml'))
  return cwd
}
async function cli(cwd, argv) {
  let stdout = ''
  let stderr = ''
  const code = await run(argv, { stdout: (s) => { stdout += s }, stderr: (s) => { stderr += s }, cwd, env: {}, now: NOW })
  return { code, stdout, stderr }
}

test('stack.yaml is edited in place: block, inline and missing layers; comments and the rest untouched', () => {
  const text = 'project: "x"\n# layers below\nlayers:\n  data-layer:\n    tech: a   # the ORM\n    status: chosen\n  auth: { tech: b, status: chosen }\n  storage: { tech: c }\n'
  const block = setLayerKey(text, 'data-layer', 'tech', 'z')
  assert.equal(block, text.replace('tech: a   # the ORM', 'tech: z   # the ORM'))
  assert.equal(setLayerKey(text, 'auth', 'status', 'rejected'), text.replace('{ tech: b, status: chosen }', '{ tech: b, status: rejected }'))
  assert.match(setLayerKey(text, 'storage', 'status', 'optional'), /storage: \{ tech: c, status: optional \}/)
  const added = setLayerKey(text, 'monitoring', 'tech', 'sentry')
  assert.deepEqual(parse(added).layers.monitoring, { tech: 'sentry' })
  assert.deepEqual(parse(setLayerKey(text, 'data-layer', 'note', '"x"')).layers['data-layer'], { note: 'x', tech: 'a', status: 'chosen' })
})

test('given set data-layer prisma-neon-postgres, a decision record and a migration issue are proposed; the decision cites the old and new scores', async () => {
  const cwd = project()
  try {
    const r = await cli(cwd, ['stack', 'set', 'data-layer', 'prisma-neon-postgres', '--why', 'Neon branches per pull request.', '--json'])
    assert.equal(r.code, 0, r.stderr)
    const out = JSON.parse(r.stdout).result
    assert.equal(parse(readFileSync(join(cwd, 'stack.yaml'), 'utf8')).layers['data-layer'].tech, 'prisma-neon-postgres')
    assert.equal(out.decision, 'docs/decisions/2026-11-18-stack-data-layer-prisma-neon-postgres.md')
    const record = readFileSync(join(cwd, out.decision), 'utf8')
    assert.match(record, /^# Data Layer: Drizzle \+ Supabase Postgres replaced by Prisma \+ Neon Postgres$/m)
    assert.match(record, /\| complexity \(1 simple, 5 complex\) \| 3 \| 2 \|/)
    assert.match(record, /\| AI-friendliness \(1 to 5\) \| 5 \| 5 \|/)
    assert.match(record, /\| provider \(cost 1 to 5\) \| supabase \(\d\) \| neon \(\d\) \|/)
    assert.match(record, /Neon branches per pull request\./)
    assert.deepEqual(checkDecisions(cwd).problems, [])
    assert.ok(out.proposed.some((p) => p.title === 'Data Layer: migrate from Drizzle + Supabase Postgres to Prisma + Neon Postgres' && /## Test scenarios/.test(p.body)))
    assert.match((await cli(cwd, ['stack', 'set', 'data-layer', 'prisma-neon-postgres'])).stdout, /nothing to change/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('stack status changes the status as a decision; rejecting a layer with paths proposes removing it', async () => {
  const cwd = project()
  try {
    const r = await cli(cwd, ['stack', 'status', 'payments', 'rejected'])
    assert.equal(r.code, 0, r.stderr)
    assert.equal(parse(readFileSync(join(cwd, 'stack.yaml'), 'utf8')).layers.payments.status, 'rejected')
    assert.match(r.stdout, /Payments: remove Stripe/)
    assert.equal(readdirSync(join(cwd, 'docs/decisions')).length, 1)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('dry run changes nothing; unknown layers, technologies and statuses are refused with the closest match', async () => {
  const cwd = project()
  try {
    const before = readFileSync(join(cwd, 'stack.yaml'), 'utf8')
    assert.equal((await cli(cwd, ['stack', 'set', 'data-layer', 'prisma-neon-postgres', '--dry-run'])).code, 0)
    assert.equal(readFileSync(join(cwd, 'stack.yaml'), 'utf8'), before)
    assert.equal(existsSync(join(cwd, 'docs')), false)
    assert.match((await cli(cwd, ['stack', 'set', 'data-layr', 'x'])).stderr, /did you mean "data-layer"/)
    assert.match((await cli(cwd, ['stack', 'set', 'data-layer', 'prisma-neon-postgre'])).stderr, /did you mean "prisma-neon-postgres"/)
    assert.match((await cli(cwd, ['stack', 'status', 'auth', 'maybe'])).stderr, /status must be chosen, evaluating, optional, rejected/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
