// The decision procedure of the standards (design §22): name two or three candidates, compare them, pick one with a
// reason in one sentence, and record it when it is hard to reverse. This makes the procedure checkable: a choice with
// one option, a pick outside the options, or a reason that is not one sentence is refused.

import { CliError } from '../cli/errors.mjs'

export const CRITERIA = ['correctness', 'simplicity', 'fit', 'performance', 'testability', 'cost of change']

/**
 * Validates and shapes a choice.
 * @param {{ options: string[], pick: string, why: string, criteria?: Record<string, string> }} input options as "id: description"
 */
export function makeChoice({ options, pick, why, criteria = {} }) {
  const parsed = (options ?? []).map((o) => { const m = String(o).match(/^\s*([\w-]+)\s*:\s*(.+)$/); if (!m) throw new CliError(`option "${o}" must be "<id>: <one line>"`); return { id: m[1], text: m[2].trim() } })
  if (parsed.length < 2) throw new CliError('name at least two candidates (--option "a: …" --option "b: …"): a choice with one option is not a choice')
  if (parsed.length > 3) throw new CliError('name two or three candidates, not more: drop the ones that are clearly worse first')
  if (new Set(parsed.map((o) => o.id)).size !== parsed.length) throw new CliError('each candidate needs its own id')
  const chosen = parsed.find((o) => o.id === pick)
  if (!chosen) throw new CliError(`--pick must be one of ${parsed.map((o) => o.id).join(', ')}`)
  const reason = String(why ?? '').trim()
  if (!reason) throw new CliError('--why is required: the reason, in one sentence')
  if (/\n/.test(reason) || (reason.match(/[.!?](\s|$)/g) ?? []).length > 1 || reason.length > 240) throw new CliError('the reason must be one sentence (one line, at most 240 characters)')
  const unknown = Object.keys(criteria).filter((c) => !CRITERIA.includes(c))
  if (unknown.length) throw new CliError(`unknown criteria: ${unknown.join(', ')}`, { hint: CRITERIA.join(', ') })
  return { options: parsed, chosen, why: reason.replace(/([^.!?])$/, '$1.'), criteria, rejected: parsed.filter((o) => o.id !== pick) }
}

/** The choice as Markdown, for the change request or a decision record. */
export function choiceMarkdown(c) {
  return [
    ...c.options.map((o) => `- **${o.id}**: ${o.text}${o.id === c.chosen.id ? ' ← chosen' : ''}`),
    ...(Object.keys(c.criteria).length ? ['', ...Object.entries(c.criteria).map(([k, v]) => `- ${k}: ${v}`)] : []),
    '',
    `**Choice: ${c.chosen.id}.** ${c.why}`,
    `Only ${c.chosen.id} is implemented; ${c.rejected.map((o) => o.id).join(' and ')} ${c.rejected.length > 1 ? 'are' : 'is'} not.`,
  ].join('\n')
}
