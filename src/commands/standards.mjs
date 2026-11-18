// `agent-os standards choice`: record a choice between solutions the way the standards ask (two or three candidates,
// one picked, the reason in one sentence), optionally as a decision record.

import { CliError, EXIT } from '../cli/errors.mjs'
import { loadConfig } from '../config/config.mjs'
import { newDecision } from '../decisions/decisions.mjs'
import { languageFor } from '../i18n/i18n.mjs'
import { choiceMarkdown, makeChoice } from '../standards/choice.mjs'

export const usage = 'agent-os standards choice --title "<the question>" --option "<id>: <one line>" --option "<id>: <one line>" --pick <id> --why "<one sentence>" [--criterion <name>="<note>"…] [--record <slug>]'
export const options = {
  title: { type: 'string', description: 'choice: the question being decided' },
  option: { type: 'string', multiple: true, description: 'choice: "<id>: <one line>" (two or three)' },
  pick: { type: 'string', description: 'choice: the id of the chosen candidate' },
  why: { type: 'string', description: 'choice: the reason, in one sentence' },
  criterion: { type: 'string', multiple: true, description: 'choice: <criterion>=<note> (correctness, simplicity, fit, performance, testability, cost of change)' },
  record: { type: 'string', description: 'choice: also write a decision record with this slug (for choices that are hard to reverse)' },
}

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  const [action] = ctx.positionals
  if (action !== 'choice') throw new CliError(action ? `unknown action "${action}"` : 'which action?', { hint: `usage: ${usage}` })
  const v = ctx.values
  const criteria = Object.fromEntries((v.criterion ?? []).map((p) => { const i = p.indexOf('='); if (i < 1) throw new CliError(`--criterion "${p}" must be <name>=<note>`); return [p.slice(0, i).trim(), p.slice(i + 1).trim()] }))
  const c = makeChoice({ options: v.option, pick: v.pick, why: v.why, criteria })
  const md = choiceMarkdown(c)
  let record = null
  if (v.record) {
    if (!v.title) throw new CliError('--title is required with --record')
    const { merged } = loadConfig(ctx.cwd)
    const r = newDecision(ctx.cwd, { slug: v.record, title: v.title, lang: languageFor(merged, 'docs'), accepted: true, dryRun: ctx.dryRun, now: ctx.io.now ?? new Date() })
    if (!ctx.dryRun) {
      const { readFileSync, writeFileSync } = await import('node:fs')
      const { join } = await import('node:path')
      const file = join(ctx.cwd, r.path)
      writeFileSync(file, readFileSync(file, 'utf8').replace(/(## (Decision|Decizie)\n)[\s\S]*?(\n## )/, `$1${md}\n$3`))
    }
    record = r.path
  }
  ctx.output({ ...c, markdown: md, record }, `${v.title ? `${v.title}\n\n` : ''}${md}${record ? `\n\n${ctx.dryRun ? 'would record' : 'recorded'} in ${record}` : ''}`)
  return EXIT.OK
}
