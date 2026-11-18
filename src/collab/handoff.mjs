// /handoff: at the end of a session or a day, a status comment on each issue you hold and are working on (its branch,
// last commit, change request and checks, blockers, open scenarios, next steps) and one handoff journal entry, so the
// next person can continue from the comments alone. Only issues assigned to you with work in flight get a comment.

import { addEntry } from '../journal/journal.mjs'
import { untickedScenarios } from '../testing/test.mjs'

const TEXT = {
  en: {
    head: (who) => `Handoff from @${who}:`, branch: 'Branch', last: 'Last commit', cr: 'Change request', checks: 'checks', none: 'none yet',
    blockers: 'Blocked by', scenarios: (n) => `${n} test scenario(s) still unticked`, next: 'Next', noNext: 'continue from the issue and the change request; nothing else is pending',
  },
  ro: {
    head: (who) => `Predare de la @${who}:`, branch: 'Branch', last: 'Ultimul commit', cr: 'Change request', checks: 'verificari', none: 'inca nu',
    blockers: 'Blocat de', scenarios: (n) => `${n} scenarii de test inca nebifate`, next: 'Urmeaza', noNext: 'continua din issue si din change request; nu mai e nimic in asteptare',
  },
}

const lines = (r) => (r.status === 0 ? r.stdout.split(/\r?\n/).filter(Boolean) : [])

/** The issues assigned to you that have work in flight: a pushed branch named for them, or an open change request. */
export function heldIssues({ tracker, git, me }) {
  const branches = lines(git(['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin'])).map((b) => b.replace(/^origin\//, ''))
  return tracker.assignedIssues(me, { limit: 50 }).map((i) => {
    const branch = branches.find((b) => new RegExp(`(^|/)${i.number}-`).test(b)) ?? null
    let cr = null
    try { cr = branch ? tracker.pullRequestFor(branch) : null } catch { cr = null }
    return { ...i, branch, cr }
  }).filter((i) => i.branch || i.cr)
}

/** The status comment for one held issue. */
export function statusComment(issue, { me, git, tracker, vocab, lang = 'en', next }) {
  const t = TEXT[lang] ?? TEXT.en
  const out = [t.head(me), '']
  if (issue.branch) {
    out.push(`- ${t.branch}: \`${issue.branch}\``)
    const last = lines(git(['log', '-1', '--format=%h %s (%cr)', `origin/${issue.branch}`]))[0]
    if (last) out.push(`- ${t.last}: ${last}`)
  }
  if (issue.cr) {
    let checks = null
    try { checks = tracker.pullRequestStatus(issue.cr.number).checks } catch { checks = null }
    out.push(`- ${t.cr}: ${vocab.crRef}${issue.cr.number}${checks ? `, ${t.checks} ${checks}` : ''}`)
  } else out.push(`- ${t.cr}: ${t.none}`)
  let blockers = []
  try { blockers = tracker.blockers(issue.number).filter((b) => b.state === 'open') } catch { blockers = [] }
  if (blockers.length) out.push(`- ${t.blockers}: ${blockers.map((b) => `#${b.number}`).join(', ')}`)
  let body = ''
  try { body = tracker.get(issue.number).body ?? '' } catch { body = '' }
  const open = untickedScenarios(body).length
  if (open) out.push(`- ${t.scenarios(open)}`)
  out.push(`- ${t.next}: ${next || t.noNext}`)
  return out.join('\n')
}

/**
 * The handoff: a comment per held issue and one journal entry.
 * @param {{ tracker: object, git: Function, cwd: string, vocab: object }} deps
 * @param {{ me: string, lang?: string, notes?: Record<number, string>, summary?: string, dryRun?: boolean, now?: Date }} options
 */
export function handoff({ tracker, git, cwd, vocab }, { me, lang = 'en', notes = {}, summary = '', dryRun = false, now = new Date() }) {
  const held = heldIssues({ tracker, git, me })
  const comments = held.map((i) => ({ number: i.number, title: i.title, body: statusComment(i, { me, git, tracker, vocab, lang, next: notes[i.number] }) }))
  if (!dryRun) for (const c of comments) tracker.comment(c.number, c.body)
  const entryBody = [summary || (lang === 'ro' ? 'Predare la sfarsitul sesiunii.' : 'Handoff at the end of the session.'), '', ...comments.map((c) => `- #${c.number} ${c.title}${notes[c.number] ? `: ${notes[c.number]}` : ''}`)].join('\n')
  const entry = { type: 'handoff', title: lang === 'ro' ? `Predare: ${comments.length} issue-uri in lucru` : `Handoff: ${comments.length} issue(s) in flight`, areas: ['handoff'], refs: comments.map((c) => `#${c.number}`), author: me, at: now, body: entryBody, lang }
  const journal = dryRun ? { dryRun: true } : addEntry(cwd, entry)
  return { held: held.map((i) => ({ number: i.number, branch: i.branch, cr: i.cr?.number ?? null })), comments, journal: journal.path ?? null, dryRun }
}
