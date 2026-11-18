// `stack import`: a stack builder sheet (csv, or xlsx read by xlsx.mjs) into stack.yaml. It finds the header row
// (Layer/Strat, Technology/Tehnologie, Provider/Furnizor, Status, Notes/Note, in en or ro), maps names to catalog ids
// whatever their case or diacritics, and turns what the catalog lacks into overlay suggestions for .agent-os/catalog/.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import { CliError } from '../cli/errors.mjs'
import { toAscii } from '../i18n/i18n.mjs'
import { parse } from '../yaml/yaml.mjs'
import { readXlsx } from './xlsx.mjs'
import { OVERLAY_DIR, loadCatalog } from './catalog.mjs'

const norm = (s) => toAscii(String(s ?? '')).toLowerCase().replace(/[^a-z0-9]+/g, '')
const slug = (s) => toAscii(String(s)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)

/** Parses CSV (comma or semicolon, quoted fields with "" escapes, CRLF or LF). */
export function parseCsv(text) {
  const src = text.replace(/^﻿/, '')
  const first = src.split(/\r?\n/, 1)[0] ?? ''
  const sep = (first.match(/;/g) ?? []).length > (first.match(/,/g) ?? []).length ? ';' : ','
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++ } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"' && cell === '') quoted = true
    else if (c === sep) { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && src[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = '' }
    else cell += c
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows
}

const HEADERS = {
  layer: ['layer', 'strat'],
  tech: ['technology', 'tech', 'tehnologie'],
  providerChosen: ['providerchosen', 'chosenprovider', 'furnizorales', 'furnizorfinal'],
  provider: ['provider', 'furnizor', 'furnizorrecomandat', 'recommendedprovider'],
  status: ['status', 'stare'],
  note: ['notes', 'note', 'notite'],
}
const STATUS = { ales: 'chosen', chosen: 'chosen', da: 'chosen', yes: 'chosen', deevaluat: 'evaluating', evaluating: 'evaluating', evaluare: 'evaluating', optional: 'optional', respins: 'rejected', rejected: 'rejected', nu: 'rejected', no: 'rejected' }
const EMPTY = new Set(['', '—', '-', '–', 'n/a', 'na'])

/** The header row of a sheet and the column of each field, or null. */
function header(rows) {
  for (let r = 0; r < Math.min(rows.length, 50); r++) {
    const cols = {}
    rows[r].forEach((cell, i) => {
      const h = norm(String(cell).replace(/[▼▾⌄]/g, ''))
      for (const [field, names] of Object.entries(HEADERS)) if (cols[field] === undefined && names.includes(h)) cols[field] = i
    })
    if (cols.layer !== undefined && cols.tech !== undefined) return { row: r, cols }
  }
  return null
}

/** A labelled value above the table ("Project name | x", "Nivel | Nivel 3"). */
const labelled = (rows, until, labels) => {
  for (const r of rows.slice(0, until)) {
    const i = r.findIndex((c) => labels.includes(norm(c)))
    if (i >= 0) { const v = r.slice(i + 1).find((x) => String(x).trim()); if (v) return String(v).trim() }
  }
  return null
}

/** The rows of a file: every sheet of an xlsx, or the one table of a csv. */
export function readSheets(file) {
  const buf = readFileSync(file)
  if (/\.xlsx$/i.test(file)) return readXlsx(buf)
  if (/\.(csv|txt)$/i.test(file)) return [{ name: 'csv', rows: parseCsv(buf.toString('utf8')) }]
  throw new CliError(`${extname(file) || file} is not a csv or xlsx file`)
}

/**
 * The stack in a builder sheet: { project, level, layers: [{ layer, tech, provider, status, note, known }],
 * suggestions: overlay entries for what the catalog lacks, problems }. The first sheet with a layer and a
 * technology column is used, unless `sheet` names one.
 */
export function importSheet(sheets, { catalog, sheet } = {}) {
  const candidates = sheet ? sheets.filter((s) => s.name === sheet) : sheets
  if (sheet && !candidates.length) throw new CliError(`no sheet "${sheet}"`, { hint: `sheets: ${sheets.map((s) => s.name).join(', ')}` })
  const found = candidates.map((s) => ({ s, h: header(s.rows) })).find((x) => x.h)
  if (!found) throw new CliError('no sheet has a layer and a technology column', { hint: 'the header row needs Layer (or Strat) and Technology (or Tehnologie); --sheet <name> picks the sheet' })
  const { s, h } = found
  const byName = (map, value) => {
    const n = norm(value)
    for (const e of map.values()) if (norm(e.id) === n || norm(e.name?.en ?? e.name) === n || norm(e.name?.ro) === n) return e
    return null
  }
  const cell = (r, f) => (h.cols[f] === undefined ? '' : String(r[h.cols[f]] ?? '').trim())
  const layers = []
  const suggestions = { layers: [], technologies: [] }
  const problems = []
  for (const r of s.rows.slice(h.row + 1)) {
    const layerName = cell(r, 'layer')
    if (EMPTY.has(layerName.toLowerCase())) continue
    const techName = cell(r, 'tech')
    let layer = byName(catalog.layers, layerName)
    // A row with no technology and no status is a layer only if the catalog knows it (footnotes under the table).
    if (!layer && EMPTY.has(techName.toLowerCase()) && !cell(r, 'status')) continue
    if (!layer) {
      const id = slug(layerName)
      if (!suggestions.layers.some((x) => x.id === id)) suggestions.layers.push({ id, group: 'logic', name: { en: layerName, ro: toAscii(layerName) }, description: { en: `${layerName} (imported)`, ro: `${toAscii(layerName)} (importat)` } })
      layer = { id }
    }
    if (layers.some((x) => x.layer === layer.id)) { problems.push(`${layerName} appears twice; the first row is kept`); continue }
    let tech = null
    let known = true
    if (!EMPTY.has(techName.toLowerCase())) {
      const t = byName(catalog.technologies, techName)
      if (t) tech = t.id
      else {
        tech = slug(techName)
        known = false
        if (!suggestions.technologies.some((x) => x.id === tech)) suggestions.technologies.push({ id: tech, name: techName, layer: layer.id, note: { en: 'Imported from a stack builder sheet; add its language, provider and scores', ro: 'Importat dintr-o foaie de stack; completeaza limbajul, furnizorul si scorurile' } })
      }
    }
    const providerName = cell(r, 'providerChosen') || cell(r, 'provider')
    const provider = EMPTY.has(providerName.toLowerCase()) ? null : byName(catalog.providers, providerName)?.id ?? null
    if (providerName && !EMPTY.has(providerName.toLowerCase()) && !provider) problems.push(`provider "${providerName}" (${layerName}) is not in the catalog; left out`)
    const statusRaw = cell(r, 'status')
    const status = STATUS[norm(statusRaw)] ?? (statusRaw ? null : 'chosen')
    if (status === null) problems.push(`status "${statusRaw}" (${layerName}) is not chosen, evaluating, optional or rejected; chosen is used`)
    const techProvider = tech && catalog.technologies.get(tech)?.provider
    layers.push({ layer: layer.id, tech, provider: provider && provider !== techProvider ? provider : null, status: status ?? 'chosen', note: cell(r, 'note') || null, known })
  }
  const levelText = labelled(s.rows, h.row, ['nivel', 'level'])
  const level = Number(levelText?.match(/\d/)?.[0]) || null
  return { sheet: s.name, project: labelled(s.rows, h.row, ['numeproiect', 'projectname', 'project', 'proiect']), level: level && level >= 1 && level <= 5 ? level : null, layers, suggestions, problems }
}

const q = (v) => JSON.stringify(String(v))

/** stack.yaml text for an import. */
export function stackFromImport(r, { source }) {
  const lines = [`# stack.yaml, imported from ${source} (sheet ${r.sheet}) by agent-os stack import. Add each layer's paths.`, '']
  if (r.project) lines.push(`project: ${q(r.project)}`)
  if (r.level) lines.push(`level: ${r.level}`)
  if (r.project || r.level) lines.push('')
  lines.push('layers:')
  for (const l of r.layers) {
    lines.push(`  ${l.layer}:`)
    if (l.tech) lines.push(`    tech: ${l.tech}`)
    if (l.provider) lines.push(`    provider: ${l.provider}`)
    lines.push(`    status: ${l.status}`, '    paths: []')
    if (l.note || !l.known) lines.push(`    note: ${q([l.note, l.known ? null : 'not in the catalog yet: see the overlay suggestion'].filter(Boolean).join('; '))}`)
  }
  return `${lines.join('\n')}\n`
}

/** Adds the suggestions to the project overlays (.agent-os/catalog/<kind>.yaml), never replacing an id. */
export function writeOverlay(cwd, suggestions) {
  const written = []
  for (const kind of ['layers', 'technologies']) {
    const entries = suggestions[kind] ?? []
    if (!entries.length) continue
    const file = join(cwd, OVERLAY_DIR, `${kind}.yaml`)
    const text = existsSync(file) ? readFileSync(file, 'utf8') : `# Project additions to catalog/${kind}.yaml (agent-os stack catalog check validates them).\n`
    const have = new Set((parse(text, { file: `${OVERLAY_DIR}/${kind}.yaml` }) ?? []).map((e) => e.id))
    const add = entries.filter((e) => !have.has(e.id))
    if (!add.length) continue
    const yaml = add.map((e) => ['', `- id: ${e.id}`, ...Object.entries(e).filter(([k]) => k !== 'id').map(([k, v]) => (typeof v === 'object' ? `  ${k}: { en: ${q(v.en)}, ro: ${q(v.ro)} }` : `  ${k}: ${q(v)}`))].join('\n')).join('\n')
    mkdirSync(join(cwd, OVERLAY_DIR), { recursive: true })
    writeFileSync(file, `${text.replace(/\s*$/, '')}\n${yaml}\n`)
    written.push(...add.map((e) => `${kind}:${e.id}`))
  }
  return written
}

export { loadCatalog }
