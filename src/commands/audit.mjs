// `agent-os audit`: `plan` detects the subject of what was passed, picks the lenses by preset (adjustable) and prints
// one brief per lens for its own subagent; `merge` turns the lenses' JSON answers into one report, where a finding
// without evidence becomes a question. The /audit skill runs the lenses; nothing is created on the platform here.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CliError, EXIT } from '../cli/errors.mjs'
import { LENSES, SUBJECTS, detectSubject, lensBrief, lensesFor, mergeFindings } from '../audit/audit.mjs'

export const usage = 'agent-os audit plan "<what>" [--as <subject>] [--lens <add>…] [--no-lens <remove>…]   ·   merge <answer.json>…'

export const options = {
  as: { type: 'string', description: `plan: the subject, when the detected one is wrong (${SUBJECTS.join(', ')})` },
  lens: { type: 'string', multiple: true, description: `plan: add a lens (${Object.keys(LENSES).join(', ')})` },
  'no-lens': { type: 'string', multiple: true, description: 'plan: remove a lens' },
}

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  const [action, ...rest] = ctx.positionals
  if (action === 'plan') {
    const input = rest.join(' ')
    const d = detectSubject(input, { cwd: ctx.cwd })
    const subject = ctx.values.as ?? d.subject
    if (!SUBJECTS.includes(subject)) throw new CliError(`unknown subject "${subject}"`, { hint: SUBJECTS.join(', ') })
    const lenses = lensesFor(subject, { layers: d.layers, add: ctx.values.lens ?? [], remove: ctx.values['no-lens'] ?? [] })
    const briefs = lenses.map((l) => ({ lens: l, brief: lensBrief(l, { subject, input, layers: d.layers }) }))
    ctx.output({ input, subject, detected: d.subject, why: d.why, layers: d.layers, question: d.question, lenses, briefs }, [`subject: ${subject}${ctx.values.as ? ` (detected: ${d.subject})` : ''}: ${d.why}`, ...(d.layers.length ? [`layers: ${d.layers.join(', ')}`] : []), `confirm with the person: ${d.question}`, `lenses (${lenses.length}): ${lenses.join(', ')}`, '', 'run each lens in its own subagent with its brief (agent-os audit plan … --json gives them), save each answer as JSON, then agent-os audit merge <answers>'].join('\n'))
    return EXIT.OK
  }
  if (action === 'merge') {
    if (!rest.length) throw new CliError('which answers?', { hint: 'agent-os audit merge answers/*.json' })
    const answers = rest.map((f) => { try { return JSON.parse(readFileSync(resolve(ctx.cwd, f), 'utf8')) } catch { throw new CliError(`${f} is not a lens answer (JSON)`) } })
    const r = mergeFindings(answers)
    const lines = [
      `${r.findings.length} finding(s), ${r.questions.length} question(s), ${r.strengths.length} strength(s)`,
      ...r.findings.map((f) => `\n${f.severity.toUpperCase()} (${f.confidence}) ${f.title}  [${f.lenses.join(', ')}]\n  evidence: ${f.evidence.join('; ')}\n  recommendation: ${f.recommendation ?? '-'}${f.alternatives.length ? `\n  alternatives: ${f.alternatives.join('; ')}` : ''}`),
      ...(r.questions.length ? ['', 'questions (no evidence yet):', ...r.questions.map((q) => `  - [${q.lens}] ${q.question}`)] : []),
      ...(r.strengths.length ? ['', 'strengths:', ...r.strengths.map((s) => `  + [${s.lens}] ${s.strength}`)] : []),
      ...(r.problems.length ? ['', ...r.problems.map((p) => `note: ${p}`)] : []),
    ]
    ctx.output(r, lines.join('\n'))
    return EXIT.OK
  }
  throw new CliError(action ? `unknown action "${action}"` : 'which action?', { hint: `usage: ${usage}` })
}
