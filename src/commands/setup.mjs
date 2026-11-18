// `agent-os setup`: makes the repository ready on its platform: integration branch created and default, both branches
// protected, core labels and the rolling milestone in the configured languages, and the platform route's files
// installed. Shows the plan first; --dry-run stops there.

import { readFileSync } from 'node:fs'
import { CliError } from '../cli/errors.mjs'
import { loadConfig } from '../config/config.mjs'
import { planPlatformSetup, SETUP_AREAS } from '../platform/setup.mjs'
import { installRoutes } from '../managed/install.mjs'
import { exitCodeFor } from '../managed/managed.mjs'

export const usage = `agent-os setup [--only ${SETUP_AREAS.join(',')}] [--dry-run]`

export const options = {
  only: { type: 'string', description: `Comma-separated areas: ${SETUP_AREAS.join(', ')}` },
}

const version = () => JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version

/**
 * Plans and (unless dry-run) applies the setup. Shared with `agent-os lang set`.
 * @param {import('../cli/context.mjs').Context} ctx
 * @param {object} config merged configuration
 * @param {string[]} [only]
 */
export function runSetup(ctx, config, only) {
  const remoteAreas = (only ?? SETUP_AREAS).filter((a) => a !== 'files')
  const steps = remoteAreas.length ? planPlatformSetup(config, { gh: ctx.io.gh, glab: ctx.io.glab, only: remoteAreas }) : []
  const lines = steps.map((s) => (s.action === 'keep' ? s.description : `${ctx.dryRun ? 'would ' : ''}${s.description}`))
  const applied = []
  if (!ctx.dryRun) for (const s of steps.filter((x) => x.action !== 'keep')) { s.apply(); applied.push(s.description) }
  let files = null
  if (!only || only.includes('files')) {
    const r = installRoutes(ctx.cwd, config, { version: version(), dryRun: ctx.dryRun })
    files = r.results
    for (const f of r.results.filter((x) => x.action !== 'unchanged')) lines.push(`${ctx.dryRun ? 'would ' : ''}${f.action === 'conflict' ? `keep ${f.key} (local edits conflict; see ${f.rej ?? `${f.key}.rej`})` : `${f.action.replace('installed', 'install')} ${f.key}`}`)
  }
  const plan = steps.map(({ area, action, description }) => ({ area, action, description }))
  const changes = steps.some((x) => x.action !== 'keep') || (files ?? []).some((f) => f.action !== 'unchanged')
  ctx.output({ dryRun: ctx.dryRun, steps: plan, files }, (changes ? lines : [...lines, 'nothing to change: the repository is already set up']).join('\n'))
  return files ? exitCodeFor(files) : 0
}

/** @param {import('../cli/context.mjs').Context} ctx */
export function run(ctx) {
  const only = ctx.values.only?.split(',').map((s) => s.trim()).filter(Boolean)
  for (const a of only ?? []) if (!SETUP_AREAS.includes(a)) throw new CliError(`unknown setup area "${a}"`, { hint: `areas: ${SETUP_AREAS.join(', ')}` })
  return runSetup(ctx, loadConfig(ctx.cwd).merged, only)
}
