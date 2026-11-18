// The skill registry: one JSON file per skill in .agent-os/registry/<name>.json, so two people adding two skills never
// touch the same file. It says where each skill came from (core, external, local, or plugin/builtin skills that live
// outside the repository) and what it provides to the capability slots. Design §6.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CliError } from '../cli/errors.mjs'

export const REGISTRY_DIR = '.agent-os/registry'
export const ORIGINS = ['core', 'external', 'local', 'plugin', 'builtin']
/** Origins whose skills live outside the repository: registered so the index knows them, with no folder. */
export const OUTSIDE = ['plugin', 'builtin']
const NAME = /^[a-z0-9][a-z0-9-]*$/
const KEYS = ['name', 'origin', 'source', 'version', 'license', 'provides', 'managed', 'description']

/** The problems with one registry entry (and its file name). */
export function validateEntry(entry, file) {
  const problems = []
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return ['the entry must be a JSON object']
  for (const k of Object.keys(entry)) if (!KEYS.includes(k)) problems.push(`unknown key "${k}" (known: ${KEYS.join(', ')})`)
  if (typeof entry.name !== 'string' || !NAME.test(entry.name)) problems.push('name must be lowercase kebab-case')
  else if (file && file !== `${entry.name}.json`) problems.push(`the file must be named ${entry.name}.json`)
  if (!ORIGINS.includes(entry.origin)) problems.push(`origin must be one of ${ORIGINS.join(', ')}`)
  if (entry.origin === 'external' && !/^[a-z]+:[\w./-]+@[\w.-]+$/.test(entry.source ?? '')) problems.push('an external skill needs source "<host>:<owner>/<repo>@<commit or tag>", pinned')
  if (entry.source !== undefined && typeof entry.source !== 'string') problems.push('source must be a string')
  for (const k of ['version', 'license', 'description']) if (entry[k] !== undefined && entry[k] !== null && typeof entry[k] !== 'string') problems.push(`${k} must be a string`)
  if (entry.provides !== undefined && (!Array.isArray(entry.provides) || entry.provides.some((p) => typeof p !== 'string' || !NAME.test(p)))) problems.push('provides must be a list of slot names')
  if (entry.managed !== undefined && typeof entry.managed !== 'boolean') problems.push('managed must be true or false')
  if (entry.origin === 'core' && entry.managed === false) problems.push('a core skill is managed by agent-os (managed: true)')
  return problems
}

/** Every entry, with its file and problems. */
export function readRegistry(cwd) {
  const dir = join(cwd, REGISTRY_DIR)
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((file) => {
    const path = `${REGISTRY_DIR}/${file}`
    let entry = null
    let problems
    try { entry = JSON.parse(readFileSync(join(dir, file), 'utf8')); problems = validateEntry(entry, file) } catch { problems = ['not valid JSON'] }
    return { file, path, entry, problems }
  })
}

/** The entry agent-os installs for one of its core skills. */
export const coreEntry = (name, { version = null, description } = {}) => ({ name, origin: 'core', source: 'agent-os', version, license: 'MIT', provides: [], managed: true, ...(description ? { description } : {}) })

/** Records a skill (local, external, plugin or builtin). Refuses an invalid entry or one that already exists. */
export function registerSkill(cwd, entry, { force = false, dryRun = false } = {}) {
  if (entry.origin === 'core') throw new CliError('core skills are registered by agent-os itself', { hint: 'register local, external, plugin or builtin skills' })
  const clean = Object.fromEntries(Object.entries({ managed: false, provides: [], ...entry }).filter(([, v]) => v !== undefined))
  const problems = validateEntry(clean, `${clean.name}.json`)
  if (problems.length) throw new CliError(`the entry is not valid: ${problems.join('; ')}`)
  const path = `${REGISTRY_DIR}/${clean.name}.json`
  if (existsSync(join(cwd, path)) && !force) throw new CliError(`${path} already exists`, { hint: 'pass --force to replace it' })
  if (!OUTSIDE.includes(clean.origin) && !existsSync(join(cwd, '.claude', 'skills', clean.name, 'SKILL.md'))) throw new CliError(`there is no .claude/skills/${clean.name}/SKILL.md to register`, { hint: OUTSIDE.map((o) => `--origin ${o}`).join(' or ') + ' for a skill that lives outside the repository' })
  if (!dryRun) { mkdirSync(join(cwd, REGISTRY_DIR), { recursive: true }); writeFileSync(join(cwd, path), `${JSON.stringify(clean, null, 2)}\n`) }
  return { path, entry: clean, dryRun }
}
