// What agent-os installs into a project: the core templates plus the route of the configured platform, rendered for
// the project's configuration. The lock records the platform, so an update only ever writes the active route.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderTree } from '../templates/tree.mjs'
import { applyManaged, readLock, writeLock } from './managed.mjs'
import { aliasesFor } from '../platform/vocabulary.mjs'
import { CliError } from '../cli/errors.mjs'

export const TEMPLATES = fileURLToPath(new URL('../../templates/', import.meta.url))

/**
 * The files to install: core and the active platform route, rendered. Core and route may not write the same path.
 * @param {object} config merged configuration
 * @param {{ templatesRoot?: string }} [options]
 * @returns {{ platform: string, items: { key: string, content: string, route: string }[], aliases: { alias: string, target: string }[] }}
 */
export function planInstall(config, { templatesRoot = TEMPLATES } = {}) {
  const platform = config.platform?.type ?? 'github'
  const routes = [['core', join(templatesRoot, 'core')], [`platform/${platform}`, join(templatesRoot, 'platform', platform)]]
  const items = []
  const seen = new Map()
  for (const [route, dir] of routes) {
    if (!existsSync(dir)) continue
    for (const f of renderTree(dir, config)) {
      if (seen.has(f.path)) throw new CliError(`${f.path} comes from both ${seen.get(f.path)} and ${route}`, { hint: 'a platform route may add files, never override core ones' })
      seen.set(f.path, route)
      items.push({ key: f.path, content: f.content, route })
    }
  }
  return { platform, items: items.sort((a, b) => a.key.localeCompare(b.key)), aliases: aliasesFor(platform) }
}

/**
 * Installs or updates the project's managed files for the active platform route.
 * @param {string} cwd
 * @param {object} config merged configuration
 * @param {{ version: string, dryRun?: boolean, templatesRoot?: string }} options
 */
export function installRoutes(cwd, config, { version, dryRun = false, templatesRoot } = {}) {
  const plan = planInstall(config, { templatesRoot })
  const lock = readLock(cwd)
  if (lock.platform && lock.platform !== plan.platform) {
    throw new CliError(`this project was installed for ${lock.platform}, and agent-os.json now says ${plan.platform}`, { hint: 'switching platform rewrites every platform route on its own branch; follow #98 (agent-os platform switch)' })
  }
  const results = applyManaged(cwd, plan.items, { version, dryRun })
  if (!dryRun) writeLock(cwd, { ...readLock(cwd), platform: plan.platform })
  return { platform: plan.platform, aliases: plan.aliases, results }
}
