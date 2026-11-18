// What an audit leaves behind (design §21, Outputs). The audit artifact keeps the report and the commit it audited.
// The comparison with the previous audit of the same subject lists fixed, new, worse and better findings. Proposed
// issues are drafts for /ticket and are filed only on the person's confirmation: nothing here calls the platform.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CliError } from '../cli/errors.mjs'
import { DIR, listArtifacts } from '../artifacts/artifact.mjs'
import { SEVERITIES } from './audit.mjs'

const WEIGHT = { critical: 40, high: 20, medium: 10, low: 5 }
const TONE = { critical: 'bad', high: 'bad', medium: 'warn', low: 'muted' }
const PRIORITY = { critical: 'priority:p0', high: 'priority:p1', medium: 'priority:p2', low: 'priority:p3' }
const WORDS = {
  en: { summary: (n, q, s, lenses) => `${n} finding(s) with evidence, ${q} open question(s) and ${s} strength(s), across ${lenses} lens(es).`, commit: (c) => `Audited at commit ${c}.`, now: 'Now', next: 'Next', later: 'Later', fixed: 'Fixed', new: 'New', worse: 'Worse', better: 'Better', first: 'The first audit of this subject.' },
  ro: { summary: (n, q, s, lenses) => `${n} constatari cu dovezi, ${q} intrebari deschise si ${s} puncte forte, pe ${lenses} lentile.`, commit: (c) => `Auditat la commit-ul ${c}.`, now: 'Acum', next: 'Urmeaza', later: 'Mai tarziu', fixed: 'Rezolvat', new: 'Nou', worse: 'Mai grav', better: 'Mai bine', first: 'Primul audit al acestui subiect.' },
}

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const same = (a, b) => norm(a.title) === norm(b.title) || (a.evidence ?? []).some((e) => (b.evidence ?? []).includes(e))

/** The slug of an audit artifact: what was audited, in a few words. */
export function auditSlug(input) {
  const words = norm(input).split(' ').filter(Boolean).slice(0, 6)
  return `audit-${words.join('-') || 'project'}`
}

/** A score from 0 to 100 per lens: 100 minus the weight of each finding it raised. */
export function lensScores(report, lenses) {
  return lenses.map((lens) => {
    const mine = report.findings.filter((f) => f.lenses.includes(lens))
    const worst = mine.map((f) => f.severity).sort((a, b) => SEVERITIES.indexOf(a) - SEVERITIES.indexOf(b))[0] ?? null
    return { lens, findings: mine.length, worst, score: Math.max(0, 100 - mine.reduce((n, f) => n + WEIGHT[f.severity], 0)) }
  })
}

/** Fixed, new, worse and better findings between two audits of the same subject. */
export function compareAudits(previous, current) {
  const prev = previous?.findings ?? []
  const cur = current.findings ?? []
  const out = { fixed: [], new: [], worse: [], better: [], unchanged: [] }
  for (const f of cur) {
    const p = prev.find((x) => same(x, f))
    if (!p) out.new.push({ title: f.title, severity: f.severity })
    else {
      const d = SEVERITIES.indexOf(f.severity) - SEVERITIES.indexOf(p.severity)
      out[d < 0 ? 'worse' : d > 0 ? 'better' : 'unchanged'].push({ title: f.title, severity: f.severity, was: p.severity })
    }
  }
  for (const p of prev) if (!cur.some((f) => same(p, f))) out.fixed.push({ title: p.title, severity: p.severity })
  return out
}

/** The latest earlier audit artifact of the same subject and input, with its stored report. */
export function previousAudit(root, { subject, input }, { before } = {}) {
  const slug = auditSlug(input)
  for (const a of listArtifacts(root)) {
    if (a.type !== 'audit' || a.folder === before || !a.folder.endsWith(`-${slug}`)) continue
    const f = join(root, DIR, a.folder, 'data.json')
    if (!existsSync(f)) continue
    try {
      const audit = JSON.parse(readFileSync(f, 'utf8')).audit
      if (audit?.subject === subject) return { id: a.folder, audit }
    } catch { /* an unreadable earlier audit is skipped, not compared */ }
  }
  return null
}

/** The page data of an audit artifact: the sections the page renders, and the report under `audit` for later diffs. */
export function auditData(report, { subject, input, lenses, commit, lang = 'en', title, now = new Date(), previous = null }) {
  const w = WORDS[lang] ?? WORDS.en
  const scores = lensScores(report, lenses)
  const comparison = previous ? compareAudits(previous.audit, report) : null
  const roadmap = report.findings.map((f) => {
    const when = ['critical', 'high'].includes(f.severity) ? w.now : f.severity === 'medium' ? w.next : w.later
    return `${when}: ${f.title}${f.recommendation ? `: ${f.recommendation}` : ''}`
  })
  const compared = comparison
    ? [...comparison.fixed.map((f) => `${w.fixed}: ${f.title}`), ...comparison.new.map((f) => `${w.new}: ${f.title} (${f.severity})`), ...comparison.worse.map((f) => `${w.worse}: ${f.title} (${f.was} → ${f.severity})`), ...comparison.better.map((f) => `${w.better}: ${f.title} (${f.was} → ${f.severity})`)]
    : [w.first]
  return {
    kind: 'audit', lang, title: title ?? `Audit: ${input}`, subtitle: `${subject} · ${lenses.join(', ')}`, updated: now.toISOString().slice(0, 10),
    sections: [
      { heading: lang === 'ro' ? 'Rezumat' : 'Summary', text: [w.summary(report.findings.length, report.questions.length, report.strengths.length, lenses.length), ...(commit ? [w.commit(commit)] : [])] },
      { heading: lang === 'ro' ? 'Scor pe lentila' : 'Scores per lens', table: { columns: lang === 'ro' ? ['Lentila', 'Constatari', 'Cea mai grava', 'Scor'] : ['Lens', 'Findings', 'Worst', 'Score'], rows: scores.map((s) => [s.lens, String(s.findings), s.worst ? { text: s.worst, tone: TONE[s.worst] } : '-', { text: String(s.score), tone: s.score >= 80 ? 'good' : s.score >= 50 ? 'warn' : 'bad' }]) } },
      { heading: lang === 'ro' ? 'Constatari' : 'Findings', table: { columns: lang === 'ro' ? ['Severitate', 'Incredere', 'Constatare', 'Lentile', 'Dovezi', 'Recomandare'] : ['Severity', 'Confidence', 'Finding', 'Lenses', 'Evidence', 'Recommendation'], rows: report.findings.map((f) => [{ text: f.severity, tone: TONE[f.severity] }, f.confidence, f.title, f.lenses.join(', '), f.evidence.join('; '), [f.recommendation ?? '-', ...(f.alternatives.length ? [`(${f.alternatives.join('; ')})`] : [])].join(' ')]) } },
      { heading: lang === 'ro' ? 'Intrebari' : 'Questions', items: report.questions.map((q) => `[${q.lens}] ${q.question}`) },
      { heading: lang === 'ro' ? 'Puncte forte' : 'Strengths', items: report.strengths.map((s) => `[${s.lens}] ${s.strength}`) },
      { heading: lang === 'ro' ? 'Plan' : 'Roadmap', items: roadmap },
      { heading: lang === 'ro' ? 'Comparatie cu auditul anterior' : 'Compared with the previous audit', items: compared },
    ],
    audit: { subject, input, commit: commit ?? null, lenses, previous: previous?.id ?? null, comparison, findings: report.findings, questions: report.questions, strengths: report.strengths },
  }
}

/**
 * Issue drafts for the findings the person accepted (1-based numbers in the report's order), for /ticket. More than
 * `epicAbove` accepted findings become one epic with sub-issues. Nothing is filed here.
 */
export function proposeIssues(audit, { accept = [], epicAbove = 5, artifact } = {}) {
  if (!accept.length) return { confirmed: false, drafts: [], epic: null, note: 'nothing is proposed until the person picks the findings to file (--accept <n>…)' }
  const drafts = accept.map((n) => {
    const f = audit.findings[n - 1]
    if (!f) throw new CliError(`there is no finding ${n}`, { hint: `the report has ${audit.findings.length} finding(s), numbered from 1` })
    const area = f.lenses[0]
    return {
      finding: n,
      title: `${area[0].toUpperCase()}${area.slice(1).replace(/-/g, ' ')}: ${f.title}`,
      labels: [f.lenses.includes('security-privacy') ? 'type:bug' : 'type:chore', PRIORITY[f.severity], 'area:audit'],
      body: [
        '## Context', '', `Found by the audit of "${audit.input}" (${audit.subject})${artifact ? `, artifact \`${artifact}\`` : ''}${audit.commit ? ` at ${audit.commit.slice(0, 12)}` : ''}. Lenses: ${f.lenses.join(', ')}. Severity ${f.severity}, confidence ${f.confidence}.`,
        '', '## Evidence', '', ...f.evidence.map((e) => `- ${e}`),
        '', '## Proposal', '', f.recommendation ?? 'To decide.', ...(f.alternatives.length ? ['', 'Alternatives:', ...f.alternatives.map((a) => `- ${a}`)] : []),
        '', '## Acceptance criteria', '', `- [ ] the next audit of "${audit.input}" no longer reports "${f.title}"`,
      ].join('\n'),
    }
  })
  const epic = drafts.length > epicAbove ? { title: `Audit: ${audit.input}`, labels: ['type:epic', 'area:audit'], children: drafts.map((d) => d.finding) } : null
  return { confirmed: true, drafts, epic, note: 'drafts only: file each with /ticket (agent-os issue new), after a duplicate search' }
}

/** Checks an audit artifact against the commit it audited: the commit exists, and how far HEAD has moved since. */
export function verifyAudit(root, id, { git }) {
  const f = join(root, DIR, id, 'data.json')
  if (!existsSync(f)) throw new CliError(`no audit artifact "${id}"`, { hint: 'agent-os artifact list' })
  const audit = JSON.parse(readFileSync(f, 'utf8')).audit
  if (!audit) throw new CliError(`${id} is not an audit artifact`)
  if (!audit.commit) return { id, ok: false, problem: 'the audit records no commit' }
  if (!/^[0-9a-f]{7,64}$/.test(audit.commit)) return { id, ok: false, commit: audit.commit, problem: 'the recorded commit is not a commit id' }
  if (git(['cat-file', '-e', `${audit.commit}^{commit}`]).status !== 0) return { id, ok: false, commit: audit.commit, problem: 'the audited commit is not in this repository' }
  const since = git(['rev-list', '--count', `${audit.commit}..HEAD`])
  return { id, ok: true, commit: audit.commit, commitsSince: since.status === 0 ? Number(String(since.stdout).trim()) : null }
}

