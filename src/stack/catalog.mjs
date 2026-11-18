// The stack catalog: the files shipped in catalog/, merged with the project's overlays in .agent-os/catalog/, and
// validated: unique ids, references that resolve, every localized text in both languages, ro text ASCII only.
// Problems name the file and the id, so a broken entry is found at once (in CI through the catalog test).

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '../yaml/yaml.mjs'
import { LANGUAGES, findDiacritics } from '../i18n/i18n.mjs'

export const CATALOG = fileURLToPath(new URL('../../catalog/', import.meta.url))
export const OVERLAY_DIR = '.agent-os/catalog'
export const KINDS = ['layers', 'technologies', 'languages', 'providers', 'runtimes', 'blueprints']

const readList = (path, label) => {
  const v = parse(readFileSync(path, 'utf8'), { file: label }) ?? []
  if (!Array.isArray(v)) throw new Error(`${label} must be a list of entries`)
  return v
}

/** The raw files: { kind: { file, entries } } for the shipped catalog, and the same for the overlays present. */
export function catalogFiles({ cwd = null, catalogDir = CATALOG } = {}) {
  const base = Object.fromEntries(KINDS.map((k) => [k, { file: `catalog/${k}.yaml`, entries: readList(join(catalogDir, `${k}.yaml`), `catalog/${k}.yaml`) }]))
  const overlays = {}
  if (cwd) for (const k of KINDS) {
    const p = join(cwd, OVERLAY_DIR, `${k}.yaml`)
    if (existsSync(p)) overlays[k] = { file: `${OVERLAY_DIR}/${k}.yaml`, entries: readList(p, `${OVERLAY_DIR}/${k}.yaml`) }
  }
  return { base, overlays }
}

/**
 * Merges overlays into the catalog: an overlay entry with a new id is added; one with an existing id replaces the
 * fields it sets (a project adjusting a provider's cost, say). Each entry remembers the file it came from.
 */
export function mergeCatalog({ base, overlays }) {
  const out = {}
  for (const k of KINDS) {
    const m = new Map()
    for (const e of base[k]?.entries ?? []) if (e?.id) m.set(e.id, { ...e, _file: base[k].file })
    for (const e of overlays[k]?.entries ?? []) if (e?.id) m.set(e.id, { ...(m.get(e.id) ?? {}), ...e, _file: overlays[k].file })
    out[k] = m
  }
  return out
}

/** The catalog indexed by id, with the project's overlays when a cwd is given. */
export const loadCatalog = (opts = {}) => mergeCatalog(catalogFiles(opts))

const localized = (v) => v && typeof v === 'object' && !Array.isArray(v) && LANGUAGES.some((l) => l in v)

function textProblems(entry, at) {
  const out = []
  const walk = (v, path) => {
    if (localized(v)) {
      for (const l of LANGUAGES) if (typeof v[l] !== 'string' || !v[l].trim()) out.push(`${path}: missing its ${l} text`)
      if (typeof v.ro === 'string') {
        const bad = [...new Set([...findDiacritics(v.ro).map((d) => d.char), ...(v.ro.match(/[^\x00-\x7f]/g) ?? [])])]
        if (bad.length) out.push(`${path}.ro: non-ASCII ${bad.join('')}; ro text is ASCII only`)
      }
      return
    }
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`))
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`)
  }
  for (const [k, v] of Object.entries(entry)) if (k !== '_file') walk(v, `${at}.${k}`)
  return out
}

/**
 * Every problem in the catalog with its overlays: { file, id, message }. References are checked against the merged
 * catalog, so an overlay can add a technology that uses an overlay provider.
 */
export function validateCatalog(files) {
  const problems = []
  const add = (file, id, message) => problems.push({ file, id, message })
  for (const src of [files.base, files.overlays]) {
    for (const k of KINDS) {
      const f = src[k]
      if (!f) continue
      const seen = new Set()
      f.entries.forEach((e, i) => {
        if (!e || typeof e !== 'object' || Array.isArray(e)) return add(f.file, `#${i + 1}`, 'is not a map')
        if (typeof e.id !== 'string' || !/^[a-z0-9][a-z0-9.+-]*$/.test(e.id)) return add(f.file, `#${i + 1}`, `has no valid id (${JSON.stringify(e.id)})`)
        if (seen.has(e.id)) add(f.file, e.id, 'is listed twice')
        seen.add(e.id)
        for (const t of textProblems(e, e.id)) add(f.file, e.id, t)
      })
    }
  }
  const cat = mergeCatalog(files)
  const ref = (e, kind, id, what) => {
    if (id === undefined || id === null) return
    if (kind === 'languages' && id === 'none') return
    if (!cat[kind].has(id)) add(e._file, e.id, `${what} "${id}" is not in ${kind}.yaml`)
  }
  for (const t of cat.technologies.values()) {
    if (t.layer === undefined) add(t._file, t.id, 'has no layer')
    ref(t, 'layers', t.layer, 'layer')
    ref(t, 'languages', t.language, 'language')
    ref(t, 'providers', t.provider, 'provider')
  }
  for (const b of cat.blueprints.values()) {
    for (const [i, row] of (b.layers ?? []).entries()) {
      const e = { ...b, id: `${b.id} layers[${i}]` }
      if (!row?.layer) { add(b._file, e.id, 'has no layer'); continue }
      ref(e, 'layers', row.layer, 'layer')
      ref(e, 'technologies', row.tech, 'tech')
      ref(e, 'languages', row.language, 'language')
      ref(e, 'providers', row.provider, 'provider')
    }
  }
  return problems
}

export const problemText = (p) => `${p.file}: ${p.id}: ${p.message}`
