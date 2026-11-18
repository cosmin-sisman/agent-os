// `agent-os map [path]`: one area of the code (headers, sizes, covering tests, recent changes), within a token budget.

import { EXIT } from '../cli/errors.mjs'
import { mapArea } from '../map/map.mjs'
import { systemGit } from '../workflow/start.mjs'

export const usage = 'agent-os map [path] [--budget <tokens>]'
export const options = { budget: { type: 'string', description: 'Most tokens to use (about 4 characters each; default 1500)' } }

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  const budget = ctx.values.budget === undefined ? 1500 : Math.max(100, Number(ctx.values.budget) || 1500)
  const r = mapArea({ cwd: ctx.cwd, git: ctx.io.git ?? systemGit(ctx.cwd) }, { path: ctx.positionals[0] ?? '.', budget })
  ctx.output(r, r.text)
  return EXIT.OK
}
