// Migrations: the steps that bring a project's files from one agent-os version to the next (configuration, registry,
// journal and lesson schemas, stack.yaml). Each lives in migrations/<version>.mjs, runs in version order, and must be
// idempotent: running it again changes nothing. Design §19.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { CliError } from '../cli/errors.mjs'
import { readLock, writeLock } from '../managed/managed.mjs'

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url))
const VERSION_FILE = /^(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.mjs$/

/** Compares two semver versions (pre-releases sort before their release). */
export function compareVersions(a, b) {
  const [ma, pa = ''] = a.split('-')
  const [mb, pb = ''] = b.split('-')
  const na = ma.split('.').map(Number)
  const nb = mb.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (na[i] !== nb[i]) return na[i] - nb[i]
  if (pa === pb) return 0
  if (!pa) return 1
  if (!pb) return -1
  return pa < pb ? -1 : 1
}

/** The migration versions in a directory, in order. */
export function listMigrations(dir = MIGRATIONS_DIR) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).map((f) => f.match(VERSION_FILE)?.[1]).filter(Boolean).sort(compareVersions)
}

/** Versions after `from` and up to `to`. */
export const pendingMigrations = (from, to, versions) => versions.filter((v) => (!from || compareVersions(v, from) > 0) && compareVersions(v, to) <= 0)

/** The small API a migration gets: file reads and writes under the project, with every real change recorded. */
export function projectApi(cwd, { dryRun = false } = {}) {
  const changes = []
  const path = (p) => join(cwd, p)
  const writeText = (p, text) => {
    const before = existsSync(path(p)) ? readFileSync(path(p), 'utf8') : null
    if (before === text) return false
    changes.push(`${before === null ? 'create' : 'update'} ${p}`)
    if (!dryRun) { mkdirSync(dirname(path(p)), { recursive: true }); writeFileSync(path(p), text) }
    return true
  }
  return {
    cwd,
    changes,
    exists: (p) => existsSync(path(p)),
    readText: (p) => (existsSync(path(p)) ? readFileSync(path(p), 'utf8') : null),
    writeText,
    readJson: (p) => (existsSync(path(p)) ? JSON.parse(readFileSync(path(p), 'utf8')) : null),
    writeJson: (p, value) => writeText(p, `${JSON.stringify(value, null, 2)}\n`),
    note: (message) => changes.push(message),
  }
}

/**
 * Runs the migrations after `from` up to `to`, in order. Stops at the first failure and says which one failed;
 * the ones before it stay applied and are recorded in the lock, so a rerun continues from there.
 * @returns {Promise<{ version: string, description: string, changes: string[] }[]>}
 */
export async function runMigrations(cwd, { from, to, dryRun = false, dir = MIGRATIONS_DIR }) {
  const lock = readLock(cwd)
  const done = new Set(lock.migrations ?? [])
  const results = []
  for (const version of pendingMigrations(from, to, listMigrations(dir))) {
    if (done.has(version)) continue
    const mod = await import(pathToFileURL(join(dir, `${version}.mjs`)).href)
    if (typeof mod.migrate !== 'function') throw new CliError(`migrations/${version}.mjs does not export migrate(project)`)
    const project = projectApi(cwd, { dryRun })
    try {
      await mod.migrate(project)
    } catch (err) {
      throw new CliError(`migration ${version} failed: ${err.message}`, { hint: `the migrations before ${version} are applied; fix the cause and run again: it continues from ${version}` })
    }
    results.push({ version, description: mod.description ?? '', changes: project.changes })
    if (!dryRun) {
      done.add(version)
      writeLock(cwd, { ...readLock(cwd), migrations: [...done].sort(compareVersions) })
    }
  }
  return results
}
