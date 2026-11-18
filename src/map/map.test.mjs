// Tests for the on-demand map: headers in the common comment styles, covering tests, the budget, the cache (a
// 10k-file repository maps one folder in under a second when cached), nothing committed, and doctor's headers check.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { headerOf, mapArea, CACHE_FILE } from './map.mjs'
import { runDoctor } from '../doctor/doctor.mjs'

const tmp = () => mkdtempSync(join(tmpdir(), 'aos-map-'))
const write = (root, files) => { for (const [p, c] of Object.entries(files)) { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), c) } }

test('headers in the common comment styles; none for code that starts with code', () => {
  assert.equal(headerOf('// The gate: suites a diff needs.\n// Second line.\nimport x'), 'The gate: suites a diff needs. Second line.')
  assert.equal(headerOf('#!/usr/bin/env python\n# Seeds the database.\nimport os'), 'Seeds the database.')
  assert.equal(headerOf('/**\n * Billing: invoices and payments.\n */\nexport {}'), 'Billing: invoices and payments.')
  assert.equal(headerOf('"""Order service: the API."""\nimport x'), 'Order service: the API.')
  assert.equal(headerOf('-- Migration 0004: add an index.\nCREATE INDEX'), 'Migration 0004: add an index.')
  assert.equal(headerOf('<!-- Landing page hero. -->\n<div>'), 'Landing page hero.')
  assert.equal(headerOf('import x from "y"\nexport const a = 1'), null)
})

test('one area: headers, sizes, covering tests, recent changes first, within the budget', () => {
  const cwd = tmp()
  try {
    write(cwd, { 'src/billing/invoice.mjs': '// Invoices: totals and taxes.\nexport {}\n', 'src/billing/invoice.test.mjs': '// Tests for invoices.\n', 'src/billing/stripe.mjs': 'export {}\n', 'src/other/x.mjs': '// Other.\n' })
    const git = (args) => (args[0] === 'log' ? { status: 0, stdout: 'src/billing/stripe.mjs\nsrc/billing/stripe.mjs\n' } : { status: 1, stdout: '' })
    const r = mapArea({ cwd, git }, { path: 'src/billing' })
    assert.deepEqual(r.entries.map((e) => [e.file, e.header, e.tests, e.changes]), [['src/billing/stripe.mjs', null, [], 2], ['src/billing/invoice.mjs', 'Invoices: totals and taxes.', ['src/billing/invoice.test.mjs'], 0]])
    assert.match(r.text, /^# Map of src\/billing\nsrc\/billing\/stripe\.mjs \(2 lines\) \[2 change\(s\) in 30 days\]\nsrc\/billing\/invoice\.mjs \(3 lines\): Invoices: totals and taxes\. \[tests: src\/billing\/invoice\.test\.mjs\]$/)
    const tight = mapArea({ cwd }, { path: 'src', budget: 15 })
    assert.match(tight.text, /… and \d+ more file\(s\): narrow the path or raise --budget$/)
    assert.ok(tight.text.length <= 15 * 4 + 120)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('a 10k-file repository maps one folder in under a second when cached; the cache stays in .agent-os/cache', () => {
  const cwd = tmp()
  try {
    for (let d = 0; d < 100; d++) {
      mkdirSync(join(cwd, `src/m${d}`), { recursive: true })
      for (let f = 0; f < 100; f++) writeFileSync(join(cwd, `src/m${d}/f${f}.mjs`), `// Module ${d}, file ${f}.\nexport const v = ${f}\n`)
    }
    mapArea({ cwd }, { path: 'src/m42' })
    const start = performance.now()
    const r = mapArea({ cwd }, { path: 'src/m42' })
    assert.ok(performance.now() - start < 1000)
    assert.equal(r.files, 100)
    assert.ok(existsSync(join(cwd, CACHE_FILE)))
    assert.match(readFileSync(join(cwd, CACHE_FILE), 'utf8'), /src\/m42\/f0\.mjs/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('given a new file without a header, doctor warns on that file only', () => {
  const cwd = tmp()
  try {
    write(cwd, { 'src/new.mjs': 'export const a = 1\n', 'src/new-ok.mjs': '// A new module with a header.\nexport const b = 2\n', 'src/old.mjs': 'export const c = 3\n', 'README.md': '# R\n', '.gitignore': '.agent-os/local.json\n.agent-os/cache/\n' })
    const git = (args) => (args.includes('--diff-filter=A') ? { status: 0, stdout: 'src/new.mjs\nsrc/new-ok.mjs\nREADME.md\n' } : { status: 1, stdout: '' })
    const config = { branches: { integration: 'development', production: 'main' }, languages: {}, contextBudgets: {}, slots: {} }
    const f = runDoctor({ cwd, config, running: '0.0.0', git }, { offline: true, only: ['headers'] }).checks[0].findings
    assert.deepEqual(f.map((x) => [x.level, x.path]), [['warn', 'src/new.mjs']])
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})
