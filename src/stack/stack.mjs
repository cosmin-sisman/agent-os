// The project's stack map (stack.yaml) read against the catalog: for each layer, its technology, language, paths and
// how well agents know it. Used to pick the language rules and scope them to the layer paths. Design §16, §22.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '../yaml/yaml.mjs'
import { closest } from '../util/closest.mjs'

export const CATALOG = fileURLToPath(new URL('../../catalog/', import.meta.url))
const cache = new Map()
const catalogList = (name, dir = CATALOG) => {
  const key = `${dir}${name}`
  if (!cache.has(key)) cache.set(key, parse(readFileSync(join(dir, `${name}.yaml`), 'utf8'), { file: `catalog/${name}.yaml` }) ?? [])
  return cache.get(key)
}

/** The layers of stack.yaml that are in use (chosen), with their technology, language, paths and aiFriendly. */
export function stackLayers(cwd, { catalogDir = CATALOG } = {}) {
  const file = join(cwd, 'stack.yaml')
  if (!existsSync(file)) return []
  const stack = parse(readFileSync(file, 'utf8'), { file: 'stack.yaml' }) ?? {}
  const tech = new Map(catalogList('technologies', catalogDir).map((t) => [t.id, t]))
  const langs = new Map(catalogList('languages', catalogDir).map((l) => [l.id, l]))
  return Object.entries(stack.layers ?? {}).filter(([, l]) => (l.status ?? 'chosen') === 'chosen').map(([id, l]) => {
    const t = tech.get(l.tech) ?? null
    const language = l.language ?? t?.language ?? null
    return { id, tech: l.tech ?? null, techName: t?.name ?? l.tech ?? null, language, paths: l.paths ?? [], aiFriendly: Math.min(t?.aiFriendly ?? 5, langs.get(language)?.aiFriendly ?? 5) }
  })
}

/** Languages in use with the paths they cover and the technologies agents know poorly (aiFriendly ≤ 2). */
export function languagesInUse(layers) {
  const out = new Map()
  for (const l of layers) {
    if (!l.language || l.language === 'none') continue
    const e = out.get(l.language) ?? { language: l.language, paths: [], lowAi: [] }
    for (const p of l.paths) if (!e.paths.includes(p)) e.paths.push(p)
    if (l.aiFriendly <= 2 && l.techName && !e.lowAi.includes(l.techName)) e.lowAi.push(l.techName)
    out.set(l.language, e)
  }
  return [...out.values()].sort((a, b) => a.language.localeCompare(b.language))
}

// ---- Validation, the show summary and new --from (#74) ----

export const STATUSES = ['chosen', 'evaluating', 'optional', 'rejected']
const TOP_KEYS = ['project', 'level', 'blueprint', 'compliance', 'layers']
const LAYER_KEYS = ['tech', 'provider', 'language', 'runtime', 'status', 'paths', 'owners', 'note']

/** The whole catalog, indexed by id. */
export function loadCatalog(catalogDir = CATALOG) {
  const index = (name) => new Map(catalogList(name, catalogDir).map((x) => [x.id, x]))
  return { layers: index('layers'), technologies: index('technologies'), languages: index('languages'), providers: index('providers'), runtimes: index('runtimes'), blueprints: index('blueprints') }
}

/** Reads stack.yaml, or null when there is none. */
export function readStack(cwd) {
  const file = join(cwd, 'stack.yaml')
  return existsSync(file) ? (parse(readFileSync(file, 'utf8'), { file: 'stack.yaml' }) ?? {}) : null
}

const unknown = (what, id, ids) => {
  const near = closest(String(id), [...ids])
  return `unknown ${what} "${id}"${near ? ` (did you mean "${near}"?)` : ''}`
}

/** Problems (errors) and warnings of a stack against the catalog; unknown ids name the closest match. */
export function validateStack(stack, catalog) {
  const problems = []
  const warnings = []
  if (!stack || typeof stack !== 'object' || Array.isArray(stack)) return { problems: ['stack.yaml must be a map'], warnings }
  for (const k of Object.keys(stack)) if (!TOP_KEYS.includes(k)) problems.push(unknown('key', k, TOP_KEYS))
  if (stack.level !== undefined && !(Number.isInteger(stack.level) && stack.level >= 1 && stack.level <= 5)) problems.push(`level must be 1 to 5, got ${JSON.stringify(stack.level)}`)
  if (stack.blueprint !== undefined && !catalog.blueprints.has(stack.blueprint)) problems.push(unknown('blueprint', stack.blueprint, catalog.blueprints.keys()))
  if (stack.compliance !== undefined) {
    for (const [k, v] of Object.entries(stack.compliance ?? {})) {
      if (k !== 'euOnly') problems.push(`compliance: ${unknown('key', k, ['euOnly'])}`)
      else if (typeof v !== 'boolean') problems.push('compliance.euOnly must be true or false')
    }
  }
  const layers = stack.layers ?? {}
  if (typeof layers !== 'object' || Array.isArray(layers)) return { problems: [...problems, 'layers must be a map of layer ids'], warnings }
  for (const [id, l] of Object.entries(layers)) {
    const at = `layers.${id}`
    if (!catalog.layers.has(id)) problems.push(`${at}: ${unknown('layer', id, catalog.layers.keys())}`)
    if (!l || typeof l !== 'object' || Array.isArray(l)) { problems.push(`${at} must be a map`); continue }
    for (const k of Object.keys(l)) if (!LAYER_KEYS.includes(k)) problems.push(`${at}: ${unknown('key', k, LAYER_KEYS)}`)
    const t = l.tech === undefined ? null : catalog.technologies.get(l.tech)
    if (l.tech !== undefined && !t) problems.push(`${at}.tech: ${unknown('technology', l.tech, catalog.technologies.keys())}`)
    if (t && t.layer && t.layer !== id && catalog.layers.has(id)) warnings.push(`${at}.tech: ${t.name} is listed for the ${t.layer} layer`)
    if (l.provider !== undefined && !catalog.providers.has(l.provider)) problems.push(`${at}.provider: ${unknown('provider', l.provider, catalog.providers.keys())}`)
    if (l.language !== undefined && l.language !== 'none' && !catalog.languages.has(l.language)) problems.push(`${at}.language: ${unknown('language', l.language, catalog.languages.keys())}`)
    if (l.status !== undefined && !STATUSES.includes(l.status)) problems.push(`${at}.status: must be ${STATUSES.join(', ')}, got "${l.status}"`)
    for (const k of ['paths', 'owners']) if (l[k] !== undefined && !(Array.isArray(l[k]) && l[k].every((p) => typeof p === 'string'))) problems.push(`${at}.${k} must be a list of strings`)
    if (l.tech === undefined && l.language === undefined && l.provider === undefined) warnings.push(`${at}: no tech, language or provider`)
  }
  return { problems, warnings }
}

const avg = (xs) => { const n = xs.filter((x) => typeof x === 'number'); return n.length ? Math.round((n.reduce((a, b) => a + b, 0) / n.length) * 10) / 10 : null }

/** The table rows and the summary of `stack show`. The summary counts the layers in use (status chosen). */
export function stackSummary(stack, catalog) {
  const rows = Object.entries(stack?.layers ?? {}).map(([id, l]) => {
    const t = catalog.technologies.get(l.tech) ?? null
    const provider = l.provider ?? t?.provider ?? null
    const language = l.language ?? t?.language ?? null
    return { layer: id, tech: l.tech ?? null, techName: t?.name ?? l.tech ?? null, language, provider, status: l.status ?? 'chosen', paths: l.paths ?? [], note: l.note ?? null, complexity: t?.complexity ?? null, aiFriendly: t?.aiFriendly ?? null }
  })
  const used = rows.filter((r) => r.status === 'chosen')
  const languages = [...new Set(used.map((r) => r.language).filter((x) => x && x !== 'none'))].sort()
  const providers = [...new Set(used.map((r) => r.provider).filter(Boolean))].sort()
  const steepest = languages.map((id) => catalog.languages.get(id)).filter(Boolean).sort((a, b) => (b.learningCurve ?? 0) - (a.learningCurve ?? 0))[0] ?? null
  const euOnly = stack?.compliance?.euOnly === true
  // Every layer that might go live is checked, not only the chosen ones: an evaluated provider needs the decision too.
  const eu = rows.filter((r) => r.status !== 'rejected' && r.provider).map((r) => ({ layer: r.layer, provider: r.provider, euRegions: catalog.providers.get(r.provider)?.euRegions ?? 'unknown' }))
  const flagged = euOnly ? eu.filter((e) => e.euRegions === 'verify' || e.euRegions === 'unknown') : []
  return {
    rows,
    summary: {
      layers: used.length,
      languages,
      providers,
      averageComplexity: avg(used.map((r) => r.complexity)),
      averageAiFriendly: avg(used.map((r) => r.aiFriendly)),
      averageProviderCost: avg(providers.map((p) => catalog.providers.get(p)?.cost)),
      steepestLearningCurve: steepest ? { language: steepest.id, learningCurve: steepest.learningCurve } : null,
      eu: { euOnly, flagged },
    },
  }
}

const q = (s) => JSON.stringify(String(s))

/** stack.yaml text for a blueprint: one layer per row, status chosen (or as decided per layer). */
export function stackFromBlueprint(blueprint, { project, statuses = {} } = {}) {
  const out = [
    '# stack.yaml: what this project is built with, layer by layer (ids from the agent-os catalog).',
    '# status: chosen | evaluating | optional | rejected. paths: where the layer lives in this repository.',
    '',
    `project: ${q(project ?? blueprint.name?.en ?? blueprint.id)}`,
    `level: ${blueprint.level}`,
    `blueprint: ${blueprint.id}`,
    '',
    'compliance:',
    '  euOnly: false',
    '',
    'layers:',
  ]
  const seen = new Set()
  for (const row of blueprint.layers ?? []) {
    if (seen.has(row.layer)) continue
    seen.add(row.layer)
    out.push(`  ${row.layer}:`)
    if (row.tech) out.push(`    tech: ${row.tech}`)
    for (const k of ['language', 'provider']) if (row[k] && !row.tech) out.push(`    ${k}: ${row[k]}`)
    if (row.runtime && !row.tech) out.push(`    runtime: ${q(row.runtime)}`)
    out.push(`    status: ${statuses[row.layer] ?? 'chosen'}`)
    out.push('    paths: []')
    if (row.detail) out.push(`    note: ${q(row.detail)}`)
  }
  return `${out.join('\n')}\n`
}
