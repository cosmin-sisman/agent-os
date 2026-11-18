// `agent-os board`: the optional planning board. `sync` keeps Status, Priority and Size in step with the issues,
// `plan` shows what sync would change, `create` sets up a new board (the person decides; --dry-run shows it).

import { CliError, EXIT } from '../cli/errors.mjs'
import { loadConfig } from '../config/config.mjs'
import { BOARD_FIELDS, applyBoardSync, planBoardSync } from '../board/board.mjs'
import { createTracker } from '../tracker/tracker.mjs'

export const usage = 'agent-os board plan [--issue <n>] | sync [--issue <n>] [--dry-run] | create --title "<title>" [--dry-run]'

export const options = {
  issue: { type: 'string', description: 'plan/sync: only this issue' },
  title: { type: 'string', description: 'create: the board title' },
}

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  const [action = 'plan'] = ctx.positionals
  const { merged } = loadConfig(ctx.cwd)
  const tracker = ctx.io.tracker ?? createTracker(merged, { gh: ctx.io.gh, glab: ctx.io.glab })
  // Boards with their own fields are a tracker capability; where a board lists issues by labels there is nothing to sync.
  if (!tracker.boardItems) throw new CliError('this platform\'s board lists issues by their status:: label; there is nothing to sync', { hint: 'agent-os issue status <n> <status> sets the label' })
  if (action === 'create') {
    if (!ctx.values.title) throw new CliError('--title is required')
    if (merged.platform?.board?.number) throw new CliError(`agent-os.json already points at board ${merged.platform.board.number}`, { hint: 'sync it with agent-os board sync; a second board would split the planning' })
    const r = tracker.createBoard({ title: ctx.values.title, fields: BOARD_FIELDS }, { dryRun: ctx.dryRun })
    ctx.output(r, `${r.dryRun ? 'would:' : `created board #${r.number}: ${r.url}\nthen set it: agent-os config set platform.board.number ${r.number}`}\n${r.steps.map((s) => `  ${s}`).join('\n')}`)
    return EXIT.OK
  }
  if (!['plan', 'sync'].includes(action)) throw new CliError(`unknown action "${action}"`, { hint: `usage: ${usage}` })
  const only = ctx.values.issue ? Number(String(ctx.values.issue).replace(/^#/, '')) : undefined
  const plan = planBoardSync(tracker, { only })
  for (const w of plan.warnings) ctx.io.stderr(`agent-os: warning: ${w}\n`)
  if (plan.skipped) { ctx.output(plan, 'board skipped (see the warning); every other command works without it'); return EXIT.OK }
  const lines = plan.changes.map((c) => `  #${c.number} ${c.field}: ${c.from ?? '(not on the board)'} → ${c.to}`)
  const dry = action === 'plan' || ctx.dryRun
  const r = dry ? null : applyBoardSync(tracker, plan)
  ctx.output({ ...plan, applied: r?.applied ?? 0 }, [plan.changes.length ? `${dry ? 'would change' : 'changed'} ${plan.changes.length} value(s):` : 'the board is in step with the issues', ...lines, ...plan.missing.map((m) => `  note: ${m}`)].join('\n'))
  return EXIT.OK
}
