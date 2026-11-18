// What agent-os installs into a project: the core templates plus the route of the configured platform, rendered for
// the project's configuration. The lock records the platform, so an update only ever writes the active route.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderTree } from '../templates/tree.mjs'
import { applyManaged, readLock, writeLock } from './managed.mjs'
import { aliasesFor } from '../platform/vocabulary.mjs'
import { hooksContent } from './managed.mjs'
import { settingsHooks } from '../hooks/runner.mjs'
import { hookCommand } from '../version/pin.mjs'
import { CliError } from '../cli/errors.mjs'
import { coreEntry, REGISTRY_DIR } from '../registry/registry.mjs'

export const TEMPLATES = fileURLToPath(new URL('../../templates/', import.meta.url))

/**
 * The files to install: core and the active platform route, rendered. Core and route may not write the same path.
 * @param {object} config merged configuration
 * @param {{ templatesRoot?: string }} [options]
 * @returns {{ platform: string, items: { key: string, content: string, route: string }[], aliases: { alias: string, target: string }[] }}
 */
export function planInstall(config, { templatesRoot = TEMPLATES, cwd } = {}) {
  const platform = config.platform?.type ?? 'github'
  // Legacy features are installed only when the project opts in (#69); unknown ids are left to doctor.
  const legacy = (config.legacy ?? []).filter((id) => /^[\w-]+$/.test(id)).map((id) => [`legacy/${id}`, join(templatesRoot, 'legacy', id)])
  const routes = [['core', join(templatesRoot, 'core')], [`platform/${platform}`, join(templatesRoot, 'platform', platform)], ...legacy]
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
  // One registry entry per core skill (#38): the registry describes every skill on disk.
  for (const it of [...items]) {
    const m = it.key.match(/^\.claude\/skills\/([^/]+)\/SKILL\.md$/)
    if (!m) continue
    const description = it.content.match(/^description:\s*(.+)$/m)?.[1].trim().replace(/^["']|["']$/g, '').split(/(?<=\.)\s/)[0]
    items.push({ key: `${REGISTRY_DIR}/${m[1]}.json`, content: `${JSON.stringify(coreEntry(m[1], { version: config.version ?? null, description }), null, 2)}\n`, route: it.route })
  }
  // Managed blocks in the agent files: the team's own text around them is never touched (#49).
  items.push({ key: 'AGENTS.md#agent-os', content: agentsBlock(config), route: 'core' })
  items.push({ key: 'CLAUDE.md#agent-os', content: '@AGENTS.md', route: 'core' })
  // The hooks block in .claude/settings.json, always with the pinned command (#65).
  items.push({ key: '.claude/settings.json#hooks', content: hooksContent(settingsHooks(hookCommand(config, { cwd }))), route: 'core' })
  return { platform, items: items.sort((a, b) => a.key.localeCompare(b.key)), aliases: aliasesFor(platform) }
}

/**
 * Installs or updates the project's managed files for the active platform route.
 * @param {string} cwd
 * @param {object} config merged configuration
 * @param {{ version: string, dryRun?: boolean, templatesRoot?: string }} options
 */
export function installRoutes(cwd, config, { version, dryRun = false, templatesRoot } = {}) {
  const plan = planInstall(config, { templatesRoot, cwd })
  const lock = readLock(cwd)
  if (lock.platform && lock.platform !== plan.platform) {
    throw new CliError(`this project was installed for ${lock.platform}, and agent-os.json now says ${plan.platform}`, { hint: 'switching platform rewrites every platform route on its own branch; follow #98 (agent-os platform switch)' })
  }
  const results = applyManaged(cwd, plan.items, { version, dryRun })
  if (!dryRun) writeLock(cwd, { ...readLock(cwd), platform: plan.platform })
  return { platform: plan.platform, aliases: plan.aliases, results }
}

/** The agent-os block in AGENTS.md: where the rules, skills and checks are, in a few lines. */
export function agentsBlock(config) {
  const { integration, production } = config.branches ?? {}
  return [
    '## agent-os',
    '',
    `This repository follows agent-os${config.version ? ` ${config.version}` : ''}. Rules in \`.claude/rules/\`, skills in \`.claude/skills/\` (start with /next, /start, /pr and /ship), team settings in \`agent-os.json\`.`,
    `Work goes to \`${integration ?? 'development'}\` through change requests; \`${production ?? 'main'}\` changes only through /release. \`agent-os doctor\` checks the setup.`,
  ].join('\n')
}
