// Legacy and deprecation at run time. A legacy feature is a template folder under templates/legacy/<id>/, installed
// only when the project opts in (`legacy: ["<id>"]` in agent-os.json), and reported by doctor as debt. Deprecated or
// legacy commands and flags print a note when they run. States and dates come from src/lifecycle/lifecycle.yaml.

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { readExceptions } from './manifest.mjs'

/** The legacy features this package ships: the folders of templates/legacy/. */
export function legacyFeatures(templatesRoot) {
  const dir = join(templatesRoot, 'legacy')
  return existsSync(dir) ? readdirSync(dir).filter((d) => statSync(join(dir, d)).isDirectory()).sort() : []
}

/** The lifecycle entry for an id (deprecated, legacy or removed), or null. */
export function lifecycleOf(id, exceptions = safeExceptions()) {
  const e = exceptions.find((x) => x.id === id)
  return e && ['deprecated', 'legacy', 'removed'].includes(e.status) ? e : null
}

function safeExceptions() {
  try { return readExceptions() } catch { return [] }
}

/** A one-line note for a deprecated or legacy item that is being used. */
const bare = (id) => String(id).replace(/^(command|flag|config|legacy|template):/, '')
export const noticeFor = (id, e) => `${bare(id)} is ${e.status}${e.removeIn ? ` and will be removed in ${e.removeIn}` : ''}${e.replacement ? `; use ${bare(e.replacement)}` : ''}`

/** Notes for the command and flags of one invocation. */
export function runNotices(command, values, exceptions = safeExceptions()) {
  const ids = [`command:${command}`, ...Object.keys(values ?? {}).filter((k) => values[k] !== undefined && values[k] !== false).flatMap((k) => [`flag:${command} --${k}`, `flag:* --${k}`])]
  return ids.map((id) => [id, lifecycleOf(id, exceptions)]).filter(([, e]) => e).map(([id, e]) => noticeFor(id, e))
}
