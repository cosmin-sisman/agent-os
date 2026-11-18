// `agent-os ingest`: `plan` reads the specifications (docs/, specs/… or the paths given) into epics and sub-issues
// that cite their source sections, and lists the contradictions between them; `apply` creates the issues only once
// every contradiction is resolved with the person (--resolve c1=a|b|both).

import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CliError, EXIT } from '../cli/errors.mjs'
import { loadConfig } from '../config/config.mjs'
import { label, languageFor } from '../i18n/i18n.mjs'
import { createTracker } from '../tracker/tracker.mjs'
import { PLAN_FILE, ingestApply, ingestPlan } from '../ingest/ingest.mjs'

export const usage = 'agent-os ingest plan [<file|folder>…]   ·   apply [--resolve <c1>=a|b|both…] [--milestone <m>] [--dry-run]'

export const options = {
  resolve: { type: 'string', multiple: true, description: 'apply: how the person resolved a contradiction: <id>=a (keep the first), b (keep the second) or both (no conflict)' },
  milestone: { type: 'string', description: 'apply: the milestone for the created issues' },
}

const quote = (s) => `${s.path}:${s.line} "${s.text}"`

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  const [action, ...paths] = ctx.positionals
  if (action === 'plan') {
    const plan = ingestPlan(ctx.cwd, paths)
    if (!ctx.dryRun) { mkdirSync(join(ctx.cwd, '.agent-os/cache'), { recursive: true }); writeFileSync(join(ctx.cwd, PLAN_FILE), `${JSON.stringify(plan, null, 2)}\n`) }
    ctx.output(plan, [
      `${plan.files.length} specification(s): ${plan.epics.length} epic(s), ${plan.issues} issue(s) in all`,
      ...plan.epics.flatMap((e) => [`\n${e.title}  (${e.source.path}:${e.source.line})`, ...e.children.map((k) => `  - ${k.title}  (${k.source.path}:${k.source.line})`)]),
      ...(plan.contradictions.length ? ['', `${plan.contradictions.length} contradiction(s): ask the person before creating any issue:`, ...plan.contradictions.map((c) => `  ${c.id} (${c.kind}): a) ${quote(c.a)}\n       b) ${quote(c.b)}`)] : []),
      '', plan.contradictions.length ? 'then: agent-os ingest apply --resolve <id>=a|b|both …' : 'review it with the person, then: agent-os ingest apply',
    ].join('\n'))
    return plan.contradictions.length ? EXIT.CHECK_FAILED : EXIT.OK
  }
  if (action === 'apply') {
    const file = join(ctx.cwd, PLAN_FILE)
    if (!existsSync(file)) throw new CliError('there is no ingest plan to apply', { hint: 'agent-os ingest plan docs/, review it, then agent-os ingest apply' })
    const plan = JSON.parse(readFileSync(file, 'utf8'))
    const resolve = {}
    for (const r of ctx.values.resolve ?? []) {
      const m = r.match(/^(c\d+)=(a|b|both)$/)
      if (!m) throw new CliError(`--resolve takes <id>=a|b|both, got "${r}"`)
      if (!plan.contradictions.some((c) => c.id === m[1])) throw new CliError(`no contradiction "${m[1]}" in the plan`)
      resolve[m[1]] = m[2]
    }
    const { merged } = loadConfig(ctx.cwd)
    const lang = languageFor(merged, 'labels')
    const tracker = ctx.io.tracker ?? createTracker(merged, { gh: ctx.io.gh, glab: ctx.io.glab })
    const r = ingestApply(plan, { tracker, resolve, milestone: ctx.values.milestone, lang: languageFor(merged, 'issues'), dryRun: ctx.dryRun, labels: { epic: [label('type:epic', lang).name], child: [label('type:feature', lang).name] } })
    if (r.blocked.length) {
      ctx.output(r, [`${r.blocked.length} contradiction(s) are not resolved: nothing was created. Ask the person:`, ...r.blocked.map((c) => `  ${c.id} (${c.kind}): a) ${quote(c.a)}\n       b) ${quote(c.b)}`), '', 'then: agent-os ingest apply --resolve <id>=a|b|both …'].join('\n'))
      return EXIT.CHECK_FAILED
    }
    ctx.output(r, [`${ctx.dryRun ? 'would create' : 'created'} ${r.created.length} issue(s)${r.dropped.length ? `; left out the statement(s) the person overruled: ${r.dropped.join(', ')}` : ''}`, ...r.created.map((c) => `  ${c.number ? `#${c.number}` : '-'} ${c.title}  (${c.source.path}:${c.source.line})`)].join('\n'))
    return EXIT.OK
  }
  throw new CliError(action ? `unknown action "${action}"` : 'which action?', { hint: `usage: ${usage}` })
}
