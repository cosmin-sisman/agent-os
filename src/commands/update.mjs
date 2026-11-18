// `agent-os update`: today only `--relock`, which rebuilds .agent-os/lock.json from the merge bases in
// .agent-os/base/ (for example after two branches changed the lock). The full update flow is #68.

import { readFileSync } from 'node:fs'
import { CliError } from '../cli/errors.mjs'
import { relock } from '../managed/managed.mjs'

export const usage = 'agent-os update --relock'

export const options = {
  relock: { type: 'boolean', description: 'Rebuild .agent-os/lock.json from .agent-os/base/' },
}

/** @param {import('../cli/context.mjs').Context} ctx */
export function run(ctx) {
  if (!ctx.values.relock) {
    throw new CliError('the update flow is planned but not implemented yet', { hint: 'use "agent-os update --relock" to rebuild the lock; follow #68: https://github.com/cosmin-sisman/agent-os/issues/68' })
  }
  const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  const keys = relock(ctx.cwd, { version })
  ctx.output({ items: keys }, `rebuilt .agent-os/lock.json: ${keys.length} managed item(s)`)
}
