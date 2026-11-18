// `agent-os update`: today `--relock` (rebuild .agent-os/lock.json from the merge bases in .agent-os/base/) and
// `--migrate` (run the migrations between the project's pinned version and the running one). The full flow is #68.

import { readFileSync } from 'node:fs'
import { CliError } from '../cli/errors.mjs'
import { relock } from '../managed/managed.mjs'
import { loadConfig } from '../config/config.mjs'
import { runMigrations } from '../migrations/runner.mjs'

export const usage = 'agent-os update --relock | --migrate [--dry-run]'

export const options = {
  relock: { type: 'boolean', description: 'Rebuild .agent-os/lock.json from .agent-os/base/' },
  migrate: { type: 'boolean', description: 'Run the migrations from the pinned version to the running one' },
}

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  if (ctx.values.migrate) return migrate(ctx)
  if (!ctx.values.relock) {
    throw new CliError('the update flow is planned but not implemented yet', { hint: 'use "agent-os update --relock" to rebuild the lock; follow #68: https://github.com/cosmin-sisman/agent-os/issues/68' })
  }
  const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  const keys = relock(ctx.cwd, { version })
  ctx.output({ items: keys }, `rebuilt .agent-os/lock.json: ${keys.length} managed item(s)`)
}

async function migrate(ctx) {
  const { version: running } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  const from = loadConfig(ctx.cwd).merged.version
  if (!from) throw new CliError('agent-os.json does not pin a version, so there is no starting point', { hint: `pin the version the project was set up with: agent-os config set version <x.y.z>` })
  const results = await runMigrations(ctx.cwd, { from, to: running, dryRun: ctx.dryRun })
  const lines = results.map((r) => `${ctx.dryRun ? 'would run' : 'ran'} ${r.version}: ${r.description}${r.changes.length ? `\n  ${r.changes.join('\n  ')}` : ' (nothing to change)'}`)
  ctx.output({ from, to: running, dryRun: ctx.dryRun, migrations: results }, lines.length ? lines.join('\n') : `no migrations between ${from} and ${running}`)
}
