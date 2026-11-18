// `agent-os thread <N>`: the conversation on an issue or change request, read before acting. Its participants,
// language, the decisions made in comments (verbatim, highlighted) and the latest comments. Reads only.

import { CliError, EXIT } from '../cli/errors.mjs'
import { loadConfig } from '../config/config.mjs'
import { createTracker } from '../tracker/tracker.mjs'
import { readThread } from '../collab/thread.mjs'

export const usage = 'agent-os thread <#N | !N> [--json]   (!N or --change-request: a change request)'

export const options = {
  'change-request': { type: 'boolean', description: 'N is a change request (on GitLab, where issues and merge requests are numbered apart)' },
}

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  const raw = ctx.positionals[0]
  const n = Number(String(raw ?? '').replace(/^[#!]/, ''))
  if (!Number.isInteger(n) || n < 1) throw new CliError('which issue or change request?', { hint: `usage: ${usage}` })
  const { merged } = loadConfig(ctx.cwd)
  const tracker = ctx.io.tracker ?? createTracker(merged, { gh: ctx.io.gh, glab: ctx.io.glab })
  const t = readThread(tracker, n, { changeRequest: Boolean(ctx.values['change-request']) || String(raw).startsWith('!') })
  const lines = [
    `#${t.number} ${t.title ?? ''} (${t.kind}, ${t.state ?? '?'})`,
    `participants: ${t.participants.map((p) => `@${p}`).join(' ') || '-'}   language: ${t.language ?? 'unknown'}   comments: ${t.comments}${t.kind === 'change-request' ? `   open review threads: ${t.openReviewThreads}` : ''}`,
  ]
  if (t.decisions.length) {
    lines.push('', `DECISIONS (${t.decisions.length}), quote them verbatim in the journal entry (agent-os journal add … --thread ${raw}):`)
    for (const d of t.decisions) lines.push(`  ${d.text.split('\n').join('\n  ')}`, `    -- @${d.author ?? '?'}${d.at ? `, ${String(d.at).slice(0, 10)}` : ''}${d.url ? `, ${d.url}` : ''}`)
  } else lines.push('', 'no decisions recorded in the comments')
  if (t.last.length) lines.push('', 'latest:', ...t.last.map((c) => `  @${c.author}${c.at ? ` ${String(c.at).slice(0, 10)}` : ''}${c.language ? ` [${c.language}]` : ''}: ${c.excerpt}`))
  if (t.language) lines.push('', `reply in ${t.language}${t.language === 'ro' ? ' (ASCII, no diacritics)' : ''}; @mention only the participants`)
  ctx.output(t, lines.join('\n'))
  return EXIT.OK
}
