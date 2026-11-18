// `agent-os eject <path>`: stop managing a file (or one block or hooks entry), so updates never touch it again.
// The content in the project stays exactly as it is; only the lock entry and the merge base are removed.

import { CliError } from '../cli/errors.mjs'
import { eject } from '../managed/managed.mjs'

export const usage = 'agent-os eject <path | path#block-id | path#hooks>'

/** @param {import('../cli/context.mjs').Context} ctx */
export function run(ctx) {
  const target = ctx.positionals[0]
  if (!target) throw new CliError('missing path', { hint: `usage: ${usage}` })
  const keys = eject(ctx.cwd, target.replace(/\\/g, '/'), { dryRun: ctx.dryRun })
  ctx.output({ ejected: keys, dryRun: ctx.dryRun }, `${ctx.dryRun ? 'would eject' : 'ejected'}: ${keys.join(', ')}\nthe content stays as it is; agent-os updates will no longer touch it`)
}
