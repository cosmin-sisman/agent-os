// doctor: runs the checks, applies mechanical fixes when asked, and scores readiness. Modes: default (local and
// platform checks), --offline (local only), --ci (local only, deterministic: what the CI loop check runs).

import { CHECKS } from './checks.mjs'

/**
 * @param {{ cwd: string, config: object, tracker?: object, caps?: object, me?: string, running: string }} deps
 * @param {{ offline?: boolean, ci?: boolean, fix?: boolean, only?: string[] }} [options]
 */
export function runDoctor(deps, { offline = false, ci = false, fix = false, only = [] } = {}) {
  const local = offline || ci || !deps.tracker
  const results = []
  const fixed = []
  for (const check of CHECKS) {
    if (only.length && !only.includes(check.id)) continue
    if (check.platform && local) { results.push({ id: check.id, area: check.area, skipped: true, findings: [] }); continue }
    let findings
    try { findings = check.run(deps) } catch (err) { findings = [{ level: 'warn', message: `the ${check.id} check could not run: ${err.message.split('\n')[0]}`, fix: err.hint ?? 'run it again with --offline to skip platform checks' }] }
    if (fix && findings.some((f) => f.apply)) {
      for (const f of findings.filter((x) => x.apply)) fixed.push(f.apply())
      findings = check.run(deps)
    }
    results.push({ id: check.id, area: check.area, findings: findings.map(({ apply, ...f }) => ({ ...f, fixable: Boolean(apply) })) })
  }
  const ran = results.filter((r) => !r.skipped)
  const levelOf = (r) => (r.findings.some((f) => f.level === 'fail') ? 'fail' : r.findings.some((f) => f.level === 'warn') ? 'warn' : 'ok')
  const summary = { ok: 0, warn: 0, fail: 0 }
  for (const r of ran) { r.level = levelOf(r); summary[r.level]++ }
  const score = ran.length ? Math.round((100 * (summary.ok + 0.5 * summary.warn)) / ran.length) : 100
  return { mode: ci ? 'ci' : local ? 'offline' : 'full', score, summary, checks: results, fixed }
}

/** The report for people: failures first with their fixes, then warnings, then the score. */
export function report(r) {
  const lines = []
  for (const level of ['fail', 'warn']) {
    for (const c of r.checks) for (const f of c.findings.filter((x) => x.level === level)) lines.push(`${level === 'fail' ? 'FAIL' : 'warn'}  [${c.id}] ${f.message}${f.fix ? `\n      fix: ${f.fix}${f.fixable ? ' (doctor --fix does it)' : ''}` : ''}`)
  }
  const skipped = r.checks.filter((c) => c.skipped).map((c) => c.id)
  lines.push('', ...r.fixed.map((x) => `fixed: ${x}`), `readiness ${r.score}/100: ${r.summary.ok} ok, ${r.summary.warn} warn, ${r.summary.fail} fail${skipped.length ? ` (skipped: ${skipped.join(', ')})` : ''}`)
  return lines.join('\n').replace(/^\n/, '')
}
