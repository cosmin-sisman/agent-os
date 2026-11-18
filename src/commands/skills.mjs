// `agent-os skills`: the skill index, core, external and local, rendered from the registry and the folders.

import { EXIT } from '../cli/errors.mjs'
import { indexMarkdown, skillIndex } from '../registry/skill-index.mjs'

export const usage = 'agent-os skills [--json]'
export const options = {}

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  const index = skillIndex(ctx.cwd)
  ctx.output(index, indexMarkdown(index))
  return EXIT.OK
}
