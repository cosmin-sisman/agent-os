// /pr: open a change request only when it is ready. Preflight checks the title, the body (a non-empty Lessons
// section, how it was tested, the issue it closes), a journal entry on the branch and a passing gate for exactly
// this commit; then it pushes, opens it, copies the issue's labels and records it on the issue.

import { CliError } from '../cli/errors.mjs'
import { checkTitle, referencedIssues } from '../conventions/conventions.mjs'
import { findDiacritics } from '../i18n/i18n.mjs'
import { readResult } from '../gate/gate.mjs'
import { labelId } from './next.mjs'
import { lessonsForChange } from '../lessons/lessons.mjs'
import { findOverlap } from '../collab/overlap.mjs'
import { UI_FILE, slotsFor } from '../registry/slots.mjs'

/** Section headings of the change-request template, per language. */
export const SECTIONS = {
  en: { what: 'What', why: 'Why', tested: 'How it was tested', lessons: 'Lessons', notes: 'Notes for reviewers' },
  ro: { what: 'Ce', why: 'De ce', tested: 'Cum a fost testat', lessons: 'Lectii', notes: 'Note pentru revieweri' },
}

/** The text of a "## Heading" section, without HTML comments, trimmed ("" when missing or empty). */
export function section(body, heading) {
  const text = String(body).replace(/<!--[\s\S]*?-->/g, '')
  const re = new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'mi')
  const m = re.exec(text)
  if (!m) return null
  const rest = text.slice(m.index + m[0].length)
  const next = rest.search(/^##\s/m)
  return (next === -1 ? rest : rest.slice(0, next)).trim()
}

/** Problems with a change-request body. */
export function checkBody(body, { lang = 'en' } = {}) {
  const s = SECTIONS[lang] ?? SECTIONS.en
  const problems = []
  const lessons = section(body, s.lessons)
  if (lessons === null) problems.push(`the body has no "## ${s.lessons}" section`)
  else if (!lessons) problems.push(`"## ${s.lessons}" is empty: write the lesson, or "None: <why>"`)
  else if (/^none\.?$|^niciuna?\.?$/i.test(lessons)) problems.push(`"## ${s.lessons}" says none without a reason: write "None: <why>"`)
  const tested = section(body, s.tested)
  if (!tested) problems.push(`"## ${s.tested}" is ${tested === null ? 'missing' : 'empty'}: the real commands and results`)
  if (!referencedIssues(body).length) problems.push('the body closes or references no issue: add "Closes #N"')
  if (lang === 'ro') for (const d of findDiacritics(body).slice(0, 3)) problems.push(`body line ${d.line}: "${d.char}" (prs are ro, ASCII only: write "${d.ascii}")`)
  return problems
}

const out = (r) => (r.status === 0 ? r.stdout.trim() : null)

/**
 * Everything that must be true before opening. Returns { ok, problems, branch, head, gate }.
 * @param {{ config: object, git: Function, cwd: string }} deps
 */
export function preflight({ config, git, cwd, tracker }, { title, body, base = config.branches.integration, lang = 'en' }) {
  const problems = []
  const branch = out(git(['rev-parse', '--abbrev-ref', 'HEAD']))
  const head = out(git(['rev-parse', 'HEAD']))
  if (!branch || branch === 'HEAD') problems.push('not on a branch')
  else if ([config.branches.integration, config.branches.production].includes(branch)) problems.push(`you are on ${branch}: work on an issue branch (agent-os start <n>)`)
  const t = checkTitle(title, body, config.conventions, { lang })
  for (const p of t.problems) problems.push(`title: ${p}`)
  problems.push(...checkBody(body, { lang }))
  const added = out(git(['diff', '--name-only', '--diff-filter=A', `origin/${base}...HEAD`]))
  if (added === null) problems.push(`cannot diff against origin/${base} (git fetch origin ${base})`)
  else if (!added.split(/\r?\n/).some((f) => /^\.agent-os\/journal\/.+\.md$/.test(f))) problems.push('the branch adds no journal entry: agent-os journal add … and commit it')
  const gate = readResult(cwd)
  if (!gate) problems.push('the gate has not run: agent-os gate')
  else if (gate.head !== head || !gate.clean) problems.push(`the gate ran on ${gate.clean ? `commit ${String(gate.head).slice(0, 7)}` : 'uncommitted changes'}, not on ${String(head).slice(0, 7)}: commit everything, then run agent-os gate again`)
  else if (!gate.ok) problems.push(`the gate failed: ${gate.suites.filter((s) => !s.passed).map((s) => s.name).join(', ')} (fix it; a change request never opens with a failing check)`)
  const changed = out(git(['diff', '--name-only', `origin/${base}...HEAD`]))
  const lessons = lessonsForChange(cwd, { paths: changed ? changed.split(/\r?\n/).filter(Boolean) : [], text: `${title}\n${body}` })
  const files = changed ? changed.split(/\r?\n/).filter(Boolean) : []
  let overlaps = []
  if (files.length) { try { overlaps = findOverlap({ tracker, git, cwd, config }, { files, branch }).overlaps } catch { overlaps = [] } }
  // A slot that is not bound is a warning, never a stop: the change request goes ahead without that pass.
  const warnings = []
  if (!slotsFor(config)['ui-design'] && files.some((f) => UI_FILE.test(f))) warnings.push('this change touches the user interface and no ui-design skill is bound (slots.ui-design): review the UI by hand, or bind one')
  return { ok: problems.length === 0, problems, branch, head, gate, suggestion: t.suggestion, lessons, overlaps, warnings }
}

/**
 * Pushes and opens the change request, copies the issue's type and area labels, and records it on the issue.
 * @param {{ config: object, git: Function, cwd: string, tracker: object, vocab: object }} deps
 */
export function openChangeRequest(deps, { title, body, base = deps.config.branches.integration, draft = false, lang = 'en', issuesLang = 'en', dryRun = false }) {
  const pre = preflight(deps, { title, body, base, lang })
  if (!pre.ok) return { opened: false, ...pre }
  const { tracker, git, vocab } = deps
  const existing = tracker.pullRequestFor(pre.branch)
  if (existing) throw new CliError(`${pre.branch} already has ${vocab.cr} ${vocab.crRef}${existing.number}`, { hint: existing.url })
  const issues = referencedIssues(body)
  const labels = [...new Set(issues.flatMap((n) => tracker.get(n).labels).filter((l) => /^(type|area):/.test(labelId(l))))]
  const steps = [`push ${pre.branch}`, `open "${title}" into ${base}${draft ? ' as a draft' : ''}`, ...(labels.length ? [`label it ${labels.join(', ')}`] : []), ...issues.map((n) => `record it on #${n}`)]
  if (dryRun) return { opened: false, dryRun: true, steps, labels, ...pre }
  const push = git(['push', '-u', 'origin', pre.branch])
  if (push.status !== 0) throw new CliError(`git push failed: ${(push.stderr || push.stdout).trim().split('\n')[0]}`)
  const cr = tracker.createPullRequest({ title, body, head: pre.branch, base, draft })
  if (labels.length) tracker.labelChangeRequest(cr.number, labels)
  const note = issuesLang === 'ro' ? `${vocab.cr} ${vocab.crRef}${cr.number} este deschis pentru acest issue.` : `${vocab.cr} ${vocab.crRef}${cr.number} is open for this issue.`
  for (const n of issues) tracker.comment(n, note)
  return { opened: true, number: cr.number, url: cr.url, labels, steps, ...pre, warnings: tracker.warnings ?? [] }
}
