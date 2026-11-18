// The project's stack map (stack.yaml) read against the catalog: for each layer, its technology, language, paths and
// how well agents know it. Used to pick the language rules and scope them to the layer paths. Design §16, §22.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '../yaml/yaml.mjs'

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
