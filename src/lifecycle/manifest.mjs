// The lifecycle manifest: every item agent-os ships, with its state (new, stable, deprecated, legacy, removed), so
// nothing disappears without warning. Items are collected from the code; states come from the previous manifest
// plus the exceptions in lifecycle.yaml. Design §19.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { COMMANDS } from '../cli/registry.mjs'
import { GLOBAL_OPTIONS } from '../cli/options.mjs'
import { keyPaths } from '../config/config.mjs'
import { CORE_HANDLERS } from '../hooks/runner.mjs'
import { parse } from '../yaml/yaml.mjs'
import { readdirSync, statSync, existsSync } from 'node:fs'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
export const STATES = ['new', 'stable', 'deprecated', 'legacy', 'removed']
/** Which state may follow which (staying the same is always allowed). */
const NEXT = { new: ['stable', 'deprecated'], stable: ['deprecated'], deprecated: ['legacy', 'removed', 'stable'], legacy: ['removed', 'deprecated'], removed: [] }

function templateFiles(dir, prefix) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).sort().flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return templateFiles(full, `${prefix}${name}/`)
    return [`${prefix}${name.replace(/\.(en|ro)(\.[^.]+)$/, '$2')}`]
  })
}

/** Every item agent-os ships today, by stable id. Command flags are read from the command modules. */
export async function collectItems({ root = ROOT } = {}) {
  const ids = new Set()
  for (const c of COMMANDS) {
    ids.add(`command:${c.name}`)
    if (c.load) for (const opt of Object.keys((await c.load()).options ?? {})) ids.add(`flag:${c.name} --${opt}`)
  }
  for (const opt of Object.keys(GLOBAL_OPTIONS)) ids.add(`flag:* --${opt}`)
  for (const k of keyPaths()) ids.add(`config:${k}`)
  for (const h of CORE_HANDLERS) ids.add(`hook:${h.name}`)
  for (const f of templateFiles(join(root, 'templates'), '')) ids.add(`template:${f}`)
  const legacyDir = join(root, 'templates', 'legacy')
  for (const id of existsSync(legacyDir) ? readdirSync(legacyDir).filter((d) => statSync(join(legacyDir, d)).isDirectory()) : []) ids.add(`legacy:${id}`)
  for (const name of existsSync(join(root, 'catalog')) ? readdirSync(join(root, 'catalog')).filter((f) => f.endsWith('.yaml')) : []) {
    for (const entry of parse(readFileSync(join(root, 'catalog', name), 'utf8'), { file: `catalog/${name}` }) ?? []) ids.add(`catalog:${name.replace('.yaml', '')}:${entry.id}`)
  }
  return [...ids].sort()
}

export function readExceptions(file = join(ROOT, 'src/lifecycle/lifecycle.yaml')) {
  return parse(readFileSync(file, 'utf8'), { file: 'src/lifecycle/lifecycle.yaml' }) ?? []
}

/**
 * Builds the manifest for a version from the current items, the previous manifest and the exceptions.
 * @param {{ version: string, items: string[], previous?: { items: Record<string, object> } | null, exceptions?: object[] }} input
 */
export function buildManifest({ version, items, previous = null, exceptions = [] }) {
  const out = {}
  const prev = previous?.items ?? {}
  const byId = Object.fromEntries(exceptions.map((e) => [e.id, e]))
  for (const id of items) {
    const { id: _id, ...ex } = byId[id] ?? {}
    out[id] = { ...(prev[id] && prev[id].status !== 'removed' ? prev[id] : { status: 'new', since: version }), ...ex }
  }
  for (const [id, entry] of Object.entries(prev)) {
    if (out[id]) continue
    if (entry.status === 'removed') out[id] = entry
    else if (byId[id]) { const { id: _id, ...ex } = byId[id]; out[id] = { ...entry, ...ex } }
    else out[id] = { ...entry, status: 'missing' }
  }
  return { manifestVersion: 1, version, items: Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b))) }
}

/**
 * The rules a release must pass, comparing the new manifest with the previous one.
 * @returns {string[]} problems; empty when the release is allowed
 */
export function checkManifest(next, previous, { migrationExists = (v) => existsSync(join(ROOT, 'migrations', `${v}.mjs`)) } = {}) {
  const problems = []
  const prev = previous?.items ?? {}
  for (const [id, e] of Object.entries(next.items)) {
    const before = prev[id]?.status
    if (e.status === 'missing') { problems.push(`${id} disappeared without being deprecated: keep it, or deprecate it first (lifecycle.yaml)`); continue }
    if (!STATES.includes(e.status)) { problems.push(`${id}: unknown state "${e.status}"`); continue }
    if (before && before !== e.status && !NEXT[before].includes(e.status)) problems.push(`${id}: ${before} → ${e.status} is not allowed (${before} may become ${NEXT[before].join(' or ') || 'nothing else'})`)
    if (e.status === 'deprecated' || e.status === 'legacy') {
      for (const f of ['deprecatedIn', 'removeIn', 'replacement']) if (!e[f]) problems.push(`${id}: ${e.status} needs ${f}`)
    }
    if (e.status === 'removed') {
      if (!e.migration) problems.push(`${id}: removed needs a migration (the version of migrations/<version>.mjs that handles it)`)
      else if (!migrationExists(e.migration)) problems.push(`${id}: migration ${e.migration} does not exist (migrations/${e.migration}.mjs)`)
    }
  }
  return problems
}

/**
 * Deprecated, legacy or removed items a project still uses: its config keys and the commands and flags in its hooks.
 * @param {{ items: Record<string, object> }} manifest
 * @param {{ team?: object, local?: object, hookCommands?: string[] }} project
 */
export function deprecatedInUse(manifest, { team = {}, local = {}, hookCommands = [] }) {
  const used = new Set()
  const walk = (obj, prefix) => {
    for (const [k, v] of Object.entries(obj ?? {})) {
      const path = prefix ? `${prefix}.${k}` : k
      used.add(`config:${path}`)
      if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, path)
    }
  }
  walk(team, '')
  walk(local, '')
  for (const cmd of hookCommands) {
    const m = cmd.match(/agent-os(?:@\S+)?\s+(\S+)(.*)$/)
    if (!m) continue
    used.add(`command:${m[1]}`)
    for (const f of m[2].match(/--[\w-]+/g) ?? []) { used.add(`flag:${m[1]} ${f}`); used.add(`flag:* ${f}`) }
  }
  return [...used].sort().flatMap((id) => {
    const e = manifest.items[id]
    if (!e || !['deprecated', 'legacy', 'removed'].includes(e.status)) return []
    return [{ id, status: e.status, replacement: e.replacement ?? null, removeIn: e.removeIn ?? null, message: `${id} is ${e.status}${e.removeIn ? `, removed in ${e.removeIn}` : ''}${e.replacement ? `; use ${e.replacement}` : ''}` }]
  })
}
