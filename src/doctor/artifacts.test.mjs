// Tests for doctor's artifacts check: a page loading a CDN script fails naming the URL, other external loads too
// (links do not count), invalid metadata, unknown refs, the size budget and stale sources.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runDoctor } from './doctor.mjs'
import { loadConfig } from '../config/config.mjs'
import { externalLoads } from '../artifacts/artifact.mjs'

const META = (id, extra = '') => `id: ${id}\ntitle: "T"\ntype: analysis\nkind: snapshot\nstatus: current\nsummary: "S"\n${extra}`
function repo(pages) {
  const cwd = mkdtempSync(join(tmpdir(), 'aos-doc-art-'))
  writeFileSync(join(cwd, 'agent-os.json'), JSON.stringify({ artifacts: { maxPageKb: 16 } }))
  for (const [id, { meta, html }] of Object.entries(pages)) {
    mkdirSync(join(cwd, 'artifacts', id), { recursive: true })
    writeFileSync(join(cwd, 'artifacts', id, 'artifact.yaml'), meta ?? META(id))
    if (html !== undefined) writeFileSync(join(cwd, 'artifacts', id, 'index.html'), html)
  }
  return cwd
}
const check = (cwd) => runDoctor({ cwd, config: loadConfig(cwd).merged, running: '0.0.0' }, { offline: true, only: ['artifacts'] }).checks.find((r) => r.id === 'artifacts').findings

test('given a page loading a CDN script, doctor fails naming the URL', () => {
  const cwd = repo({ '2026-11-18-cdn': { html: '<!doctype html><script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script><a href="https://example.com">docs</a>' } })
  try {
    const f = check(cwd)
    assert.deepEqual(f.map((x) => x.level), ['fail'])
    assert.match(f[0].message, /artifacts\/2026-11-18-cdn\/index\.html loads from outside: https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js@4$/)
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('every kind of external load is found; links, data URIs and relative paths are not loads', () => {
  const html = `<link rel="stylesheet" href="//fonts.example/css"><img src="http://img.example/a.png"><img srcset="a.png 1x, https://img.example/b.png 2x">
<style>@import "https://x.example/s.css"; body{background:url('https://x.example/bg.png')}</style>
<script>fetch("https://api.example/data"); new WebSocket("wss://ws.example/");</script>
<a href="https://ok.example">ok</a><img src="data:image/png;base64,AAAA"><img src="data/local.png">`
  assert.deepEqual(externalLoads(html).sort(), ['//fonts.example/css', 'http://img.example/a.png', 'https://api.example/data', 'https://img.example/b.png', 'https://x.example/bg.png', 'https://x.example/s.css', 'wss://ws.example/'].sort())
})

test('invalid metadata fails; unknown refs, an oversized page and stale sources warn; a clean artifact is ok', () => {
  const cwd = repo({
    '2026-11-18-bad': { meta: META('2026-11-17-other'), html: '<p>x</p>' },
    '2026-11-18-refs': { meta: META('2026-11-18-refs', 'refs: ["#12", "!3", "2026-01-01-nope", "JIRA-7"]\nsources:\n  - path: gone.csv\n    sha256: ' + '0'.repeat(64) + '\n'), html: `<p>${'x'.repeat(20 * 1024)}</p>` },
    '2026-11-18-nopage': {},
  })
  try {
    const f = check(cwd)
    const by = (re) => f.filter((x) => re.test(x.message)).map((x) => x.level)
    assert.deepEqual(by(/2026-11-18-bad: id "2026-11-17-other" must equal the folder name/), ['fail'])
    assert.deepEqual(by(/ref "2026-01-01-nope"|ref "JIRA-7"/), ['warn', 'warn'])
    assert.deepEqual(by(/over its 16 KB budget/), ['warn'])
    assert.deepEqual(by(/is stale: gone\.csv changed/), ['warn'])
    assert.deepEqual(by(/2026-11-18-nopage has no index\.html/), ['fail'])
  } finally { rmSync(cwd, { recursive: true, force: true }) }
  const clean = repo({ '2026-11-18-ok': { html: '<!doctype html><style>b{}</style><p>self-contained</p>' } })
  try { assert.deepEqual(check(clean).map((x) => x.level), ['ok']) } finally { rmSync(clean, { recursive: true, force: true }) }
})
