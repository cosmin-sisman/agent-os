// /ticket: a complete issue. Validates title, labels, milestone and body against the project's conventions, searches
// for duplicates first, and plans the relationships through the platform's capabilities (design §8, §20).

import { LABELS, findDiacritics, label as labelFor, languageFor } from '../i18n/i18n.mjs'
import { planBlockedBy, planParent, planAssignees } from '../platform/capabilities.mjs'

const SCENARIOS_HEADING = { en: /^##\s+Test scenarios\b/im, ro: /^##\s+Scenarii de test\b/im }

/** Turns label ids (`type:bug`) or names into the configured language's names; area labels and others pass through. */
export function resolveLabels(labels, config) {
  const lang = languageFor(config, 'labels')
  return labels.map((l) => {
    const entry = LABELS.find((x) => x.id === l || Object.values(x.name).includes(l))
    return entry ? labelFor(entry.id, lang).name : l
  })
}

const groupOf = (name) => {
  const entry = LABELS.find((x) => Object.values(x.name).includes(name))
  return (entry?.id ?? name).split(':')[0]
}

/**
 * The problems that stop an issue from being created, each saying what to fix.
 * @param {{ title?: string, body?: string, labels?: string[], milestone?: string }} spec labels already resolved
 */
export function validateTicket(spec, config) {
  const lang = languageFor(config, 'issues')
  const problems = []
  const title = String(spec.title ?? '').trim()
  if (!/^[^:]{2,40}: \S/.test(title)) problems.push('the title must be "<Area>: <the problem in short>", e.g. "Login: the session expires after five minutes"')
  if (title.length > 70) problems.push(`the title is ${title.length} characters; keep it to 70`)
  if (/[.!]$/.test(title)) problems.push('remove the final period from the title')
  const labels = spec.labels ?? []
  const count = (group) => labels.filter((l) => groupOf(l) === group).length
  if (count('type') !== 1) problems.push(`exactly one type label is needed (${['feature', 'bug', 'docs', 'chore', 'epic', 'research'].map((t) => labelFor(`type:${t}`, languageFor(config, 'labels')).name).join(', ')}); got ${count('type')}`)
  if (count('priority') !== 1) problems.push(`exactly one priority label is needed (p0 critical … p3 low); got ${count('priority')}`)
  if (count('area') < 1) problems.push('at least one area:* label is needed (where the problem lives)')
  if (count('size') > 1) problems.push('at most one size label')
  if (!spec.milestone) problems.push('a milestone is required: the roadmap stage, or the rolling release milestone for work outside it')
  if (!SCENARIOS_HEADING[lang].test(spec.body ?? '')) problems.push(`the body needs a "## ${lang === 'ro' ? 'Scenarii de test' : 'Test scenarios'}" section (Given / When / Then)`)
  if (lang === 'ro') {
    for (const d of findDiacritics(`${title}\n${spec.body ?? ''}`)) { problems.push(`line ${d.line}, column ${d.col}: "${d.char}"; issues are written in ASCII Romanian, use "${d.ascii}"`); break }
  }
  return problems
}

const STOP = new Set('a an the and or of to in on for with is are be it this that from by at as not no de la si in pe cu din pentru sa se nu o un ca'.split(' '))
const words = (text) => new Set(String(text).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)))

/** How alike two titles are: the share of meaningful words they have in common (0..1). */
export function similarity(a, b) {
  const x = words(a)
  const y = words(b)
  if (!x.size || !y.size) return 0
  let common = 0
  for (const w of x) if (y.has(w)) common++
  return common / Math.min(x.size, y.size)
}

/** Open and closed issues that look like the same request, best first. */
export function findSimilar(tracker, title, { threshold = 0.6, limit = 5 } = {}) {
  const terms = [...words(title)].slice(0, 6)
  if (!terms.length) return []
  const seen = new Map()
  for (const query of [terms.join(' '), `${terms.slice(0, 3).join(' ')} in:title`]) {
    for (const i of tracker.search(query)) if (!seen.has(i.number)) seen.set(i.number, i)
  }
  return [...seen.values()].map((i) => ({ ...i, score: Math.round(similarity(title, i.title) * 100) / 100 })).filter((i) => i.score >= threshold).sort((a, b) => b.score - a.score).slice(0, limit)
}

/** The relationship steps for a new issue, given the platform capabilities. */
export function relationshipPlan(caps, { number, parent, blockedBy = [], blocks = [], assignees = [] }) {
  return [
    ...(parent ? planParent(caps, { child: number, parent }).actions : []),
    ...blockedBy.flatMap((b) => planBlockedBy(caps, { issue: number, blocker: b }).actions),
    ...blocks.flatMap((b) => planBlockedBy(caps, { issue: b, blocker: number }).actions),
    ...(assignees.length ? planAssignees(caps, { issue: number, logins: assignees }).actions : []),
  ]
}

/** Carries out relationship actions with a tracker. */
export function applyActions(tracker, actions, { dryRun = false } = {}) {
  return actions.map((a) => {
    if (a.do === 'link' && a.type === 'blocked-by') return tracker.addBlocker(a.issue, a.blocker, { dryRun })
    if (a.do === 'link' && ['sub-issue', 'epic-child'].includes(a.type)) return tracker.setParent(a.child, a.parent, { dryRun })
    if (a.do === 'link' && a.type === 'relates-to') return tracker.comment(a.issue, `Related to #${a.blocker}`, { dryRun })
    if (a.do === 'add-label') return tracker.update(a.issue, { addLabels: [a.label] }, { dryRun })
    if (a.do === 'body-line') return tracker.appendToBody(a.issue, a.line, { dryRun })
    if (a.do === 'checklist-item') return tracker.appendToBody(a.issue, `- [ ] ${a.item}`, { dryRun })
    if (a.do === 'assign') return tracker.assign(a.issue, a.logins, { dryRun })
    if (a.do === 'comment') return tracker.comment(a.issue, a.text, { dryRun })
    throw new Error(`unknown action ${a.do}`)
  })
}
