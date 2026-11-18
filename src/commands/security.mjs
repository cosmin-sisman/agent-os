// `agent-os security`: `watch` keeps track of the advisories that touch the dependencies (only package names and
// versions leave the project; off by default on a self-managed host); `pass` is the security pass on a change: the
// checklists of the layers it touches, the problems its files show, and the scanner reports the project produced;
// `threat-model` creates or refreshes the living STRIDE threat model from stack.yaml; `exercise` walks a tabletop
// incident against the runbooks. Exercises are text only: nothing is run, nothing is filed.

import { CliError, EXIT } from '../cli/errors.mjs'
import { loadConfig } from '../config/config.mjs'
import { languageFor } from '../i18n/i18n.mjs'
import { createTracker } from '../tracker/tracker.mjs'
import { inventory } from '../security/packages.mjs'
import { childFetch, plannedRequests, queryAdvisories, watchSettings } from '../security/advisories.mjs'
import { MARKER, TITLE, digestBody, prioritize, saveCache } from '../security/digest.mjs'
import { securityPass } from '../security/pass.mjs'
import { changedFiles } from '../gate/gate.mjs'
import { systemGit } from '../workflow/start.mjs'
import { EXERCISES, exercise, refreshThreatModel } from '../security/threats.mjs'

export const usage = 'agent-os security watch [--issue] [--dry-run]   ·   pass [--base <branch>] [--report <sarif|gitleaks.json>…]   ·   threat-model [--force] [--dry-run]   ·   exercise [<name>]'

export const options = {
  issue: { type: 'boolean', description: 'watch: create or update the one Security digest issue' },
  base: { type: 'string', description: 'pass: the branch to compare with (default branches.integration)' },
  report: { type: 'string', multiple: true, description: 'pass: a scanner report to read (SARIF, gitleaks JSON); adds to security.reports' },
  force: { type: 'boolean', description: 'threat-model: regenerate even when it is current' },
}

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  const [action] = ctx.positionals
  const { merged } = loadConfig(ctx.cwd)
  if (action === 'pass') return pass(ctx, merged)
  if (action === 'threat-model') {
    const r = refreshThreatModel(ctx.cwd, { lang: languageFor(merged, 'docs'), now: ctx.io.now ?? new Date(), dryRun: ctx.dryRun, force: ctx.values.force })
    const verb = { current: 'is current', create: 'would be created', refresh: 'would be refreshed', created: 'created', refreshed: 'refreshed from stack.yaml' }[r.action]
    ctx.output(r, [`threat model ${r.id} ${verb}: ${r.model.threats.length} threat(s) over ${r.model.layers.length} layer(s), ${r.model.flows.length} data flow(s)`, ...(r.model.uncovered.length ? [`not modelled (no layer group): ${r.model.uncovered.join(', ')}`] : [])].join('\n'))
    return EXIT.OK
  }
  if (action === 'exercise') {
    const [, name] = ctx.positionals
    if (!name) { ctx.output({ exercises: Object.entries(EXERCISES).map(([id, e]) => ({ id, title: e.title })) }, ['tabletop exercises (agent-os security exercise <name>):', ...Object.entries(EXERCISES).map(([id, e]) => `  ${id}: ${e.title}`)].join('\n')); return EXIT.OK }
    const r = exercise(ctx.cwd, name)
    ctx.output(r, [r.title, `runbooks: ${r.runbooks.length ? r.runbooks.join(', ') : 'none found (docs/runbooks/, runbooks/, RUNBOOK*.md)'}`, ...r.steps.map((s) => `  ${s.covered ? 'ok  ' : 'GAP '} ${s.step}${s.runbook ? ` (${s.runbook})` : ''}`), ...(r.proposed ? ['', `proposed: ${r.proposed.title} [${r.proposed.labels.join(', ')}]`] : []), '', r.note].join('\n'))
    return r.proposed ? EXIT.CHECK_FAILED : EXIT.OK
  }
  if (action !== 'watch') throw new CliError(action ? `unknown action "${action}"` : 'which action?', { hint: `usage: ${usage}` })
  const settings = watchSettings(merged)
  const packages = inventory(ctx.cwd)
  if (ctx.dryRun) {
    const reqs = plannedRequests(packages, settings)
    const lines = reqs.map((r) => `${r.method} ${r.url}${r.body ? `\n${r.body.queries.map((q) => `  ${q.package.ecosystem} ${q.package.name}@${q.version}`).join('\n')}` : ''}`)
    ctx.output({ dryRun: true, enabled: settings.enabled, requests: reqs }, `${settings.enabled ? 'would send' : `would send nothing: ${settings.why}; the requests would be`}:\n${lines.join('\n')}`)
    return EXIT.OK
  }
  if (!settings.enabled) { ctx.output({ enabled: false, why: settings.why }, `advisory watch: ${settings.why}`); return EXIT.OK }
  const fetch = ctx.io.fetch ?? childFetch(merged, ctx.cwd)
  const { vulns } = await queryAdvisories(packages, { fetch, settings })
  const items = prioritize(vulns, packages, { accepted: merged.security?.acceptedRisks ?? [] })
  const at = (ctx.io.now ?? new Date()).toISOString()
  saveCache(ctx.cwd, { at, packages: packages.length, items })
  let issue = null
  if (ctx.values.issue) {
    const tracker = ctx.io.tracker ?? createTracker(merged, { gh: ctx.io.gh, glab: ctx.io.glab })
    const body = digestBody(items, { at: at.slice(0, 10), packages: packages.length, lang: languageFor(merged, 'issues') })
    // The same issue is edited every time: the open one with the title and the marker, else a new one.
    const existing = (tracker.search?.(`"${TITLE}" in:title`) ?? []).find((i) => i.title === TITLE && i.state === 'open' && (i.body ?? '').includes(MARKER))
    if (existing) { tracker.update(existing.number, { body }); issue = { number: existing.number, updated: true } }
    else issue = { ...tracker.create({ title: TITLE, body, labels: ['security'] }), created: true }
  }
  const kev = items.filter((i) => i.kev && !i.accepted)
  ctx.output({ at, packages: packages.length, items, issue }, `${packages.length} package(s), ${items.length} advisor${items.length === 1 ? 'y' : 'ies'}${kev.length ? `, ${kev.length} KNOWN EXPLOITED` : ''}:\n${items.slice(0, 20).map((i) => `  ${i.kev ? 'KEV ' : ''}${i.severity.padEnd(8)} ${i.id} ${i.touched.map((p) => `${p.name}@${p.version}`).join(', ')}${i.accepted ? ' (accepted)' : ''}`).join('\n') || '  none'}${issue ? `\n${issue.created ? 'created' : 'updated'} the Security digest (#${issue.number})` : ''}`)
  return kev.length ? EXIT.CHECK_FAILED : EXIT.OK
}

/** The security pass on the branch's changes; errors (and scanner errors) fail, warnings do not. */
function pass(ctx, merged) {
  const git = ctx.io.git ?? systemGit(ctx.cwd)
  const files = changedFiles(git, ctx.values.base ?? merged.branches.integration)
  const r = securityPass(ctx.cwd, files, { scanResults: [...(merged.security?.reports ?? []), ...(ctx.values.report ?? [])] })
  const lines = []
  for (const f of r.findings) lines.push(`${f.level === 'error' ? 'FAIL' : 'warn'}  [${f.layer}] ${f.file}${f.line ? `:${f.line}` : ''}: ${f.problem}\n      checklist: ${f.item}\n      fix: ${f.fix}\n      why: ${f.why}`)
  for (const s of r.scans) lines.push(`${s.level === 'error' ? 'FAIL' : 'warn'}  [${s.scanner}] ${s.file ? `${s.file}${s.line ? `:${s.line}` : ''}: ` : ''}${s.problem}${s.rule ? ` (${s.rule})` : ''}`)
  const manual = Object.entries(r.checklists).flatMap(([g, items]) => items.filter((i) => !r.findings.some((f) => f.item.startsWith(i.id))).map((i) => `  [${g}] ${i.id} ${i.text}`))
  if (manual.length) lines.push('', 'check by hand for the layers this change touches:', ...manual)
  if (!(merged.security?.reports ?? []).length && !(ctx.values.report ?? []).length) lines.push('', 'no scanner reports were read (security.reports or --report): secret scanning and dependency audit results are missing from this pass')
  const failed = [...r.findings, ...r.scans].filter((x) => x.level === 'error').length
  ctx.output(r, `${lines.join('\n')}${lines.length ? '\n\n' : ''}security pass on ${files.length} changed file(s), layers ${r.groups.join(', ') || 'none'}: ${failed} failing, ${r.findings.length + r.scans.length - failed} warning(s)`)
  return failed ? EXIT.CHECK_FAILED : EXIT.OK
}
