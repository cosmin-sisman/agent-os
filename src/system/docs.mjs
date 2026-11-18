// Pages for the artifact site from the system map: an API reference per spec (OpenAPI operations with their
// parameters, request and response fields; AsyncAPI channels) and a system map diagram (components by kind, edges,
// exposure) as inline SVG. Like every artifact they are self-contained: no scripts, styles or fonts from anywhere
// else, so Swagger UI and Redoc (which load from CDNs) are not used. `draftSpec` turns the endpoint inventory into an
// OpenAPI skeleton for a component that has none.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readSystem, KINDS } from './system.mjs'
import { readSpec, specFiles } from './contracts.mjs'
import { inventory } from './endpoints.mjs'

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']
const STYLE = `:root{--bg:#f6f7f9;--surface:#fff;--fg:#161a22;--muted:#5b6475;--line:#d9dde5;--accent:#3b5bdb;--get:#15803d;--post:#1d4ed8;--put:#b45309;--patch:#7c3aed;--delete:#b91c1c}
@media (prefers-color-scheme:dark){:root{--bg:#0f1218;--surface:#171b23;--fg:#e6e9ef;--muted:#9aa3b5;--line:#2a303c;--accent:#8ea2ff;color-scheme:dark}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:960px;margin:0 auto;padding:28px 16px}
h1{margin:0 0 4px}.lead{color:var(--muted);margin:0 0 20px}a{color:var(--accent)}
.op{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:10px 0}
.m{display:inline-block;min-width:64px;font:700 12px ui-monospace,Consolas,monospace;text-transform:uppercase}.path{font:14px ui-monospace,Consolas,monospace}
.get{color:var(--get)}.post{color:var(--post)}.put{color:var(--put)}.patch{color:var(--patch)}.delete{color:var(--delete)}
table{border-collapse:collapse;width:100%;margin-top:8px;font-size:13px}td,th{border-top:1px solid var(--line);padding:4px 6px;text-align:left;vertical-align:top}th{color:var(--muted);font-weight:600}
code{font:13px ui-monospace,Consolas,monospace}.muted{color:var(--muted)}svg{max-width:100%;height:auto}`
const page = (title, lead, body) => `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${esc(title)}</title>\n<style>\n${STYLE}\n</style></head><body><main>\n<h1>${esc(title)}</h1><p class="lead">${lead}</p>\n${body}\n</main></body></html>\n`

const deref = (doc, n, seen = new Set()) => (n?.$ref?.startsWith?.('#/') && !seen.has(n.$ref) ? (seen.add(n.$ref), deref(doc, n.$ref.slice(2).split('/').reduce((o, k) => o?.[k], doc), seen)) : n)
function fieldRows(doc, schema, prefix = '', depth = 0, rows = []) {
  const s = deref(doc, schema)
  if (!s || typeof s !== 'object' || depth > 5) return rows
  for (const part of s.allOf ?? []) fieldRows(doc, part, prefix, depth + 1, rows)
  if (s.items) fieldRows(doc, s.items, `${prefix}[]`, depth + 1, rows)
  const req = new Set(s.required ?? [])
  for (const [k, v] of Object.entries(s.properties ?? {})) {
    const d = deref(doc, v)
    rows.push({ name: prefix ? `${prefix}.${k}` : k, type: d?.type ?? (d?.$ref ? d.$ref.split('/').pop() : ''), required: req.has(k), description: d?.description ?? '' })
    fieldRows(doc, v, prefix ? `${prefix}.${k}` : k, depth + 1, rows)
  }
  return rows
}
const table = (rows, cols) => (rows.length ? `<table><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((x) => `<td>${x}</td>`).join('')}</tr>`).join('')}</table>` : '')
const jsonSchema = (doc, c) => { const content = deref(doc, c)?.content ?? {}; return (content['application/json'] ?? Object.values(content)[0])?.schema }

/** The API reference page of one spec. */
export function apiPage(specText, file, { title } = {}) {
  const spec = readSpec(specText, file)
  if (!spec || !['openapi', 'asyncapi'].includes(spec.kind)) return null
  const doc = spec.doc
  const name = title ?? doc.info?.title ?? file
  if (spec.kind === 'asyncapi') {
    const ch = Object.entries(doc.channels ?? {}).map(([c, v]) => {
      const msgs = [v?.publish?.message, v?.subscribe?.message, ...Object.values(v?.messages ?? {})].map((m) => deref(doc, m)).filter(Boolean)
      return `<div class="op"><span class="m">${v?.publish ? 'publish' : 'subscribe'}</span> <span class="path">${esc(c)}</span>${v?.description ? `<p class="muted">${esc(v.description)}</p>` : ''}${msgs.map((m) => table(fieldRows(doc, m.payload).map((r) => [`<code>${esc(r.name)}</code>`, esc(r.type), r.required ? 'yes' : '', esc(r.description)]), ['Field', 'Type', 'Required', 'Description'])).join('')}</div>`
    }).join('\n')
    return page(name, `Events from <code>${esc(file)}</code>${doc.info?.version ? `, version ${esc(doc.info.version)}` : ''}.`, ch || '<p>No channels.</p>')
  }
  const ops = []
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const m of METHODS) {
      const op = item?.[m]
      if (!op) continue
      const params = [...(item.parameters ?? []), ...(op.parameters ?? [])].map((p) => deref(doc, p)).filter(Boolean)
      const ok = Object.entries(op.responses ?? {}).find(([code]) => /^2/.test(code))
      ops.push(`<div class="op" id="${esc(`${m}-${path}`)}"><span class="m ${m}">${m}</span> <span class="path">${esc(path)}</span>${op.summary ? ` <span class="muted">${esc(op.summary)}</span>` : ''}${op.description ? `<p class="muted">${esc(op.description)}</p>` : ''}
${table(params.map((p) => [`<code>${esc(p.name)}</code>`, esc(p.in), p.required ? 'yes' : '', esc(p.description ?? '')]), ['Parameter', 'In', 'Required', 'Description'])}
${op.requestBody ? `<p class="muted">Request body</p>${table(fieldRows(doc, jsonSchema(doc, op.requestBody)).map((r) => [`<code>${esc(r.name)}</code>`, esc(r.type), r.required ? 'yes' : '', esc(r.description)]), ['Field', 'Type', 'Required', 'Description'])}` : ''}
${ok ? `<p class="muted">Response ${esc(ok[0])}</p>${table(fieldRows(doc, jsonSchema(doc, ok[1])).map((r) => [`<code>${esc(r.name)}</code>`, esc(r.type), esc(r.description)]), ['Field', 'Type', 'Description'])}` : ''}</div>`)
    }
  }
  return page(name, `${ops.length} operation(s) from <code>${esc(file)}</code>${doc.info?.version ? `, version ${esc(doc.info.version)}` : ''}.`, ops.join('\n') || '<p>No operations.</p>')
}

/** The system map as an inline SVG: one column per kind, boxes colored by exposure, arrows for consumes. */
export function systemMapPage(system, { title = 'System map' } = {}) {
  const comps = Object.entries(system?.components ?? {})
  const order = ['external', 'app', 'service', 'worker', 'package']
  const cols = order.filter((k) => comps.some(([, c]) => c?.kind === k))
  const W = 190
  const H = 54
  const GX = 70
  const GY = 22
  const pos = {}
  cols.forEach((k, ci) => comps.filter(([, c]) => c?.kind === k).forEach(([id], ri) => { pos[id] = { x: 20 + ci * (W + GX), y: 40 + ri * (H + GY) } }))
  const width = 40 + cols.length * (W + GX) - GX
  const height = 60 + Math.max(1, ...cols.map((k) => comps.filter(([, c]) => c?.kind === k).length)) * (H + GY)
  const FILL = { public: '#fde2e1', internal: '#e0e7ff', private: '#dcfce7' }
  const edges = comps.flatMap(([id, c]) => (c?.consumes ?? []).filter((d) => pos[d]).map((d) => {
    const a = pos[id]
    const b = pos[d]
    const x1 = a.x + (b.x >= a.x ? W : 0)
    const x2 = b.x + (b.x >= a.x ? 0 : W)
    return `<path d="M${x1} ${a.y + H / 2} C${(x1 + x2) / 2} ${a.y + H / 2} ${(x1 + x2) / 2} ${b.y + H / 2} ${x2} ${b.y + H / 2}" fill="none" stroke="#8a93a6" stroke-width="1.5" marker-end="url(#arrow)"><title>${esc(id)} consumes ${esc(d)}</title></path>`
  }))
  const boxes = comps.filter(([id]) => pos[id]).map(([id, c]) => `<g><rect x="${pos[id].x}" y="${pos[id].y}" width="${W}" height="${H}" rx="9" fill="${FILL[c.exposure] ?? '#f1f3f6'}" stroke="#6b7385"/><text x="${pos[id].x + 12}" y="${pos[id].y + 22}" font-size="14" font-weight="600" fill="#161a22">${esc(id)}</text><text x="${pos[id].x + 12}" y="${pos[id].y + 40}" font-size="11" fill="#4b5363">${esc([c.kind, c.exposure, c.layer].filter(Boolean).join(' · '))}</text></g>`)
  const heads = cols.map((k, ci) => `<text x="${20 + ci * (W + GX)}" y="24" font-size="12" fill="#5b6475" font-weight="600">${esc(k)}</text>`)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="System map"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#8a93a6"/></marker></defs>${heads.join('')}${edges.join('')}${boxes.join('')}</svg>`
  const legend = '<p class="muted">Fill: red public · blue internal · green private · grey not stated. Arrows point from a component to what it consumes.</p>'
  const list = table(comps.map(([id, c]) => [`<code>${esc(id)}</code>`, esc(c?.kind), esc(c?.path ?? c?.repo ?? ''), esc(c?.exposure ?? ''), esc((c?.consumes ?? []).join(', '))]), ['Component', 'Kind', 'Where', 'Exposure', 'Consumes'])
  return page(title, `${comps.length} component(s) from <code>system.yaml</code>.`, `${svg}\n${legend}\n${list}`)
}

/** Every page the system map gives the site: { path, title, kind, source, html }. */
export function systemPages(cwd) {
  const system = readSystem(cwd)
  if (!system) return []
  const pages = [{ path: 'system-map/index.html', title: 'System map', kind: 'system-map', source: 'system.yaml', html: systemMapPage(system) }]
  for (const s of specFiles(system)) {
    let text = null
    try { text = readFileSync(join(cwd, s.spec), 'utf8') } catch { continue }
    const html = apiPage(text, s.spec, { title: `${s.component} API` })
    if (html) pages.push({ path: `api/${s.component}/index.html`, title: `${s.component} API`, kind: 'api', source: s.spec, html })
  }
  return pages
}

/** An OpenAPI skeleton from the routes the code declares for one component, for a spec that does not exist yet. */
export function draftSpec(cwd, component) {
  const inv = inventory(cwd)
  const routes = inv.endpoints.filter((e) => e.component === component)
  const paths = {}
  for (const r of routes) {
    const path = r.path.replace(/:([A-Za-z_]\w*)\??/g, '{$1}').replace(/<(?:\w+:)?(\w+)>/g, '{$1}').replace(/\[(\w+)\]/g, '{$1}')
    const params = [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }))
    for (const m of r.method === 'ANY' ? ['get'] : [r.method.toLowerCase()]) {
      paths[path] ??= {}
      paths[path][m] = { summary: `TODO: describe (from ${r.file}:${r.line})`, ...(params.length ? { parameters: params } : {}), responses: { 200: { description: 'TODO' } } }
    }
  }
  return { openapi: '3.1.0', info: { title: `${component} API`, version: '0.0.0' }, paths }
}

export { KINDS }
