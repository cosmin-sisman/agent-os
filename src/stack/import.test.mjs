// Tests for stack import: a builder sheet with 15 layers becomes stack.yaml with their statuses, unknown technologies
// become overlay suggestions, csv works too, and the xlsx reader is bounded (zip bombs, unsafe paths, values only).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from '../yaml/yaml.mjs'
import { run } from '../cli/main.mjs'
import { readXlsx, zipEntries } from './xlsx.mjs'
import { parseCsv } from './import.mjs'
import { xlsx, zip } from './__fixtures__/make-xlsx.mjs'

const LAYERS = [
  ['Public Frontend', 'Astro', 'Cloudflare', 'Ales', 'Site + blog'], ['Internal Frontend', 'Vite + React + TanStack Router', '', 'Ales', ''],
  ['Mobile', 'Expo (React Native)', '', 'De evaluat', 'Faza 2'], ['Internal API', 'Hono + tRPC', '', 'Ales', ''],
  ['Public API + Webhooks', 'Hono + zod-openapi', '', 'Opțional', ''], ['Backend Services', 'Modular monolith (Node)', '', 'Ales', ''],
  ['Background Workers', 'pg-boss', '', 'Ales', ''], ['Data Layer', 'Drizzle + Supabase Postgres', '', 'Ales', ''],
  ['Storage', 'Supabase Storage', '', 'Ales', ''], ['Auth', 'Supabase Auth', '', 'Respins', ''],
  ['Email / Notificări', 'Resend', '', 'Ales', ''], ['Plăți', 'Stripe', '', 'Ales', ''],
  ['CI/CD', 'GitHub Actions', '', 'Ales', ''], ['Infrastructure', 'Turborepo + pnpm', '', 'Ales', ''], ['Monitoring', 'Our Log Box', '', 'Ales', 'in-house'],
]
const BUILDER = [
  ['Builder – stack'], ['', 'Nume proiect', 'Facturi SaaS'], ['', 'Nivel', 'Nivel 3'], [],
  ['#', 'Strat ▼', 'Tehnologie ▼', 'Furnizor ales ▼', 'Status ▼', 'Note'],
  ...LAYERS.map((l, i) => [String(i + 1), ...l]),
  ['16', '', '', '', '', ''], ['', 'A footnote under the table, not a layer.'],
]
const LIMITS_SMALL = { maxEntries: 500, maxEntryBytes: 32 * 1024 * 1024, maxTotalBytes: 64 * 1024 * 1024, maxRatio: 200, maxFileBytes: 32 * 1024 * 1024 }
const tmp = () => mkdtempSync(join(tmpdir(), 'aos-import-'))
async function cli(cwd, argv) {
  let stdout = ''
  let stderr = ''
  const code = await run(argv, { stdout: (s) => { stdout += s }, stderr: (s) => { stderr += s }, cwd, env: {} })
  return { code, stdout, stderr }
}

test('given a builder sheet with 15 layers, stack.yaml has 15 layers with statuses', async () => {
  const cwd = tmp()
  try {
    writeFileSync(join(cwd, 'builder.xlsx'), xlsx([{ name: 'Rezumat', rows: [['nothing here']] }, { name: 'Builder', rows: BUILDER }]))
    const r = await cli(cwd, ['stack', 'import', 'builder.xlsx', '--write'])
    assert.equal(r.code, 0, r.stderr)
    assert.match(r.stdout, /sheet Builder: 15 layer\(s\), project "Facturi SaaS", level 3/)
    const stack = parse(readFileSync(join(cwd, 'stack.yaml'), 'utf8'))
    assert.equal(Object.keys(stack.layers).length, 15)
    assert.deepEqual([stack.project, stack.level], ['Facturi SaaS', 3])
    assert.deepEqual(stack.layers['public-frontend'], { tech: 'astro', provider: 'cloudflare', status: 'chosen', paths: [], note: 'Site + blog' })
    assert.deepEqual([stack.layers.mobile.status, stack.layers['public-api-webhooks'].status, stack.layers.auth.status], ['evaluating', 'optional', 'rejected'])
    assert.equal(stack.layers['email-notifications'].tech, 'resend', 'names map to catalog ids whatever their diacritics')
    assert.equal(stack.layers.payments.tech, 'stripe')
    assert.match((await cli(cwd, ['stack', 'import', 'builder.xlsx', '--write'])).stderr, /already exists/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('unknown technologies become overlay suggestions; --overlay adds them and the stack then checks', async () => {
  const cwd = tmp()
  try {
    writeFileSync(join(cwd, 'builder.xlsx'), xlsx([{ name: 'Builder', rows: BUILDER }]))
    const r = await cli(cwd, ['stack', 'import', 'builder.xlsx', '--write'])
    assert.match(r.stdout, /not in the catalog \(overlay suggestions, add them with --overlay\): technology "Our Log Box" → our-log-box/)
    assert.equal(parse(readFileSync(join(cwd, 'stack.yaml'), 'utf8')).layers.monitoring.tech, 'our-log-box')
    assert.equal((await cli(cwd, ['stack', 'check'])).code, 1, 'until the overlay exists, the id is unknown')
    const o = await cli(cwd, ['stack', 'import', 'builder.xlsx', '--write', '--force', '--overlay'])
    assert.match(o.stdout, /added to the overlay: technologies:our-log-box/)
    assert.match(readFileSync(join(cwd, '.agent-os/catalog/technologies.yaml'), 'utf8'), /- id: our-log-box\n {2}name: "Our Log Box"\n {2}layer: "monitoring"/)
    assert.equal((await cli(cwd, ['stack', 'check'])).code, 0)
    assert.equal((await cli(cwd, ['stack', 'catalog', 'check'])).code, 0, 'the overlay entry is valid')
    assert.match((await cli(cwd, ['stack', 'import', 'builder.xlsx', '--overlay'])).stdout, /nothing to add to the overlay/, 'never added twice')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('csv: comma or semicolon, quotes and en headers', async () => {
  assert.deepEqual(parseCsv('a;"b;c";"say ""hi"""\r\n1;2;3\n'), [['a', 'b;c', 'say "hi"'], ['1', '2', '3']])
  const cwd = tmp()
  try {
    writeFileSync(join(cwd, 'stack.csv'), 'Layer,Technology,Provider,Status,Notes\nData Layer,Prisma + Neon Postgres,,chosen,"Neon, branches"\nAuth,Clerk,,evaluating,\n')
    const r = await cli(cwd, ['stack', 'import', 'stack.csv', '--json'])
    const layers = JSON.parse(r.stdout).result.layers
    assert.deepEqual(layers.map((l) => [l.layer, l.tech, l.status, l.note]), [['data-layer', 'prisma-neon-postgres', 'chosen', 'Neon, branches'], ['auth', 'clerk', 'evaluating', null]])
    assert.equal(existsSync(join(cwd, 'stack.yaml')), false, 'without --write it only prints')
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('xlsx values only: a formula gives its cached value, never its expression', () => {
  const [sheet] = readXlsx(xlsx([{ name: 'S', rows: [['a', { f: 'HYPERLINK("http://x","y")', v: 'cached' }, 7]] }]))
  assert.deepEqual(sheet.rows, [['a', 'cached', '7']])
})

test('the xlsx reader is bounded: unsafe paths, too many entries, zip bombs and lying sizes are refused', () => {
  assert.throws(() => zipEntries(zip([{ name: '../evil.xml', data: 'x' }])), /unsafe path: \.\.\/evil\.xml/)
  assert.throws(() => zipEntries(zip([{ name: '/abs.xml', data: 'x' }])), /unsafe path/)
  assert.throws(() => zipEntries(zip(Array.from({ length: 4 }, (_, i) => ({ name: `f${i}`, data: 'x' }))), { ...LIMITS_SMALL, maxEntries: 3 }), /4 entries, more than 3/)
  assert.throws(() => zipEntries(zip([{ name: 'bomb.xml', data: Buffer.alloc(2 * 1024 * 1024) }])), /looks like a zip bomb/)
  assert.throws(() => zipEntries(zip([{ name: 'big.xml', data: 'x', declaredSize: 40 * 1024 * 1024 }])), /would unpack to/)
  const lying = zip([{ name: 'xl/workbook.xml', data: 'y'.repeat(5000), declaredSize: 10 }, { name: 'xl/_rels/workbook.xml.rels', data: '' }])
  assert.throws(() => readXlsx(lying, { ...LIMITS_SMALL, maxRatio: 1e9 }), /could not be unpacked within its declared size/)
  assert.throws(() => readXlsx(Buffer.from('not a zip at all')), /not a zip file/)
})
