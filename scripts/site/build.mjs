// Builds the GitHub Pages site: every artifacts/<id>/ folder (minus build-only files) plus a generated index
// that lists them by type and date and marks an artifact stale when a source file's sha256 no longer matches.
// Usage: node scripts/site/build.mjs [outDir=_site] [--strict]. Zero dependencies; the index is never committed.

import { readFileSync, readdirSync, existsSync, mkdirSync, cpSync, writeFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse } from '../../src/yaml/yaml.mjs'

const REPO_URL = 'https://github.com/cosmin-sisman/agent-os'
const BUILD_ONLY = new Set(['template.html'])

/**
 * Reads artifact.yaml with the package's YAML parser and normalizes `sources` to a list.
 * @param {string} text
 * @param {string} [file] used in error messages
 */
export function parseArtifactYaml(text, file = 'artifact.yaml') {
  const meta = parse(text, { file }) ?? {}
  return { ...meta, sources: Array.isArray(meta.sources) ? meta.sources : [] }
}

/** Lists the artifact paths whose sha256 no longer matches the recorded one (or that are missing). */
export function staleSources(root, sources) {
  return sources.filter((s) => {
    const file = join(root, s.path)
    return !existsSync(file) || createHash('sha256').update(readFileSync(file)).digest('hex') !== s.sha256
  }).map((s) => s.path)
}

/** Reads every artifacts/<id>/artifact.yaml under root, newest first, with its staleness. */
export function collectArtifacts(root) {
  const dir = join(root, 'artifacts')
  if (!existsSync(dir)) return []
  const items = []
  for (const id of readdirSync(dir).sort().reverse()) {
    const folder = join(dir, id)
    if (!statSync(folder).isDirectory() || !existsSync(join(folder, 'artifact.yaml'))) continue
    const meta = parseArtifactYaml(readFileSync(join(folder, 'artifact.yaml'), 'utf8'), `artifacts/${id}/artifact.yaml`)
    if (meta.id !== id) throw new Error(`artifacts/${id}: artifact.yaml id is "${meta.id}"`)
    items.push({ ...meta, folder, stale: staleSources(root, meta.sources) })
  }
  return items
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

/** Renders the index page for the given artifacts. */
export function renderIndex(items) {
  const cards = items.map((a) => `
  <article class="card">
    <div class="meta"><span class="type">${esc(a.type)}</span><span>${esc(a.id.slice(0, 10))}</span><span>${esc(a.kind)}</span>
      ${a.stale.length ? `<span class="stale" title="${esc(a.stale.join(', '))}">stale: ${a.stale.length} source(s) changed</span>` : '<span class="ok">sources verified</span>'}</div>
    <h2><a href="${esc(a.id)}/">${esc(a.title)}</a></h2>
    <p>${esc(a.summary)}</p>
    <p class="refs">${(a.refs || []).map((r) => `<a href="${REPO_URL}/issues/${esc(String(r).replace('#', ''))}">${esc(r)}</a>`).join(' ')}
      <a href="${REPO_URL}/commits/development/artifacts/${esc(a.id)}">history</a></p>
  </article>`).join('')
  return `<!doctype html>
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
<footer>${items.length} artifact(s) · <a href="${REPO_URL}">cosmin-sisman/agent-os</a></footer>
</div></body></html>
`
}

/** Builds the site into `out`: artifact folders, the index and the logo. Returns the artifacts. */
export function buildSite(root, out) {
  const items = collectArtifacts(root)
  mkdirSync(out, { recursive: true })
  for (const a of items) cpSync(a.folder, join(out, a.id), { recursive: true, filter: (p) => !BUILD_ONLY.has(basename(p)) })
  writeFileSync(join(out, 'index.html'), renderIndex(items))
  const logo = join(root, 'docs/assets/logo.svg')
  if (existsSync(logo)) {
    mkdirSync(join(out, 'assets'), { recursive: true })
    cpSync(logo, join(out, 'assets/logo.svg'))
  }
  return items
}

function main() {
  const args = process.argv.slice(2)
  const out = args.find((a) => !a.startsWith('--')) ?? '_site'
  const items = buildSite(process.cwd(), out)
  const stale = items.filter((a) => a.stale.length)
  console.log(`site: ${items.length} artifact(s), ${stale.length} stale → ${out}/`)
  if (args.includes('--strict') && stale.length) {
    for (const a of stale) console.error(`stale: ${a.id}: ${a.stale.join(', ')}`)
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
