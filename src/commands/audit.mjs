// `agent-os audit`: `plan` detects the subject of what was passed, picks the lenses by preset (adjustable) and prints
// one brief per lens for its own subagent; `merge` turns the lenses' JSON answers into one report, where a finding
// without evidence becomes a question; `report` writes the audit artifact at the audited commit, compared with the
// previous audit of the same subject; `propose` drafts issues for the accepted findings; `verify` checks the commit.
// The /audit skill runs the lenses and files issues through /ticket on confirmation; nothing here calls the platform.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CliError, EXIT } from '../cli/errors.mjs'
import { LENSES, SUBJECTS, detectSubject, lensBrief, lensesFor, mergeFindings } from '../audit/audit.mjs'
import { auditData, auditSlug, previousAudit, proposeIssues, verifyAudit } from '../audit/outputs.mjs'
import { newArtifact } from '../artifacts/artifact.mjs'
import { buildArtifact } from '../artifacts/build.mjs'
import { languageFor } from '../i18n/i18n.mjs'
import { loadConfig } from '../config/config.mjs'
import { systemGit } from '../workflow/start.mjs'

export const usage = [
  'agent-os audit plan "<what>" [--as <subject>] [--lens <add>…] [--no-lens <remove>…]   ·   merge <answer.json>…',
  'agent-os audit report --plan <plan.json> <answer.json>… [--title <t>] [--dry-run]   (the artifact, compared with the previous audit)',
  'agent-os audit propose <artifact-id> [--accept <n>…]   ·   verify <artifact-id>',
].join('\n')

export const options = {
  as: { type: 'string', description: `plan: the subject, when the detected one is wrong (${SUBJECTS.join(', ')})` },
  lens: { type: 'string', multiple: true, description: `plan: add a lens (${Object.keys(LENSES).join(', ')})` },
  'no-lens': { type: 'string', multiple: true, description: 'plan: remove a lens' },
  plan: { type: 'string', description: 'report: the saved output of audit plan --json' },
  title: { type: 'string', description: 'report: the artifact title' },
  accept: { type: 'string', multiple: true, description: 'propose: a finding number the person accepted (repeat)' },
}

const readJson = (ctx, f, what) => { try { return JSON.parse(readFileSync(resolve(ctx.cwd, f), 'utf8')) } catch { throw new CliError(`${f} is not ${what} (JSON)`) } }
const git = (ctx) => ctx.io.git ?? systemGit(ctx.cwd)

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
    const answers = rest.map((f) => readJson(ctx, f, 'a lens answer'))
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
  if (action === 'report') {
    if (!ctx.values.plan) throw new CliError('which plan?', { hint: 'agent-os audit plan "<what>" --json > plan.json, then agent-os audit report --plan plan.json answers/*.json' })
    if (!rest.length) throw new CliError('which answers?', { hint: 'agent-os audit report --plan plan.json answers/*.json' })
    const raw = readJson(ctx, ctx.values.plan, 'an audit plan')
    const plan = raw.result ?? raw
    if (!SUBJECTS.includes(plan.subject) || !Array.isArray(plan.lenses) || typeof plan.input !== 'string') throw new CliError(`${ctx.values.plan} is not the output of agent-os audit plan --json`)
    const report = mergeFindings(rest.map((f) => readJson(ctx, f, 'a lens answer')))
    const head = git(ctx)(['rev-parse', 'HEAD'])
    const commit = head.status === 0 ? String(head.stdout).trim() : null
    const now = ctx.io.now ?? new Date()
    const lang = languageFor(loadConfig(ctx.cwd).merged, 'docs')
    const previous = previousAudit(ctx.cwd, plan)
    const data = auditData(report, { subject: plan.subject, input: plan.input, lenses: plan.lenses, commit, lang, title: ctx.values.title, now, previous })
    const r = newArtifact(ctx.cwd, { type: 'audit', slug: auditSlug(plan.input), title: data.title, now, lang, data, dryRun: ctx.dryRun })
    if (!ctx.dryRun) buildArtifact(ctx.cwd, r.id)
    const c = data.audit.comparison
    ctx.output({ ...r, commit, previous: previous?.id ?? null, comparison: c, findings: report.findings.length, questions: report.questions.length, strengths: report.strengths.length }, [
      `${r.dryRun ? 'would create' : 'created'} ${r.folder}/ (audit${commit ? ` at ${commit.slice(0, 12)}` : ', no commit'}): ${report.findings.length} finding(s), ${report.questions.length} question(s), ${report.strengths.length} strength(s)`,
      ...(c ? [`compared with ${previous.id}:`, ...['fixed', 'new', 'worse', 'better'].map((k) => `  ${k} (${c[k].length})${c[k].length ? `: ${c[k].map((f) => f.title).join('; ')}` : ''}`)] : ['the first audit of this subject']),
      '', 'nothing was filed: agent-os audit propose <id> --accept <n>… drafts issues for the findings the person accepts',
    ].join('\n'))
    return EXIT.OK
  }
  if (action === 'propose') {
    const [id] = rest
    if (!id) throw new CliError('which audit?', { hint: 'agent-os audit propose <artifact-id> --accept 1 --accept 3' })
    const audit = readJson(ctx, `artifacts/${id}/data.json`, 'an audit artifact').audit
    if (!audit) throw new CliError(`${id} is not an audit artifact`)
    const accept = (ctx.values.accept ?? []).map((n) => { const x = Number(n); if (!Number.isInteger(x) || x < 1) throw new CliError(`--accept takes a finding number, got "${n}"`); return x })
    const r = proposeIssues(audit, { accept, artifact: id })
    ctx.output(r, r.confirmed ? [...(r.epic ? [`one epic: ${r.epic.title} [${r.epic.labels.join(', ')}], with the ${r.drafts.length} issues below as sub-issues`] : []), ...r.drafts.map((d) => `#${d.finding} → ${d.title} [${d.labels.join(', ')}]`), '', r.note].join('\n') : r.note)
    return EXIT.OK
  }
  if (action === 'verify') {
    const [id] = rest
    if (!id) throw new CliError('which audit?', { hint: 'agent-os audit verify <artifact-id>' })
    const r = verifyAudit(ctx.cwd, id, { git: git(ctx) })
    ctx.output(r, r.ok ? `${id}: audited at ${r.commit.slice(0, 12)}${r.commitsSince ? `, ${r.commitsSince} commit(s) since: the findings may be out of date` : ', the current commit'}` : `${id}: ${r.problem}`)
    return r.ok ? EXIT.OK : EXIT.CHECK_FAILED
  }
  throw new CliError(action ? `unknown action "${action}"` : 'which action?', { hint: `usage: ${usage}` })
}
