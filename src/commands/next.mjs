// `agent-os next`: what to work on, ranked from the platform's state, each with a one-line reason.

import { CliError, EXIT } from '../cli/errors.mjs'
import { loadConfig } from '../config/config.mjs'
import { createTracker } from '../tracker/tracker.mjs'
import { capabilitiesFor } from '../platform/probe.mjs'
import { recommend } from '../workflow/next.mjs'
import { systemGit } from '../workflow/start.mjs'

export const usage = 'agent-os next [--limit <n>]'

export const options = {
  limit: { type: 'string', description: 'How many recommendations (default 3)' },
}

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  const limit = ctx.values.limit === undefined ? 3 : Number(ctx.values.limit)
  if (!Number.isInteger(limit) || limit < 1) throw new CliError('--limit takes a whole number of at least 1')
  const { merged } = loadConfig(ctx.cwd)
  const tracker = ctx.io.tracker ?? createTracker(merged, { gh: ctx.io.gh })
  const caps = (await capabilitiesFor(merged, { cwd: ctx.cwd, gh: ctx.io.gh })).capabilities
  const r = recommend({ tracker, caps, git: ctx.io.git ?? systemGit(ctx.cwd) }, { limit })
  for (const w of r.warnings) ctx.io.stderr(`agent-os: warning: ${w}\n`)
  const lines = r.recommendations.length
    ? r.recommendations.map((p) => `${p.rank}. #${p.number} ${p.title}\n   ${p.reason}  →  ${p.action}`)
    : ['Nothing to pick up: no PR needs you, nothing is assigned to you, and the current milestone has no free issue.']
  if (r.excluded.length) lines.push(`Left out: ${r.excluded.map((e) => `#${e.number} (${e.reason})`).join('; ')}`)
  ctx.output(r, lines.join('\n'))
  return EXIT.OK
}
