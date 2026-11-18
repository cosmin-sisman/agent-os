// `agent-os orchestrate`: the optional per-laptop orchestrator. claim and release the role, brief a worker for an
// issue, record typed messages (BRIEF, ACK, QUESTION, UPDATE, DONE, REVISE, CLOSE), reconcile the ledger with the
// worktrees and change requests, and show it. The ledger is personal (.agent-os/cache/orchestrator.json).

import { CliError, EXIT } from '../cli/errors.mjs'
import { loadConfig } from '../config/config.mjs'
import { createTracker } from '../tracker/tracker.mjs'
import { systemGit } from '../workflow/start.mjs'
import { LEDGER, TYPES, brief, claim, message, readLedger, reconcile, release } from '../orchestrate/orchestrate.mjs'

export const usage = [
  'agent-os orchestrate status   ·   claim [--force]   ·   release   ·   reconcile',
  'agent-os orchestrate brief <issue> [--notes <text>]',
  `agent-os orchestrate message <${TYPES.filter((t) => t !== 'BRIEF').join('|')}> <worker|#issue> [--text <t>] [--pr <n>]`,
].join('\n')

export const options = {
  force: { type: 'boolean', description: 'claim: take the role from a session that is gone' },
  notes: { type: 'string', description: 'brief: extra notes for the worker (no secrets)' },
  text: { type: 'string', description: 'message: the message (no secrets, no permission requests)' },
  pr: { type: 'string', description: 'message: the change request a DONE refers to' },
}

const row = (w) => `  ${w.id}  #${w.issue}  ${w.state}${w.branch ? `  ${w.branch}` : ''}${w.pr ? `  PR ${w.pr}` : ''}`

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  const [action = 'status', a, b] = ctx.positionals
  const { merged } = loadConfig(ctx.cwd)
  const at = (ctx.io.now ?? new Date()).toISOString()
  if (action === 'status') {
    const l = readLedger(ctx.cwd)
    ctx.output(l, [`orchestrator: ${l.role ? `held by ${l.role.root} since ${l.role.claimedAt}` : 'not claimed'}${merged.orchestrator ? '' : ' (the role is off on this laptop: agent-os init --me --orchestrator)'}`, `workers (${l.workers.length}):`, ...(l.workers.length ? l.workers.map(row) : ['  none']), `ledger: ${LEDGER} (personal, never committed)`].join('\n'))
    return EXIT.OK
  }
  if (action === 'claim') { const l = claim(ctx.cwd, merged, { force: ctx.values.force, at }); ctx.output(l, `this session is the orchestrator (${l.role.root}): it briefs workers and does not edit`); return EXIT.OK }
  if (action === 'release') { const r = release(ctx.cwd); ctx.output(r, r.released ? 'released the orchestrator role' : 'the role was not held'); return EXIT.OK }
  if (action === 'brief') {
    const issue = Number(String(a ?? '').replace(/^#/, ''))
    let title = null
    try { title = (ctx.io.tracker ?? createTracker(merged, { gh: ctx.io.gh, glab: ctx.io.glab })).get(issue).title } catch { /* offline: the brief names the number */ }
    const r = brief(ctx.cwd, merged, { issue, title, notes: ctx.values.notes, at })
    ctx.output(r, `briefed ${r.worker.id}. Give this to the worker session:\n\n${r.text}`)
    return EXIT.OK
  }
  if (action === 'message') {
    if (!a || !b) throw new CliError('message needs a type and a worker', { hint: `usage: ${usage}` })
    const r = message(ctx.cwd, merged, { type: a.toUpperCase(), worker: b, text: ctx.values.text ?? '', pr: ctx.values.pr ? Number(ctx.values.pr) : undefined, at })
    ctx.output(r, `${a.toUpperCase()} recorded: ${r.worker.id} is ${r.worker.state}`)
    return EXIT.OK
  }
  if (action === 'reconcile') {
    const r = reconcile(ctx.cwd, { git: ctx.io.git ?? systemGit(ctx.cwd), tracker: ctx.io.tracker ?? createTracker(merged, { gh: ctx.io.gh, glab: ctx.io.glab }) })
    ctx.output(r, [r.changes.length ? r.changes.map((c) => `  ${c.id}: ${c.from} → ${c.to}`).join('\n') : '  no change', `workers (${r.workers.length}):`, ...(r.workers.length ? r.workers.map(row) : ['  none'])].join('\n'))
    return EXIT.OK
  }
  throw new CliError(`unknown action "${action}"`, { hint: `usage: ${usage}` })
}
