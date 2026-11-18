// `agent-os retrofit`: bring an existing repository's history into the system. `plan` writes a reviewable plan
// (.agent-os/retrofit/plan.json) and prints it; `apply` executes the reviewed plan, idempotently and rate-limited.
// Closed change requests are never rewritten.

import { CliError, EXIT } from '../cli/errors.mjs'
import { loadConfig } from '../config/config.mjs'
import { createTracker } from '../tracker/tracker.mjs'
import { systemGit } from '../workflow/start.mjs'
import { planPlatformSetup } from '../platform/setup.mjs'
import { applyRetrofit, loadPlan, planRetrofit, savePlan, PLAN_FILE } from '../retrofit/retrofit.mjs'

export const usage = 'agent-os retrofit plan [--dry-run]   ·   apply [--delay <ms>] [--dry-run]'

export const options = {
  delay: { type: 'string', description: 'apply: milliseconds between two writes to the platform (default 250)' },
}

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  const [action] = ctx.positionals
  const { merged } = loadConfig(ctx.cwd)
  const tracker = ctx.io.tracker ?? createTracker(merged, { gh: ctx.io.gh, glab: ctx.io.glab })
  const git = ctx.io.git ?? systemGit(ctx.cwd)
  if (action === 'plan') {
    const plan = planRetrofit({ tracker, git, config: merged, now: ctx.io.now ?? new Date() })
    const file = ctx.dryRun ? null : savePlan(ctx.cwd, plan)
    const lines = plan.steps.map((s) => `- ${s.id}: ${s.why}`)
    ctx.output({ ...plan, file }, `${plan.counts.prs} change request(s) (${plan.counts.closed} closed, never rewritten), ${plan.counts.issues} issue(s); ${plan.steps.length} step(s):\n${lines.join('\n')}\n\n${file ? `wrote ${file}: review it, then agent-os retrofit apply` : 'dry run: nothing written'}`)
    return EXIT.OK
  }
  if (action === 'apply') {
    const delayMs = ctx.values.delay === undefined ? 250 : Number(ctx.values.delay)
    if (!Number.isFinite(delayMs) || delayMs < 0) throw new CliError('--delay must be a number of milliseconds')
    const setupLabels = () => { for (const s of planPlatformSetup(merged, { gh: ctx.io.gh, glab: ctx.io.glab, only: ['labels'] }).filter((x) => x.action !== 'keep')) s.apply() }
    const r = await applyRetrofit({ tracker, cwd: ctx.cwd, config: merged, setupLabels: ctx.io.setupLabels ?? setupLabels, sleep: ctx.io.sleep, author: tracker.whoami?.() ?? undefined, now: ctx.io.now ?? new Date() }, loadPlan(ctx.cwd), { dryRun: ctx.dryRun, delayMs })
    ctx.output(r, `${r.dryRun ? 'would apply' : 'applied'} ${r.applied.length} step(s), skipped ${r.skipped.length} (already done or not applicable):\n${[...r.applied.map((a) => `  + ${a.id}: ${a.did}`), ...r.skipped.map((s) => `  = ${s.id}: ${s.why}`)].join('\n')}\n(plan: ${PLAN_FILE})`)
    return EXIT.OK
  }
  throw new CliError(action ? `unknown action "${action}"` : 'which action?', { hint: `usage: ${usage}` })
}
