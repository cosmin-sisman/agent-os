// `agent-os retro`: plan (proposals for every inbox lesson and repeated review findings), apply (the decisions, and the
// counters from the journal), issue (open, update or close the one Retro issue; the scheduled workflow runs it).

import { CliError, EXIT } from '../cli/errors.mjs'
import { loadConfig } from '../config/config.mjs'
import { applyRetro, retroIssueBody, retroPlan } from '../retro/retro.mjs'
import { createTracker } from '../tracker/tracker.mjs'
import { systemGit } from '../workflow/start.mjs'

export const usage = 'agent-os retro plan [--recent <n>] [--offline] | apply [--accept <id>…] [--promote <id>=<rule>…] [--reject <id>=<reason>…] | issue [--dry-run]'

export const options = {
  recent: { type: 'string', description: 'plan: look for repeated review findings in the last n merged change requests (default 10)' },
  offline: { type: 'boolean', description: 'plan: the inbox only, no review findings' },
  accept: { type: 'string', multiple: true, description: 'apply: keep this lesson as an active card' },
  promote: { type: 'string', multiple: true, description: 'apply: <id>=<rule file: section> it became' },
  reject: { type: 'string', multiple: true, description: 'apply: <id>=<reason>' },
}

const pairs = (list = []) => Object.fromEntries(list.map((p) => { const i = p.indexOf('='); if (i < 1) throw new CliError(`"${p}" must be <id>=<text>`); return [p.slice(0, i), p.slice(i + 1).trim()] }))
const TITLE = 'Retro: lessons to triage'

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  const [action] = ctx.positionals
  const { merged } = loadConfig(ctx.cwd)
  const tracker = () => ctx.io.tracker ?? createTracker(merged, { gh: ctx.io.gh, glab: ctx.io.glab })
  const plan = () => {
    const n = ctx.values.recent === undefined ? 10 : Number(ctx.values.recent)
    const git = ctx.io.git ?? systemGit(ctx.cwd)
    const log = git(['log', '-n', '200', '--format=%s'])
    const recent = log.status === 0 ? [...new Set(log.stdout.split(/\r?\n/).map((s) => Number(s.match(/\((?:#|!)(\d+)\)$/)?.[1])).filter(Boolean))].slice(0, n) : []
    let t = null
    if (!ctx.values.offline && merged.platform?.project) { try { t = tracker() } catch { t = null } }
    return retroPlan({ cwd: ctx.cwd, tracker: t, recent })
  }
  if (action === 'plan') {
    const p = plan()
    ctx.output(p, [`${p.inbox} lesson(s) in the inbox, in ${p.themes.length} theme(s).`, ...p.proposals.map((x) => `  ${x.id ?? `finding "${x.finding}"`}: ${x.action}: ${x.reason}`), 'Decide each with agent-os retro apply --accept/--promote/--reject.'].join('\n'))
    return EXIT.OK
  }
  if (action === 'apply') {
    const r = applyRetro(ctx.cwd, { accept: ctx.values.accept ?? [], promote: pairs(ctx.values.promote), reject: pairs(ctx.values.reject) }, { dryRun: ctx.dryRun })
    ctx.output(r, [...r.done.map((d) => `  ${d.id}: ${d.action}${d.promotedTo ? ` (${d.promotedTo})` : d.reason ? ` (${d.reason})` : ''}`), r.dryRun ? 'dry run: nothing was written' : `counters updated on ${Object.keys(r.counters).length} active card(s)`].join('\n'))
    return EXIT.OK
  }
  if (action === 'issue') {
    const p = plan()
    const t = tracker()
    const existing = (t.search(`"${TITLE}" in:title state:open`, { limit: 5 }) ?? []).find((i) => i.title === TITLE && i.state === 'open')
    const step = p.inbox === 0 ? (existing ? `close #${existing.number}: the inbox is empty` : 'nothing to do: the inbox is empty') : existing ? `update #${existing.number}` : `open "${TITLE}"`
    if (ctx.dryRun) { ctx.output({ dryRun: true, step, body: retroIssueBody(p) }, `would ${step}\n\n${retroIssueBody(p)}`); return EXIT.OK }
    if (p.inbox === 0) { if (existing) t.update(existing.number, { state: 'closed' }); ctx.output({ step }, step); return EXIT.OK }
    const r = existing ? t.update(existing.number, { body: retroIssueBody(p) }) : t.create({ title: TITLE, body: retroIssueBody(p), labels: ['type:chore'] })
    ctx.output({ step, issue: existing?.number ?? r.number }, `${step}${r.url ? `: ${r.url}` : ''}`)
    return EXIT.OK
  }
  throw new CliError(action ? `unknown action "${action}"` : 'which action?', { hint: `usage: ${usage}` })
}
