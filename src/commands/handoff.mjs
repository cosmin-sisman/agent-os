// `agent-os handoff`: a status comment on each issue you hold with work in flight, and one handoff journal entry.

import { CliError, EXIT } from '../cli/errors.mjs'
import { loadConfig } from '../config/config.mjs'
import { handoff } from '../collab/handoff.mjs'
import { languageFor } from '../i18n/i18n.mjs'
import { vocabularyFor } from '../platform/vocabulary.mjs'
import { createTracker } from '../tracker/tracker.mjs'
import { systemGit } from '../workflow/start.mjs'

export const usage = 'agent-os handoff [--next <issue>="<what comes next>"…] [--summary "<text>"] [--dry-run]'
export const options = {
  next: { type: 'string', multiple: true, description: '<issue>=<next steps> for that issue (repeat)' },
  summary: { type: 'string', description: 'One line for the journal entry' },
}

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  const { merged } = loadConfig(ctx.cwd)
  const tracker = ctx.io.tracker ?? createTracker(merged, { gh: ctx.io.gh, glab: ctx.io.glab })
  const notes = {}
  for (const p of ctx.values.next ?? []) {
    const m = p.match(/^#?(\d+)=(.+)$/)
    if (!m) throw new CliError(`--next "${p}" must be <issue>=<next steps>`)
    notes[Number(m[1])] = m[2].trim()
  }
  const me = tracker.whoami()
  if (!me) throw new CliError('could not tell who you are', { hint: 'log in to the platform first' })
  const r = handoff({ tracker, git: ctx.io.git ?? systemGit(ctx.cwd), cwd: ctx.cwd, vocab: vocabularyFor(merged.platform?.type) }, { me, lang: languageFor(merged, 'issues'), notes, summary: ctx.values.summary, dryRun: ctx.dryRun, now: ctx.io.now ?? new Date() })
  ctx.output(r, r.comments.length
    ? [`${r.dryRun ? 'would comment on' : 'commented on'} ${r.comments.length} issue(s) you hold with work in flight${r.journal ? `; journal: ${r.journal}` : ''}:`, ...r.comments.map((c) => `\n#${c.number} ${c.title}\n${c.body}`)].join('\n')
    : `no issue assigned to you has work in flight (a pushed branch or an open change request); nothing to hand off${r.journal ? `; journal: ${r.journal}` : ''}`)
  return EXIT.OK
}
