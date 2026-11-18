// `agent-os chronicle`: one timeline from the platform and the journal, rendered into the cache.

import { CliError, EXIT } from '../cli/errors.mjs'
import { loadConfig } from '../config/config.mjs'
import { CACHE_MD, chronicle, chronicleMarkdown, writeChronicle } from '../chronicle/chronicle.mjs'
import { vocabularyFor } from '../platform/vocabulary.mjs'
import { createTracker } from '../tracker/tracker.mjs'

export const usage = 'agent-os chronicle --since <YYYY-MM-DD> [--issue <n>] [--area <area>]'

export const options = {
  since: { type: 'string', description: 'From this date (YYYY-MM-DD) or time (ISO 8601)' },
  issue: { type: 'string', description: 'Only this issue and the change requests that close or reference it' },
  area: { type: 'string', description: 'Only issues, change requests and journal entries in this area' },
}

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  const v = ctx.values
  if (!v.since || Number.isNaN(Date.parse(v.since))) throw new CliError('--since is required: a date such as 2026-11-01', { hint: `usage: ${usage}` })
  const { merged } = loadConfig(ctx.cwd)
  const vocab = vocabularyFor(merged.platform?.type)
  const tracker = ctx.io.tracker ?? createTracker(merged, { gh: ctx.io.gh, glab: ctx.io.glab })
  const issue = v.issue ? Number(String(v.issue).replace(/^#/, '')) : undefined
  const c = chronicle({ tracker, cwd: ctx.cwd, vocab }, { since: v.since, issue, area: v.area })
  if (!ctx.dryRun) writeChronicle(ctx.cwd, c)
  ctx.output({ ...c, file: ctx.dryRun ? null : CACHE_MD }, `${chronicleMarkdown(c).trimEnd()}${ctx.dryRun ? '' : `\n\n(rendered into ${CACHE_MD}; never committed)`}`)
  return EXIT.OK
}
