// `agent-os decision`: create a decision record with a date-based id, list them (rendered, never committed), check them.

import { CliError, EXIT } from '../cli/errors.mjs'
import { loadConfig } from '../config/config.mjs'
import { languageFor } from '../i18n/i18n.mjs'
import { checkDecisions, newDecision, readDecisions, stateOf } from '../decisions/decisions.mjs'

export const usage = 'agent-os decision new <slug> --title "<the decision>" [--supersedes <id>] [--accepted] [--dry-run] | list | check'

export const options = {
  title: { type: 'string', description: 'new: the decision in a few words' },
  supersedes: { type: 'string', description: 'new: the record this one replaces (its status is pointed here)' },
  accepted: { type: 'boolean', description: 'new: start as accepted instead of proposed' },
}

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  const [action = 'list', slug] = ctx.positionals
  if (action === 'new') {
    if (!slug && !ctx.values.title) throw new CliError('which decision?', { hint: `usage: ${usage}` })
    const { merged } = loadConfig(ctx.cwd)
    const r = newDecision(ctx.cwd, { slug, title: ctx.values.title, lang: languageFor(merged, 'docs'), supersedes: ctx.values.supersedes, accepted: ctx.values.accepted, now: ctx.io.now ?? new Date(), dryRun: ctx.dryRun })
    ctx.output(r, `${r.dryRun ? 'would ' : ''}${r.steps.join('; ')}`)
    return EXIT.OK
  }
  if (action === 'list') {
    const records = readDecisions(ctx.cwd).map((d) => ({ id: d.id, title: d.title, state: stateOf(d.statusLine), path: d.path }))
    ctx.output({ records }, records.length ? records.map((d) => `${d.id}  [${d.state ?? '?'}]  ${d.title ?? ''}`).join('\n') : 'no decision records yet')
    return EXIT.OK
  }
  if (action === 'check') {
    const r = checkDecisions(ctx.cwd)
    ctx.output(r, r.problems.length ? `${r.problems.length} problem(s):\n${r.problems.map((p) => `  ${p.path}: ${p.message}\n    fix: ${p.fix}`).join('\n')}` : `decisions: ${r.records} record(s), all valid`)
    return r.problems.length ? EXIT.CHECK_FAILED : EXIT.OK
  }
  throw new CliError(`unknown action "${action}"`, { hint: `usage: ${usage}` })
}
