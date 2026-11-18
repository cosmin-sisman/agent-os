// Title and commit message conventions. A change-request title becomes the squash commit, so it follows the commit
// form and ends with every issue its description closes or references: `type(scope): summary [#3, #5]`.
// Every problem says exactly what to change; a corrected title is proposed when one can be built.

import { findDiacritics } from '../i18n/i18n.mjs'

const CLOSING = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?|references?|part of)\b[:\s]+((?:[\w.-]+\/[\w.-]+)?#\d+(?:\s*,\s*(?:and\s+)?#\d+)*)/gi

/** Issue numbers a description closes or references (Closes, Fixes, Resolves, Refs, Part of; comma lists too). */
export function referencedIssues(body = '') {
  const out = new Set()
  for (const m of String(body).replace(/<!--[\s\S]*?-->/g, '').matchAll(CLOSING)) {
    if (m[1].includes('/')) continue
    for (const n of m[1].matchAll(/#(\d+)/g)) out.add(Number(n[1]))
  }
  return [...out].sort((a, b) => a - b)
}

const suffixOf = (title) => {
  const m = title.match(/\s\[((?:#\d+)(?:,\s*#\d+)*)\]$/)
  return m ? { text: m[0], issues: [...m[1].matchAll(/#(\d+)/g)].map((x) => Number(x[1])) } : { text: '', issues: [] }
}
const formatSuffix = (issues) => (issues.length ? ` [${issues.map((n) => `#${n}`).join(', ')}]` : '')

/**
 * Checks a change-request title against its description.
 * @param {string} title
 * @param {string} body
 * @param {{ types: string[], maxTitleLength: number, exempt: string[] }} conventions
 * @param {{ lang?: 'en' | 'ro' }} [options] the `prs` area language: ro titles must not contain diacritics
 * @returns {{ ok: boolean, exempt?: boolean, problems: string[], suggestion: string | null }}
 */
export function checkTitle(title, body, conventions, { lang = 'en' } = {}) {
  const t = String(title ?? '').trim()
  if ((conventions.exempt ?? []).some((re) => new RegExp(re).test(t))) return { ok: true, exempt: true, problems: [], suggestion: null }
  const problems = []
  const suffix = suffixOf(t)
  const head = suffix.text ? t.slice(0, -suffix.text.length) : t
  const release = head.match(/^release-(\d+): (.+)$/)
  const m = release ? null : head.match(/^(\w+)(\(([\w./-]+)\))?(!)?: (.+)$/)
  let summary = release?.[2] ?? m?.[5] ?? head
  if (!release && !m) problems.push(`the title must look like "type(scope): summary" (types: ${conventions.types.join(', ')}); got "${head}"`)
  if (m && !conventions.types.includes(m[1])) problems.push(`"${m[1]}" is not an allowed type; use one of ${conventions.types.join(', ')}`)
  if (/[.!?]$/.test(summary)) { problems.push('remove the final punctuation from the summary'); summary = summary.replace(/[.!?]+$/, '') }
  if (/^[A-Z][a-z]/.test(summary)) { problems.push(`start the summary in lower case: "${summary[0].toLowerCase()}${summary.slice(1)}"`); summary = summary[0].toLowerCase() + summary.slice(1) }
  const wanted = referencedIssues(body)
  const missing = wanted.filter((n) => !suffix.issues.includes(n))
  const extra = suffix.issues.filter((n) => !wanted.includes(n))
  if (missing.length) problems.push(`the description closes or references ${missing.map((n) => `#${n}`).join(', ')}, which the title's [..] suffix does not list`)
  if (extra.length) problems.push(`the title lists ${extra.map((n) => `#${n}`).join(', ')}, which the description neither closes nor references (add "Closes #N" or "Refs #N", or drop it from the title)`)
  const issues = [...new Set([...wanted, ...(extra.length ? [] : suffix.issues)])].sort((a, b) => a - b)
  const prefix = release ? `release-${release[1]}: ` : m ? `${m[1]}${m[2] ?? ''}${m[4] ?? ''}: ` : ''
  let fixed = `${prefix}${summary}${formatSuffix(issues)}`
  if (!release && fixed.length > conventions.maxTitleLength) {
    problems.push(`the title is ${fixed.length} characters; the limit is ${conventions.maxTitleLength}, issue suffix included: shorten the summary by ${fixed.length - conventions.maxTitleLength}, never the issue list`)
  }
  if (lang === 'ro') for (const d of findDiacritics(t)) problems.push(`"${d.char}" at column ${d.col}: titles in ro are ASCII; write "${d.ascii}"`)
  if (lang === 'ro') fixed = fixed.normalize('NFC').replace(/[ăâîșțşţĂÂÎȘȚŞŢ]/g, (c) => ({ ă: 'a', â: 'a', î: 'i', ș: 's', ț: 't', ş: 's', ţ: 't', Ă: 'A', Â: 'A', Î: 'I', Ș: 'S', Ț: 'T', Ş: 'S', Ţ: 'T' })[c])
  const suggestable = (release || (m && conventions.types.includes(m[1]))) && (release || fixed.length <= conventions.maxTitleLength)
  return { ok: problems.length === 0, problems, suggestion: problems.length && suggestable && fixed !== t ? fixed : null }
}

/**
 * Checks a commit message: the subject follows the title form (without the issue rules), a blank line separates it
 * from the body.
 */
export function checkCommit(message, conventions, { lang = 'en' } = {}) {
  // Lines starting with # are comments in a commit message file; git drops them, so the check does too.
  const lines = String(message ?? '').replace(/\r\n/g, '\n').split('\n').filter((l) => !l.startsWith('#'))
  const subject = lines[0] ?? ''
  if ((conventions.exempt ?? []).some((re) => new RegExp(re).test(subject)) || /^(Merge|Revert) /.test(subject)) return { ok: true, exempt: true, problems: [] }
  const problems = []
  const m = subject.replace(/\s\[(#\d+(, #\d+)*)\]$/, '').replace(/\s\(#\d+\)$/, '').match(/^(\w+)(\(([\w./-]+)\))?(!)?: (.+)$/)
  if (!m) problems.push(`the subject must look like "type(scope): summary"; got "${subject}"`)
  else {
    if (!conventions.types.includes(m[1])) problems.push(`"${m[1]}" is not an allowed type; use one of ${conventions.types.join(', ')}`)
    if (/[.!?]$/.test(m[5])) problems.push('remove the final punctuation from the subject')
  }
  if (subject.length > conventions.maxTitleLength) problems.push(`the subject is ${subject.length} characters; the limit is ${conventions.maxTitleLength}`)
  if (lines.length > 1 && lines[1].trim() !== '') problems.push('leave a blank line between the subject and the body')
  if (lang === 'ro') for (const d of findDiacritics(message)) problems.push(`line ${d.line}, column ${d.col}: "${d.char}" — commits in ro are ASCII; write "${d.ascii}"`)
  return { ok: problems.length === 0, problems }
}
