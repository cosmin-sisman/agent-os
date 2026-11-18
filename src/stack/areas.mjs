// Areas come from the stack map: each layer in use becomes an area:<layer> label (named in the labels language, ro
// "zona:<layer>"), and its paths map files to areas. That feeds the labels setup creates, the change request's area
// labels, lessons recall, overlap and the area map check. Design §16.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from '../yaml/yaml.mjs'
import { matches } from '../util/glob.mjs'
import { loadCatalog } from './catalog.mjs'

/** One color per layer group, so the board reads by group. */
const GROUP_COLORS = { experience: 'a2eeef', interfaces: 'c2e0c6', logic: 'd4c5f9', data: 'fef2c0', platform: 'bfd4f2', delivery: 'e4e669' }
export const AREA_PREFIX = { en: 'area:', ro: 'zona:' }

const readStack = (cwd) => {
  const file = join(cwd, 'stack.yaml')
  if (!existsSync(file)) return null
  try { return parse(readFileSync(file, 'utf8'), { file: 'stack.yaml' }) ?? null } catch { return null }
}

/** The layers in use (status chosen, the default) with their paths and owners. */
export function areaLayers(cwd) {
  const stack = readStack(cwd)
  return Object.entries(stack?.layers ?? {}).filter(([, l]) => (l?.status ?? 'chosen') === 'chosen').map(([id, l]) => ({ id, paths: Array.isArray(l.paths) ? l.paths : [], owners: Array.isArray(l.owners) ? l.owners : [] }))
}

/** Label entries for the layers in use, in the same shape as the core labels (src/i18n/labels.yaml). */
export function areaLabelEntries(cwd, { catalog } = {}) {
  const layers = areaLayers(cwd)
  if (!layers.length) return []
  const cat = catalog ?? loadCatalog({ cwd })
  return layers.map(({ id }) => {
    const def = cat.layers.get(id)
    return {
      id: `area:${id}`,
      color: GROUP_COLORS[def?.group] ?? 'ededed',
      name: { en: `${AREA_PREFIX.en}${id}`, ro: `${AREA_PREFIX.ro}${id}` },
      description: { en: def?.description?.en ?? `The ${id} layer`, ro: def?.description?.ro ?? `Stratul ${id}` },
    }
  })
}

/** The layer ids whose paths cover a file. */
export const layersOf = (file, layers) => layers.filter((l) => l.paths.some((g) => matches(file, g))).map((l) => l.id)

/** The area ids (area:<layer>) a set of changed files touches. */
export function areasFor(files, cwd) {
  const layers = areaLayers(cwd)
  return [...new Set(files.flatMap((f) => layersOf(f, layers)))].sort().map((id) => `area:${id}`)
}

/** An area id as a label name in a language (area:data-layer → zona:data-layer in ro). */
export const areaLabelName = (id, lang = 'en') => id.replace(/^area:/, AREA_PREFIX[lang] ?? AREA_PREFIX.en)

/** Where the project keeps CODEOWNERS (the first that exists), or the root, which every platform reads. */
export function codeownersPath(cwd) {
  return ['.github/CODEOWNERS', '.gitlab/CODEOWNERS', 'docs/CODEOWNERS', 'CODEOWNERS'].find((p) => existsSync(join(cwd, p))) ?? 'CODEOWNERS'
}

/**
 * The CODEOWNERS lines for layers that name owners and paths, or '' when none do. Installed as a managed block, so
 * the team's own lines around it are never touched and a hand-edited block ends in a .rej, never overwritten.
 */
export function codeownersLines(cwd) {
  const lines = areaLayers(cwd).filter((l) => l.owners.length && l.paths.length)
    .flatMap((l) => l.paths.map((p) => `${p.startsWith('/') ? p : `/${p}`} ${l.owners.map((o) => (o.startsWith('@') ? o : `@${o}`)).join(' ')}`))
  return lines.length ? `# Generated from stack.yaml (layer owners): change the owners there.\n${lines.join('\n')}` : ''
}
