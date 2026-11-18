// `agent-os ship [<n>]`: merge a green, reviewed change request into the integration branch, close or comment on its
// issues, and clean up its branch and worktree. Exit 1 (and, for the author's problems, a comment) when it is not ready.

import { CliError, EXIT } from '../cli/errors.mjs'
import { loadConfig } from '../config/config.mjs'
import { languageFor } from '../i18n/i18n.mjs'
import { capabilitiesFor } from '../platform/probe.mjs'
import { vocabularyFor } from '../platform/vocabulary.mjs'
import { createTracker } from '../tracker/tracker.mjs'
import { ship } from '../workflow/ship.mjs'
import { systemGit } from '../workflow/start.mjs'

export const usage = 'agent-os ship [<n>] [--no-notify] [--keep-branch] [--dry-run]'

export const options = {
  'no-notify': { type: 'boolean', description: 'Do not comment to the author when the change request is behind or conflicting' },
  'keep-branch': { type: 'boolean', description: 'Do not delete the branch and its worktree after merging' },
}

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  const { merged } = loadConfig(ctx.cwd)
  const git = ctx.io.git ?? systemGit(ctx.cwd)
  const tracker = ctx.io.tracker ?? createTracker(merged, { gh: ctx.io.gh, glab: ctx.io.glab })
  const vocab = vocabularyFor(merged.platform?.type)
  let number = Number(String(ctx.positionals[0] ?? '').replace(/^[#!]/, ''))
  if (!ctx.positionals[0]) {
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()
    number = tracker.pullRequestFor(branch)?.number
    if (!number) throw new CliError(`${branch} has no open ${vocab.changeRequest}`, { hint: `usage: ${usage}` })
  }
  if (!Number.isInteger(number) || number < 1) throw new CliError(`"${ctx.positionals[0]}" is not a number`)
  const caps = (await capabilitiesFor(merged, { cwd: ctx.cwd, gh: ctx.io.gh, glab: ctx.io.glab })).capabilities
  const r = ship({ config: merged, tracker, caps, git, vocab }, { number, issuesLang: languageFor(merged, 'issues'), prsLang: languageFor(merged, 'prs'), notify: !ctx.values['no-notify'], keepBranch: ctx.values['keep-branch'], dryRun: ctx.dryRun })
  for (const w of r.warnings ?? []) ctx.io.stderr(`agent-os: warning: ${w}\n`)
  const cr = `${vocab.cr} ${vocab.crRef}${number}`
  if (r.dryRun) { ctx.output(r, `would:\n${r.steps.map((s) => `  ${s}`).join('\n')}`); return EXIT.OK }
  if (!r.shipped) {
    ctx.output(r, `${cr} is not ready:\n${r.problems.map((p) => `  - ${p.problem}`).join('\n')}${r.notified ? '\nThe author was asked to update it.' : ''}`)
    return EXIT.CHECK_FAILED
  }
  ctx.output(r, [`shipped ${cr} (${String(r.sha).slice(0, 7)})`, ...r.issues.map((i) => `  #${i.number}: ${i.action}`), ...r.cleanup.map((c) => `  ${c}`)].join('\n'))
  return EXIT.OK
}
