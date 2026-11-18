// system.yaml: how the project is put together (design §24). Components with a kind, a path in this repository or
// another repository, the stack layer they belong to, their exposure, what they provide (interfaces) and consume
// (other components), and owners. One readable file, drafted by `system detect` and corrected by people.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from '../yaml/yaml.mjs'
import { closest } from '../util/closest.mjs'

export const FILE = 'system.yaml'
export const KINDS = ['app', 'service', 'worker', 'package', 'external']
export const EXPOSURES = ['public', 'internal', 'private']
export const INTERFACES = ['http', 'graphql', 'grpc', 'events', 'webhook', 'queue', 'db']
const KEYS = ['kind', 'path', 'repo', 'layer', 'exposure', 'provides', 'consumes', 'owners', 'note']

/** system.yaml, or null when there is none. */
export function readSystem(cwd) {
  const file = join(cwd, FILE)
  return existsSync(file) ? parse(readFileSync(file, 'utf8'), { file: FILE }) ?? {} : null
}

const did = (v, list) => { const c = typeof v === 'string' ? closest(v, list) : null; return c ? ` (did you mean "${c}"?)` : '' }

/**
 * Problems (errors) and warnings of a system map. `layers` are the known layer ids (stack.yaml's, else the
 * catalog's): a component's layer outside them is a warning, since stack.yaml may not be written yet.
 */
export function validateSystem(system, { layers = [] } = {}) {
  const problems = []
  const warnings = []
  if (!system || typeof system !== 'object' || Array.isArray(system)) return { problems: ['system.yaml must be a map'], warnings }
  for (const k of Object.keys(system)) if (k !== 'components') problems.push(`unknown key "${k}"${did(k, ['components'])}`)
  const comps = system.components ?? {}
  if (typeof comps !== 'object' || Array.isArray(comps)) return { problems: [...problems, 'components must be a map of component ids'], warnings }
  const ids = Object.keys(comps)
  for (const [id, c] of Object.entries(comps)) {
    const at = `components.${id}`
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) problems.push(`${at}: ids are lowercase kebab-case`)
    if (!c || typeof c !== 'object' || Array.isArray(c)) { problems.push(`${at} must be a map`); continue }
    for (const k of Object.keys(c)) if (!KEYS.includes(k)) problems.push(`${at}: unknown key "${k}"${did(k, KEYS)}`)
    if (!KINDS.includes(c.kind)) problems.push(`${at}.kind must be one of ${KINDS.join(', ')}${did(c.kind, KINDS)}`)
    if (c.exposure !== undefined && !EXPOSURES.includes(c.exposure)) problems.push(`${at}.exposure must be one of ${EXPOSURES.join(', ')}${did(c.exposure, EXPOSURES)}`)
    if (c.kind !== 'external' && c.path === undefined && c.repo === undefined) problems.push(`${at} needs a path (in this repository) or a repo (owner/name)`)
    if (c.repo !== undefined && !/^[^/\s]+(\/[^/\s]+)+$/.test(String(c.repo))) problems.push(`${at}.repo must be owner/name`)
    if (c.layer !== undefined && layers.length && !layers.includes(c.layer)) warnings.push(`${at}.layer "${c.layer}" is not a known layer${did(c.layer, layers)}`)
    for (const dep of Array.isArray(c.consumes) ? c.consumes : c.consumes === undefined ? [] : [null]) {
      if (typeof dep !== 'string') { problems.push(`${at}.consumes must be a list of component ids`); break }
      if (!ids.includes(dep)) problems.push(`${at}.consumes "${dep}", which is not a component${did(dep, ids)}`)
      if (dep === id) problems.push(`${at} consumes itself`)
    }
    for (const [i, p] of (Array.isArray(c.provides) ? c.provides : c.provides === undefined ? [] : [null]).entries()) {
      const kind = p && typeof p === 'object' ? Object.keys(p)[0] : null
      if (!kind || Object.keys(p).length !== 1) { problems.push(`${at}.provides[${i}] must be one interface: { http: { … } }`); continue }
      if (!INTERFACES.includes(kind)) problems.push(`${at}.provides[${i}]: unknown interface "${kind}"${did(kind, INTERFACES)}`)
    }
    if (c.owners !== undefined && !(Array.isArray(c.owners) && c.owners.every((o) => typeof o === 'string'))) problems.push(`${at}.owners must be a list of logins or teams`)
  }
  return { problems, warnings }
}
