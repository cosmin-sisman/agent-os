// Artifacts: pages kept in artifacts/<YYYY-MM-DD>-<slug>/ with an artifact.yaml (design §17). The schema and its
// validation, a scaffold per type (a self-contained index.html that loads nothing from outside), the listing with
// staleness from source hashes, and the git history of one artifact.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CliError } from '../cli/errors.mjs'
import { parse } from '../yaml/yaml.mjs'
import { LANGUAGES } from '../i18n/i18n.mjs'
import { closest } from '../util/closest.mjs'

export const DIR = 'artifacts'
export const TYPES = ['discovery', 'analysis', 'stack-map', 'comparison', 'decision-support', 'release-report', 'retro', 'architecture', 'dashboard']
export const KINDS = ['snapshot', 'living']
export const STATUSES = ['draft', 'current', 'stale', 'superseded']
export const KEYS = ['id', 'title', 'type', 'kind', 'status', 'summary', 'languages', 'authors', 'refs', 'build', 'sources']
const ID = /^(\d{4})-(\d{2})-(\d{2})-[a-z0-9]+(-[a-z0-9]+)*$/
const LIVING = new Set(['stack-map', 'dashboard'])

const oneOf = (what, v, list) => (list.includes(v) ? null : `${what} must be one of ${list.join(', ')}${typeof v === 'string' && closest(v, list) ? ` (did you mean "${closest(v, list)}"?)` : ''}, got ${JSON.stringify(v)}`)
const strings = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string')

/** The problems of one artifact.yaml; `folder` is the name of the folder that holds it. */
export function validateArtifact(meta, folder) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return ['artifact.yaml must be a map']
  const out = []
  for (const k of Object.keys(meta)) if (!KEYS.includes(k)) out.push(`unknown key "${k}"${closest(k, KEYS) ? ` (did you mean "${closest(k, KEYS)}"?)` : ''}`)
  if (meta.id !== folder) out.push(`id "${meta.id}" must equal the folder name "${folder}"`)
  const m = typeof meta.id === 'string' && meta.id.match(ID)
  if (!m) out.push(`id "${meta.id}" must be <YYYY-MM-DD>-<slug> (lowercase, hyphens)`)
  else if (Number.isNaN(Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`)) || new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`).toISOString().slice(0, 10) !== `${m[1]}-${m[2]}-${m[3]}`) out.push(`id "${meta.id}" starts with an invalid date`)
  for (const k of ['title', 'summary']) if (typeof meta[k] !== 'string' || !meta[k].trim()) out.push(`${k} is required`)
  for (const [k, list] of [['type', TYPES], ['kind', KINDS], ['status', STATUSES]]) { const p = oneOf(k, meta[k], list); if (p) out.push(p) }
  if (meta.languages !== undefined && !(strings(meta.languages) && meta.languages.every((l) => LANGUAGES.includes(l)))) out.push(`languages must be a list of ${LANGUAGES.join(', ')}`)
  for (const k of ['authors', 'refs']) if (meta[k] !== undefined && !strings(meta[k])) out.push(`${k} must be a list of strings`)
  if (meta.build !== undefined && typeof meta.build !== 'string') out.push('build must be a string')
  if (meta.sources !== undefined) {
    if (!Array.isArray(meta.sources)) out.push('sources must be a list')
    else meta.sources.forEach((s, i) => {
      if (!s || typeof s.path !== 'string') out.push(`sources[${i}] needs a path`)
      if (!s || !/^[0-9a-f]{64}$/.test(s.sha256 ?? '')) out.push(`sources[${i}] needs a sha256 (64 hex characters)`)
    })
  }
  return out
}

/** Source paths whose sha256 no longer matches (or that are gone). */
export function staleSources(root, sources = []) {
  return sources.filter((s) => {
    const f = join(root, s.path ?? '')
    return !s.path || !existsSync(f) || createHash('sha256').update(readFileSync(f)).digest('hex') !== s.sha256
  }).map((s) => s.path)
}

/** Every artifact, newest first: its metadata, its problems and its stale sources. */
export function listArtifacts(root) {
  const dir = join(root, DIR)
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => statSync(join(dir, f)).isDirectory()).sort().reverse().map((folder) => {
    const file = join(dir, folder, 'artifact.yaml')
    if (!existsSync(file)) return { folder, id: folder, problems: ['no artifact.yaml'], stale: [] }
    let meta
    try { meta = parse(readFileSync(file, 'utf8'), { file: `${DIR}/${folder}/artifact.yaml` }) } catch (err) { return { folder, id: folder, problems: [err.message], stale: [] } }
    return { ...meta, folder, problems: validateArtifact(meta, folder), stale: Array.isArray(meta?.sources) ? staleSources(root, meta.sources) : [] }
  })
}

const SECTIONS = {
  discovery: ['What we looked at', 'What we found', 'Risks', 'Next steps'],
  analysis: ['Question', 'Options', 'Findings', 'Recommendation'],
  'stack-map': ['Layers', 'Summary'],
  comparison: ['Options', 'Criteria', 'Comparison', 'Verdict'],
  'decision-support': ['Decision to make', 'Options', 'Trade-offs', 'Recommendation'],
  'release-report': ['What shipped', 'Fixes', 'Breaking changes', 'Numbers'],
  retro: ['What went well', 'What did not', 'Lessons', 'Actions'],
  architecture: ['Context', 'Components', 'Data flows', 'Decisions'],
  dashboard: ['Overview', 'Metrics', 'Notes'],
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

/** A self-contained page for a type: inline CSS, light and dark, no scripts or requests to anywhere else. */
export function scaffoldPage({ title, type }) {
  const sections = (SECTIONS[type] ?? ['Overview']).map((h) => `  <section>\n    <h2>${esc(h)}</h2>\n    <p class="todo">To write.</p>\n  </section>`).join('\n')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{--bg:#f6f7f9;--surface:#fff;--fg:#161a22;--muted:#5b6475;--line:#d9dde5;--accent:#3b5bdb}
@media (prefers-color-scheme:dark){:root{--bg:#0f1218;--surface:#171b23;--fg:#e6e9ef;--muted:#9aa3b5;--line:#2a303c;--accent:#8ea2ff;color-scheme:dark}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:880px;margin:0 auto;padding:32px 16px}
.kicker{color:var(--accent);font-weight:600;text-transform:uppercase;letter-spacing:.06em;font-size:.8rem}
h1{margin:.2em 0 .6em;font-size:1.9rem}
section{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin:12px 0}
h2{margin:0 0 .4em;font-size:1.15rem}.todo{color:var(--muted)}
</style>
</head>
<body>
<main>
  <div class="kicker">${esc(type)}</div>
  <h1>${esc(title)}</h1>
${sections}
</main>
</body>
</html>
`
}

const q = (s) => JSON.stringify(String(s))
const list = (xs) => `[${xs.map(q).join(', ')}]`

/** Creates artifacts/<date>-<slug>/ with artifact.yaml (status draft) and the type's page. */
export function newArtifact(root, { type, slug, title, kind, authors = [], refs = [], now = new Date(), dryRun = false }) {
  const t = oneOf('the type', type, TYPES)
  if (t) throw new CliError(t)
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug ?? '')) throw new CliError(`the slug must be lowercase words joined by hyphens, got "${slug ?? ''}"`, { hint: 'agent-os artifact new analysis auth-options' })
  const k = kind ?? (LIVING.has(type) ? 'living' : 'snapshot')
  const kp = oneOf('--kind', k, KINDS)
  if (kp) throw new CliError(kp)
  const id = `${now.toISOString().slice(0, 10)}-${slug}`
  const folder = `${DIR}/${id}`
  if (existsSync(join(root, folder))) throw new CliError(`${folder} already exists`)
  const name = title ?? slug.split('-').map((w, i) => (i ? w : w[0].toUpperCase() + w.slice(1))).join(' ')
  const yaml = [
    '# Artifact metadata. Read by `agent-os artifact` and by the Pages build.',
    `id: ${id}`, `title: ${q(name)}`, `type: ${type}`, `kind: ${k}`, 'status: draft',
    `summary: ${q(`What this ${type} shows, in one sentence.`)}`,
    'languages: [en]', `authors: ${list(authors)}`, `refs: ${list(refs)}`, 'sources: []', '',
  ].join('\n')
  const files = { [`${folder}/artifact.yaml`]: yaml, [`${folder}/index.html`]: scaffoldPage({ title: name, type }) }
  if (!dryRun) {
    mkdirSync(join(root, folder), { recursive: true })
    for (const [p, c] of Object.entries(files)) writeFileSync(join(root, p), c)
  }
  return { id, folder, type, kind: k, files: Object.keys(files), dryRun }
}

/** The git history of one artifact folder, newest first. */
export function artifactLog(git, id) {
  const r = git(['log', '--date=short', '--format=%h%x09%ad%x09%an%x09%s', '--', `${DIR}/${id}`])
  if (r.status !== 0) throw new CliError(`git log failed: ${(r.stderr ?? '').trim()}`)
  return r.stdout.split(/\r?\n/).filter(Boolean).map((l) => { const [commit, date, author, ...s] = l.split('\t'); return { commit, date, author, subject: s.join('\t') } })
}
