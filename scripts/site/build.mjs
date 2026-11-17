// Builds the GitHub Pages site: every artifacts/<id>/ folder (minus build-only files) plus a generated index
// that lists them by type and date and marks an artifact stale when a source file's sha256 no longer matches.
// Usage: node scripts/site/build.mjs [outDir=_site]. Zero dependencies; the index is never committed.

import { readFileSync, readdirSync, existsSync, mkdirSync, cpSync, writeFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

const root = process.cwd()
const out = process.argv[2] ?? '_site'
const SKIP = new Set(['template.html'])

// The small YAML subset artifact.yaml uses: top-level `key: value`, inline [a, b] lists, and a
// `sources:` list of `- path: …` / `sha256: …` pairs.
function parseArtifactYaml(text) {
  const meta = { sources: [] }
  let inSources = false
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '')
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    if (/^\S/.test(line)) {
      inSources = false
      const m = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/)
      if (!m) continue
      if (m[1] === 'sources') { inSources = true; continue }
      meta[m[1]] = scalar(m[2])
    } else if (inSources) {
      const m = line.trim().match(/^-?\s*(path|sha256):\s*(.+)$/)
      if (!m) continue
      if (m[1] === 'path') meta.sources.push({ path: scalar(m[2]) })
      else meta.sources[meta.sources.length - 1].sha256 = scalar(m[2])
    }
  }
  return meta
}
function scalar(v) {
  v = v.trim()
  if (v.startsWith('[') && v.endsWith(']')) return v.slice(1, -1).split(',').map((s) => scalar(s)).filter((s) => s !== '')
  if (v.startsWith('"')) return JSON.parse(v)
  return v
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

const dir = join(root, 'artifacts')
const items = []
mkdirSync(out, { recursive: true })
for (const id of existsSync(dir) ? readdirSync(dir).sort().reverse() : []) {
  const folder = join(dir, id)
  if (!statSync(folder).isDirectory() || !existsSync(join(folder, 'artifact.yaml'))) continue
  const meta = parseArtifactYaml(readFileSync(join(folder, 'artifact.yaml'), 'utf8'))
  if (meta.id !== id) throw new Error(`artifacts/${id}: artifact.yaml id is "${meta.id}"`)
  const stale = meta.sources.filter((s) => !existsSync(join(root, s.path)) ||
    createHash('sha256').update(readFileSync(join(root, s.path))).digest('hex') !== s.sha256).map((s) => s.path)
  cpSync(folder, join(out, id), { recursive: true, filter: (p) => !SKIP.has(p.split(/[\\/]/).pop()) })
  items.push({ ...meta, stale })
}

const cards = items.map((a) => `
  <article class="card">
    <div class="meta"><span class="type">${esc(a.type)}</span><span>${esc(a.id.slice(0, 10))}</span><span>${esc(a.kind)}</span>
      ${a.stale.length ? `<span class="stale" title="${esc(a.stale.join(', '))}">stale: ${a.stale.length} source(s) changed</span>` : '<span class="ok">sources verified</span>'}</div>
    <h2><a href="${esc(a.id)}/">${esc(a.title)}</a></h2>
    <p>${esc(a.summary)}</p>
    <p class="refs">${(a.refs || []).map((r) => `<a href="https://github.com/cosmin-sisman/agent-os/issues/${esc(String(r).replace('#', ''))}">${esc(r)}</a>`).join(' ')}
      <a href="https://github.com/cosmin-sisman/agent-os/commits/development/artifacts/${esc(a.id)}">history</a></p>
  </article>`).join('')

writeFileSync(join(out, 'index.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>agent-os artifacts</title>
<style>
:root{--bg:#f5f6f8;--surface:#fff;--fg:#161a22;--muted:#5b6475;--line:#d9dde5;--accent:#3b5bdb;--ok:#15803d;--warn:#b45309}
@media (prefers-color-scheme:dark){:root{--bg:#0f1218;--surface:#171b23;--fg:#e6e9ef;--muted:#9aa3b5;--line:#2a303c;--accent:#8ea2ff;--ok:#4ade80;--warn:#fbbf24;color-scheme:dark}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:920px;margin:0 auto;padding:40px max(16px,env(safe-area-inset-left))}
header{display:flex;gap:16px;align-items:center;margin-bottom:28px}header img{width:56px;height:56px}
h1{margin:0;font-size:1.9rem}header p{margin:2px 0 0;color:var(--muted)}
.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin-bottom:12px}
.card h2{margin:6px 0 4px;font-size:1.2rem}.card a{color:var(--accent)}.card p{margin:4px 0;color:var(--muted)}
.meta{display:flex;flex-wrap:wrap;gap:8px;font:12px ui-monospace,Consolas,monospace;color:var(--muted)}
.type{color:var(--accent)}.ok{color:var(--ok)}.stale{color:var(--warn)}.refs a{margin-right:8px}
footer{color:var(--muted);font-size:.8rem;margin-top:28px}
</style></head><body><div class="wrap">
<header><img src="assets/logo.svg" alt=""><div><h1>agent-os artifacts</h1><p>Versioned in git, verified against their sources, built from <code>artifacts/</code> on every push.</p></div></header>
${cards || '<p>No artifacts yet.</p>'}
<footer>${items.length} artifact(s) · <a href="https://github.com/cosmin-sisman/agent-os">cosmin-sisman/agent-os</a></footer>
</div></body></html>
`)
mkdirSync(join(out, 'assets'), { recursive: true })
cpSync(join(root, 'docs/assets/logo.svg'), join(out, 'assets/logo.svg'))
console.log(`site: ${items.length} artifact(s), ${items.filter((a) => a.stale.length).length} stale → ${out}/`)
if (process.env.CI && items.some((a) => a.stale.length) && process.argv.includes('--strict')) process.exit(1)
