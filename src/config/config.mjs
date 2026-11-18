// Loads, validates, merges and saves the two configuration files: agent-os.json (team, committed) and
// .agent-os/local.json (personal, gitignored). Every problem names the file, the key, what was expected and what was found.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { SCHEMA } from './schema.mjs'
import { CliError } from '../cli/errors.mjs'
import { closest } from '../util/closest.mjs'

export const TEAM_FILE = 'agent-os.json'
export const LOCAL_FILE = '.agent-os/local.json'
export const GITIGNORE_ENTRIES = ['.agent-os/local.json', '.agent-os/cache/']

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v)
const show = (v) => JSON.stringify(v)

/**
 * Validates one file's content. `personal` says which file it is: personal keys are refused in the team file
 * and team keys in the personal file, with a message that says where the key belongs.
 * @returns {string[]} problems, empty when valid
 */
export function validate(value, { personal, file }) {
  const problems = []
  walk(SCHEMA, value, '', problems, personal, file, undefined)
  return problems
}

/** `inherited` is the nearest explicit personal flag above this node; leaves without one are team keys. */
function walk(node, value, path, problems, personal, file, inherited) {
  const at = path || '(root)'
  const flag = node.personal ?? inherited
  const isObjectWithKeys = node.type === 'object' && node.properties
  const owner = flag ?? (isObjectWithKeys ? undefined : false)
  if (path && owner !== undefined && owner !== personal) {
    problems.push(owner
      ? `${file}: ${at} is personal: set it in ${LOCAL_FILE} (agent-os config set ${path} <value>)`
      : `${file}: ${at} is a team setting: set it in ${TEAM_FILE}`)
    return
  }
  const types = [].concat(node.type)
  const actual = typeOf(value)
  if (!types.includes(actual) && !(actual === 'integer' && types.includes('number'))) {
    problems.push(`${file}: ${at}: expected ${types.join(' or ')}, got ${actual} ${show(value)}`)
    return
  }
  if (node.enum && !node.enum.includes(value)) problems.push(`${file}: ${at}: expected one of ${node.enum.map(show).join(', ')}, got ${show(value)}`)
  if (node.pattern && typeof value === 'string' && !new RegExp(node.pattern).test(value)) problems.push(`${file}: ${at}: ${show(value)} does not match ${node.description.toLowerCase()} (pattern ${node.pattern})`)
  if (node.minimum !== undefined && value < node.minimum) problems.push(`${file}: ${at}: expected at least ${node.minimum}, got ${value}`)
  if (node.maximum !== undefined && value > node.maximum) problems.push(`${file}: ${at}: expected at most ${node.maximum}, got ${value}`)
  if (actual === 'array' && node.items) value.forEach((v, i) => walk(node.items, v, `${path}[${i}]`, problems, personal, file, flag ?? false))
  if (actual === 'object') {
    for (const key of node.required ?? []) if (!(key in value)) problems.push(`${file}: ${path ? `${path}.` : ''}${key}: required`)
    for (const [key, v] of Object.entries(value)) {
      const child = node.properties?.[key] ?? node.additionalProperties
      const keyPath = path ? `${path}.${key}` : key
      if (!child) {
        const near = closest(key, Object.keys(node.properties ?? {}))
        problems.push(`${file}: ${keyPath}: unknown key${near ? `; did you mean "${near}"?` : ''}`)
        continue
      }
      walk(child, v, keyPath, problems, personal, file, node.properties?.[key] ? flag : (flag ?? false))
    }
  }
}

/** Fills in defaults for every key the schema defines and the value leaves out. */
export function withDefaults(node, value) {
  if (value === undefined) value = node.default === undefined ? undefined : structuredClone(node.default)
  if (node.type === 'object' && node.properties && value && typeof value === 'object') {
    const out = { ...value }
    for (const [key, child] of Object.entries(node.properties)) {
      const filled = withDefaults(child, out[key])
      if (filled !== undefined) out[key] = filled
    }
    return out
  }
  return value
}

/** Deep merge where `b` wins; arrays are replaced, not concatenated. */
function merge(a, b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return b === undefined ? a : b
  const out = { ...(a ?? {}) }
  for (const [k, v] of Object.entries(b)) out[k] = merge(out[k], v)
  return out
}

function readJson(path, file) {
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new CliError(`${file} is not valid JSON: ${err.message}`, { hint: `fix the syntax in ${file}` })
  }
}

/**
 * Reads both files under `cwd`, validates each against its part of the schema, and returns them with the merged
 * configuration (defaults, then team, then personal). Throws a CliError listing every problem.
 */
export function loadConfig(cwd) {
  const team = readJson(join(cwd, TEAM_FILE), TEAM_FILE)
  const local = readJson(join(cwd, LOCAL_FILE), LOCAL_FILE)
  const problems = [
    ...(team === undefined ? [] : validate(team, { personal: false, file: TEAM_FILE })),
    ...(local === undefined ? [] : validate(local, { personal: true, file: LOCAL_FILE })),
  ]
  if (problems.length) {
    throw new CliError(`invalid configuration:\n  - ${problems.join('\n  - ')}`, { hint: 'fix the keys above, or run "agent-os config validate" after editing' })
  }
  return { team: team ?? null, local: local ?? null, merged: withDefaults(SCHEMA, merge(team ?? {}, local ?? {})), initialized: team !== undefined }
}

/** Finds the schema node for a dotted key such as `languages.issues` or `gate.unit`. */
export function nodeFor(key) {
  let node = SCHEMA
  for (const part of key.split('.')) {
    node = node.properties?.[part] ?? node.additionalProperties
    if (!node) return null
  }
  return node
}

/** Every dotted key path the schema defines (objects and leaves; map entries appear as `<name>`). */
export function keyPaths(node = SCHEMA, prefix = '') {
  const out = []
  for (const [key, child] of Object.entries(node.properties ?? {})) {
    const path = prefix ? `${prefix}.${key}` : key
    out.push(path)
    out.push(...keyPaths(child, path))
    if (child.additionalProperties) out.push(`${path}.<name>`)
  }
  return out
}

/** A hint for an unknown key: the closest known key, or where to look. */
export function unknownKeyHint(key) {
  const near = closest(key, keyPaths())
  return near ? `did you mean "${near}"?` : 'run "agent-os config" to see every key'
}

/** True when the key (or the object it sits in) is personal. */
export function isPersonal(key) {
  let node = SCHEMA
  for (const part of key.split('.')) {
    node = node.properties?.[part] ?? node.additionalProperties
    if (!node) return false
    if (node.personal) return true
  }
  return false
}

export function getPath(obj, key) {
  return key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
}

export function setPath(obj, key, value) {
  const parts = key.split('.')
  const out = structuredClone(obj ?? {})
  let cur = out
  for (const p of parts.slice(0, -1)) cur = cur[p] = cur[p] && typeof cur[p] === 'object' ? cur[p] : {}
  cur[parts.at(-1)] = value
  return out
}

/** Writes a configuration file with stable formatting, creating its folder. */
export function saveJson(cwd, file, value) {
  const path = join(cwd, file)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

/** Adds the personal and cache entries to the repository's .gitignore when they are missing. Returns what it added. */
export function ensureGitignore(cwd) {
  const path = join(cwd, '.gitignore')
  const text = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const lines = new Set(text.split(/\r?\n/).map((l) => l.trim()))
  const missing = GITIGNORE_ENTRIES.filter((e) => !lines.has(e))
  if (missing.length) writeFileSync(path, `${text}${text && !text.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`)
  return missing
}
