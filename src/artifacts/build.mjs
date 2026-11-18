// Building and verifying artifacts: a page made from a template.html with a __DATA__ placeholder gets the parsed
// YAML and JSON sources embedded (safe inside a <script>), and its sources' hashes recorded in artifact.yaml. verify
// marks an artifact stale when a source changed since; living artifacts are rebuilt (in CI too), snapshots are not.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { CliError } from '../cli/errors.mjs'
import { parse } from '../yaml/yaml.mjs'
import { DIR, listArtifacts } from './artifact.mjs'

const sha = (buf) => createHash('sha256').update(buf).digest('hex')
const PLACEHOLDER = '__DATA__'

/** JSON safe to embed in an HTML script element: ASCII only, and no "</" that could close it. */
export const embedJson = (data) => JSON.stringify(data).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`).replace(/<\//g, '<\\/')

/** A page from a template: a full document stays as it is, a fragment gets the document skeleton. */
export function pageFrom(template, data) {
  const filled = template.replace(PLACEHOLDER, () => embedJson(data))
  if (/^\s*<!doctype html/i.test(filled)) return filled
  const end = filled.indexOf('</style>') + '</style>'.length
  const head = end > 7 ? filled.slice(0, end) : ''
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${head}\n</head>\n<body>\n${end > 7 ? filled.slice(end) : filled}\n</body>\n</html>\n`
}

/** Replaces the `sources:` block of artifact.yaml text with fresh hashes, keeping everything else. */
export function withSources(text, sources) {
  const block = ['sources:', ...sources.map((s) => `  - path: ${s.path}\n    sha256: ${s.sha256}`)].join('\n')
  const lines = text.split('\n')
  const at = lines.findIndex((l) => /^sources:/.test(l))
  if (at < 0) return `${text.replace(/\s*$/, '')}\n${block}\n`
  let end = at + 1
  while (end < lines.length && (/^\s+/.test(lines[end]) || lines[end] === '')) end++
  const tail = lines.slice(end).join('\n')
  return `${lines.slice(0, at).join('\n')}\n${block}\n${tail ? `${tail.replace(/^\n+/, '')}` : ''}`.replace(/\n{3,}/g, '\n\n')
}

const setStatus = (text, status) => (/^status:/m.test(text) ? text.replace(/^status:.*$/m, `status: ${status}`) : text)

/**
 * Builds one artifact. Its data is every YAML or JSON source, parsed, keyed by file name without extension; the
 * template itself is a source too, so changing it makes the page stale.
 */
export function buildArtifact(root, id, { dryRun = false } = {}) {
  const a = listArtifacts(root).find((x) => x.folder === id)
  if (!a) throw new CliError(`no artifact "${id}"`, { hint: 'agent-os artifact list' })
  if (a.problems.length) throw new CliError(`${DIR}/${id}/artifact.yaml has problems: ${a.problems.join('; ')}`, { hint: 'agent-os artifact check' })
  const folder = `${DIR}/${id}`
  const templatePath = `${folder}/template.html`
  if (!existsSync(join(root, templatePath))) throw new CliError(`${id} has no template.html: its page is written by hand`, { hint: 'edit index.html, then record its sources; build is for pages made from a template' })
  const template = readFileSync(join(root, templatePath), 'utf8')
  if (!template.includes(PLACEHOLDER)) throw new CliError(`${templatePath} has no ${PLACEHOLDER} placeholder for the data`)
  const paths = [...new Set([...(a.sources ?? []).map((s) => s.path), templatePath])]
  for (const p of paths) if (!existsSync(join(root, p))) throw new CliError(`source ${p} does not exist`)
  const data = {}
  for (const p of paths.filter((x) => /\.(ya?ml|json)$/.test(x))) {
    const text = readFileSync(join(root, p), 'utf8')
    data[basename(p).replace(/\.(ya?ml|json)$/, '')] = p.endsWith('.json') ? JSON.parse(text) : parse(text, { file: p })
  }
  const page = pageFrom(template, data)
  const sources = paths.map((p) => ({ path: p, sha256: sha(readFileSync(join(root, p))) }))
  const metaFile = join(root, folder, 'artifact.yaml')
  const meta = setStatus(withSources(readFileSync(metaFile, 'utf8'), sources), a.status === 'draft' ? 'draft' : 'current')
  const before = existsSync(join(root, folder, 'index.html')) ? readFileSync(join(root, folder, 'index.html'), 'utf8') : null
  if (!dryRun) { writeFileSync(join(root, folder, 'index.html'), page); writeFileSync(metaFile, meta) }
  return { id, dryRun, bytes: Buffer.byteLength(page), changed: before !== page, sources, kind: a.kind }
}

/** Every artifact with what is stale; `ok` is false only when something is stale. */
export function verifyArtifacts(root, { id } = {}) {
  const all = listArtifacts(root).filter((a) => !id || a.folder === id)
  if (id && !all.length) throw new CliError(`no artifact "${id}"`, { hint: 'agent-os artifact list' })
  const rows = all.map((a) => ({ id: a.folder, kind: a.kind ?? null, status: a.status ?? null, stale: a.stale, problems: a.problems, buildable: existsSync(join(root, DIR, a.folder, 'template.html')) }))
  return { artifacts: rows, stale: rows.filter((r) => r.stale.length), ok: rows.every((r) => !r.stale.length) }
}
