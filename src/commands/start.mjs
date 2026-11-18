// `agent-os start <issue>`: claim it, branch from the right base, link the branch, mark it In Progress, check it out.

import { CliError, EXIT } from '../cli/errors.mjs'
import { loadConfig } from '../config/config.mjs'
import { createTracker } from '../tracker/tracker.mjs'
import { capabilitiesFor } from '../platform/probe.mjs'
import { startIssue, systemGit } from '../workflow/start.mjs'
import { lessonLines } from '../lessons/lessons.mjs'

export const usage = 'agent-os start <issue> [--hotfix] [--worktree] [--force] [--dry-run]'

export const options = {
  hotfix: { type: 'boolean', description: 'Branch from the production branch (urgent fix for production)' },
  worktree: { type: 'boolean', description: 'Check the branch out in its own worktree (.claude/worktrees/…), for parallel sessions' },
  force: { type: 'boolean', description: 'Start even though someone else is assigned (after they agreed)' },
}

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  const number = Number(String(ctx.positionals[0] ?? '').replace(/^#/, ''))
  if (!Number.isInteger(number) || number < 1) throw new CliError('which issue?', { hint: `usage: ${usage}` })
  const { merged } = loadConfig(ctx.cwd)
  const tracker = ctx.io.tracker ?? createTracker(merged, { gh: ctx.io.gh, glab: ctx.io.glab })
  const caps = (await capabilitiesFor(merged, { cwd: ctx.cwd, gh: ctx.io.gh, glab: ctx.io.glab })).capabilities
  const r = startIssue({ tracker, caps, config: merged, git: ctx.io.git ?? systemGit(ctx.cwd), cwd: ctx.cwd }, { number, hotfix: ctx.values.hotfix, worktree: ctx.values.worktree, force: ctx.values.force, dryRun: ctx.dryRun })
  for (const w of r.warnings ?? []) ctx.io.stderr(`agent-os: warning: ${w}\n`)
  if (!r.dryRun && r.started === false) { ctx.output(r, r.message); return EXIT.CHECK_FAILED }
  ctx.output(r, [`${r.dryRun ? 'would start' : 'started'} #${number} on ${r.branch} (from ${r.base})`, ...r.steps.map((s) => `  ${r.dryRun ? 'would ' : ''}${s}`), ...(r.lessons.length ? ['Lessons that apply here:', ...lessonLines(r.lessons)] : []), r.dryRun ? '' : 'Done means tested: add the tests the issue\'s scenarios describe in this branch.'].filter(Boolean).join('\n'))
  return EXIT.OK
}
