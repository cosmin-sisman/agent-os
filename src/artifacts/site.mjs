// The artifact site a project publishes (GitHub Pages or GitLab Pages): every artifact folder, minus build-only files,
// plus an index by type, date, area and linked item, with each artifact's verification status. Built in CI into an
// output folder and never committed; the index is self-contained like the artifacts themselves.

import { cpSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { CliError } from '../cli/errors.mjs'
import { DIR, listArtifacts } from './artifact.mjs'
import { vocabularyFor } from '../platform/vocabulary.mjs'
import { systemPages } from '../system/docs.mjs'

const BUILD_ONLY = new Set(['template.html'])
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

/** A link for a ref (#N issue, !N merge request) on the project's web URL, or null (decisions, epics, unknown). */
export function refLink(ref, webUrl, vocab = vocabularyFor()) {
  if (!webUrl) return null
  const m = String(ref).match(/^([#!])(\d+)$/)
  if (!m) return null
  return `${webUrl}/${m[1] === '!' ? vocab.crPath : 'issues'}/${m[2]}`
}

/** The project's web URL from the configuration (the platform's cloud host, or a self-managed one). */
export function webUrlOf(config) {
  const p = config.platform ?? {}
  if (!p.project) return null
  return `${(p.host ?? vocabularyFor(p.type).host).replace(/\/+$/, '')}/${p.project}`
}

/** The index page: sections by type, newest first, with areas, refs and verification; an index by linked item. */
export function renderIndex(items, { title = 'Artifacts', webUrl = null, vocab = vocabularyFor(), pages = [] } = {}) {
  const link = (r) => refLink(r, webUrl, vocab)
  const byType = new Map()
  for (const a of items) byType.set(a.type ?? 'other', [...(byType.get(a.type ?? 'other') ?? []), a])
  const card = (a) => `
  <article class="card" id="${esc(a.folder)}">
    <div class="meta"><span>${esc(a.folder.slice(0, 10))}</span><span>${esc(a.kind)}</span><span>${esc(a.status)}</span>
      ${(a.areas ?? []).map((x) => `<span class="area">${esc(x)}</span>`).join('')}
      ${a.stale.length ? `<span class="stale" title="${esc(a.stale.join(', '))}">stale: ${a.stale.length} source(s) changed</span>` : '<span class="ok">sources verified</span>'}</div>
    <h3><a href="${esc(a.folder)}/">${esc(a.title)}</a></h3>
    <p>${esc(a.summary)}</p>
    ${(a.refs ?? []).length ? `<p class="refs">${a.refs.map((r) => (link(r) ? `<a href="${esc(link(r))}">${esc(r)}</a>` : `<span>${esc(r)}</span>`)).join(' ')}</p>` : ''}
  </article>`
  const sections = [...byType.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([type, list]) => `<section><h2>${esc(type)} <small>${list.length}</small></h2>${list.map(card).join('')}</section>`).join('\n')
  const refs = new Map()
  for (const a of items) for (const r of a.refs ?? []) refs.set(r, [...(refs.get(r) ?? []), a])
  const byRef = refs.size ? `<section><h2>By linked item</h2><ul class="byref">${[...refs.entries()].sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })).map(([r, list]) => `<li>${link(r) ? `<a href="${esc(link(r))}">${esc(r)}</a>` : esc(r)}: ${list.map((a) => `<a href="#${esc(a.folder)}">${esc(a.title)}</a>`).join(', ')}</li>`).join('')}</ul></section>` : ''
  const stale = items.filter((a) => a.stale.length).length
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{--bg:#f5f6f8;--surface:#fff;--fg:#161a22;--muted:#5b6475;--line:#d9dde5;--accent:#3b5bdb;--ok:#15803d;--warn:#b45309}
@media (prefers-color-scheme:dark){:root{--bg:#0f1218;--surface:#171b23;--fg:#e6e9ef;--muted:#9aa3b5;--line:#2a303c;--accent:#8ea2ff;--ok:#4ade80;--warn:#fbbf24;color-scheme:dark}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:920px;margin:0 auto;padding:32px 16px}h1{margin:0 0 4px;font-size:1.8rem}.lead{color:var(--muted);margin:0 0 24px}
h2{font-size:1.1rem;margin:28px 0 10px;text-transform:capitalize}h2 small{color:var(--muted);font-weight:400}
.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-bottom:10px}
.card h3{margin:6px 0 4px;font-size:1.1rem}a{color:var(--accent)}.card p{margin:4px 0;color:var(--muted)}
.meta{display:flex;flex-wrap:wrap;gap:8px;font:12px ui-monospace,Consolas,monospace;color:var(--muted)}
.area{color:var(--accent)}.ok{color:var(--ok)}.stale{color:var(--warn)}.refs a,.refs span{margin-right:8px}.byref{padding-left:18px}
</style></head><body><div class="wrap">
<h1>${esc(title)}</h1><p class="lead">${items.length} artifact(s), ${stale ? `${stale} stale` : 'all verified against their sources'}. Built from <code>artifacts/</code> in CI; this index is never committed.</p>
${pages.length ? `<section><h2>System <small>${pages.length}</small></h2>${pages.map((p) => `<article class="card"><div class="meta"><span>${esc(p.kind)}</span><span>${esc(p.source)}</span></div><h3><a href="${esc(p.path.replace(/index\.html$/, ''))}">${esc(p.title)}</a></h3></article>`).join('')}</section>` : ''}
${sections || (pages.length ? '' : '<p>No artifacts yet.</p>')}
${byRef}
</div></body></html>
`
}

/**
 * Builds the site into `out` (outside artifacts/): the artifact folders without build-only files, and the index.
 * Returns the artifacts with their staleness.
 */
export function buildSite(root, out, { title, webUrl, vocab } = {}) {
  const target = resolve(root, out)
  const rel = relative(resolve(root, DIR), target)
  if (!rel.startsWith('..') && !isAbsolute(rel)) throw new CliError(`the site cannot be built inside ${DIR}/`, { hint: 'build it into _site or .agent-os/cache/site' })
  const items = listArtifacts(root).filter((a) => !a.problems.length)
  mkdirSync(target, { recursive: true })
  for (const a of items) cpSync(join(root, DIR, a.folder), join(target, a.folder), { recursive: true, filter: (p) => !BUILD_ONLY.has(basename(p)) })
  // Pages from the system map (#118): API references per spec and the system map diagram, rebuilt on every build.
  const pages = systemPages(root)
  for (const p of pages) { mkdirSync(join(target, dirname(p.path)), { recursive: true }); writeFileSync(join(target, p.path), p.html) }
  writeFileSync(join(target, 'index.html'), renderIndex(items, { title, webUrl, vocab, pages }))
  return { out: target, items, pages: pages.map(({ html, ...p }) => p), skipped: listArtifacts(root).filter((a) => a.problems.length).map((a) => a.folder) }
}
