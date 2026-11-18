// /retro: triage the lessons inbox and repeated review findings into rules, active cards or rejections, and update
// the recall counters from the journal. It is the only writer of the counters, so recalls never conflict. Every
// inbox entry must end as a rule, a card, or rejected with a reason. Design §10.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CliError } from '../cli/errors.mjs'
import { readJournal } from '../journal/journal.mjs'
import { acceptLesson, promoteLesson, readLessons, retireLesson } from '../lessons/lessons.mjs'
import { scalar } from '../yaml/yaml.mjs'

const words = (t) => new Set(String(t).toLowerCase().replace(/`[^`]*`/g, ' ').split(/[^a-z0-9]+/).filter((w) => w.length > 3))
const overlap = (a, b) => { const A = words(a); const B = words(b); const n = [...A].filter((w) => B.has(w)).length; return n / Math.max(1, Math.min(A.size, B.size)) }

/** Inbox cards grouped by theme: a shared area, keyword or close wording. */
export function themes(inbox) {
  const groups = []
  for (const c of inbox) {
    const g = groups.find((x) => x.cards.some((o) => (o.meta.areas ?? []).some((a) => (c.meta.areas ?? []).includes(a)) && ((o.meta.keywords ?? []).some((k) => (c.meta.keywords ?? []).includes(k)) || overlap(o.text, c.text) >= 0.4)))
    if (g) g.cards.push(c)
    else groups.push({ theme: (c.meta.areas ?? ['general'])[0], cards: [c] })
  }
  return groups
}

/** A normalized key for a review finding, so the same remark on different change requests groups together. */
export const findingKey = (body) => [...words(String(body).split(/\r?\n/)[0])].slice(0, 8).sort().join(' ')

/**
 * Review findings repeated on several recent change requests.
 * @param {object} tracker with pullRequestFiles-free methods: reviewThreads(n)
 * @param {number[]} numbers recent change requests
 */
export function repeatedFindings(tracker, numbers, { min = 3 } = {}) {
  const byKey = new Map()
  for (const n of numbers) {
    let threads = []
    try { threads = tracker.reviewThreads(n) } catch { continue }
    for (const t of threads) {
      const first = t.comments?.[0]
      if (!first?.body) continue
      const key = findingKey(first.body)
      if (!key) continue
      const e = byKey.get(key) ?? { key, text: first.body.split(/\r?\n/)[0].trim(), prs: new Set(), paths: new Set() }
      e.prs.add(n)
      if (t.path) e.paths.add(t.path)
      byKey.set(key, e)
    }
  }
  return [...byKey.values()].filter((e) => e.prs.size >= min).map((e) => ({ text: e.text, prs: [...e.prs].sort((a, b) => a - b), paths: [...e.paths].sort() }))
}

/** How often each active card was recalled and followed, from the journal ("lesson <id>" and "followed <id>"). */
export function countersFromJournal(cwd, cards) {
  const entries = readJournal(cwd)
  return Object.fromEntries(cards.map((c) => {
    const id = c.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const recalled = entries.filter((e) => new RegExp(`\\b${id}\\b`).test(e.body ?? '')).length
    const followed = entries.filter((e) => new RegExp(`\\bfollow(ed|ing)?\\s+(lesson\\s+)?${id}\\b`, 'i').test(e.body ?? '')).length
    return [c.id, { recalled, followed }]
  }))
}

/**
 * The proposals: for each inbox card, rule (a theme with several cards, or high confidence), card, or reject (a
 * duplicate of an active card, or invalid); for each repeated review finding, a rule.
 */
export function retroPlan({ cwd, tracker, recent = [] }) {
  const all = readLessons(cwd)
  const active = all.filter((c) => c.state === 'active')
  const inbox = all.filter((c) => c.state === 'inbox')
  const proposals = []
  for (const g of themes(inbox)) {
    for (const c of g.cards) {
      const dup = active.find((a) => overlap(a.text, c.text) >= 0.7)
      if (c.error) proposals.push({ id: c.id, action: 'reject', reason: `it cannot be read: ${c.error}` })
      else if (dup) proposals.push({ id: c.id, action: 'reject', reason: `it repeats the active card ${dup.id}` })
      else if (g.cards.length >= 2 || c.meta.confidence === 'high' || c.meta.upstream) proposals.push({ id: c.id, action: 'rule', theme: g.theme, reason: g.cards.length >= 2 ? `${g.cards.length} lessons on ${g.theme} point the same way` : 'high confidence and general enough for a rule' })
      else proposals.push({ id: c.id, action: 'card', theme: g.theme, reason: 'specific to some paths: recall it as a card' })
    }
  }
  const findings = tracker && recent.length ? repeatedFindings(tracker, recent) : []
  for (const f of findings) proposals.push({ finding: f.text, action: 'rule', prs: f.prs, paths: f.paths, reason: `the same review finding on ${f.prs.map((n) => `#${n}`).join(', ')}` })
  return { inbox: inbox.length, themes: themes(inbox).map((g) => ({ theme: g.theme, cards: g.cards.map((c) => c.id) })), proposals, counters: countersFromJournal(cwd, active) }
}

/** Writes the counters into the active cards (the single writer). */
export function writeCounters(cwd, counters) {
  for (const c of readLessons(cwd).filter((x) => x.state === 'active' && counters[x.id])) {
    const text = readFileSync(join(cwd, c.path), 'utf8')
    let next = text
    for (const [k, v] of Object.entries(counters[c.id])) next = new RegExp(`^${k}:.*$`, 'm').test(next) ? next.replace(new RegExp(`^${k}:.*$`, 'm'), `${k}: ${v}`) : next.replace(/^---\r?\n/, `---\n${k}: ${scalar(v)}\n`)
    if (next !== text) writeFileSync(join(cwd, c.path), next)
  }
}

/**
 * Applies the decisions. Every inbox card needs one: { accept: [ids], promote: { id: rule }, reject: { id: reason } }.
 * @returns {{ done: object[], counters: object }}
 */
export function applyRetro(cwd, { accept = [], promote = {}, reject = {} }, { now = new Date(), dryRun = false } = {}) {
  const inbox = readLessons(cwd).filter((c) => c.state === 'inbox')
  const decided = new Set([...accept, ...Object.keys(promote), ...Object.keys(reject)])
  const find = (id) => inbox.find((c) => c.id === id || c.id.endsWith(id))
  const undecided = inbox.filter((c) => ![...decided].some((d) => c.id === d || c.id.endsWith(d)))
  if (undecided.length) throw new CliError(`${undecided.length} inbox lesson(s) have no decision: ${undecided.map((c) => c.id).join(', ')}`, { hint: 'every inbox entry ends as a rule (--promote id=rule), a card (--accept id) or rejected with a reason (--reject id=reason)' })
  for (const [id, reason] of Object.entries(reject)) if (!reason) throw new CliError(`rejecting ${id} needs a reason`)
  for (const id of [...accept, ...Object.keys(promote), ...Object.keys(reject)]) if (!find(id)) throw new CliError(`no inbox lesson "${id}"`)
  // A dry run checks every decision and lists them, and writes nothing (no moves, no counters).
  if (dryRun) return { dryRun: true, done: [...accept.map((id) => ({ id, action: 'card' })), ...Object.entries(promote).map(([id, rule]) => ({ id, action: 'rule', promotedTo: rule })), ...Object.entries(reject).map(([id, reason]) => ({ id, action: 'rejected', reason }))], counters: [] }
  const done = []
  for (const id of accept) { if (!find(id)) throw new CliError(`no inbox lesson "${id}"`); done.push({ id, action: 'card', ...acceptLesson(cwd, id) }) }
  for (const [id, rule] of Object.entries(promote)) {
    if (!find(id)) throw new CliError(`no inbox lesson "${id}"`)
    const p = promoteLesson(cwd, id, { to: rule })
    done.push({ id, action: 'rule', ...retireLesson(cwd, id, { reason: `promoted to ${rule}`, at: now }), promotedTo: p.promotedTo })
  }
  for (const [id, reason] of Object.entries(reject)) { if (!find(id)) throw new CliError(`no inbox lesson "${id}"`); done.push({ id, action: 'rejected', reason, ...retireLesson(cwd, id, { reason: `rejected: ${reason}`, at: now }) }) }
  const counters = countersFromJournal(cwd, readLessons(cwd).filter((c) => c.state === 'active'))
  writeCounters(cwd, counters)
  return { done, counters }
}

/** The Retro issue's body, from a plan. */
export function retroIssueBody(plan) {
  return [
    `${plan.inbox} lesson(s) wait in the inbox. Run \`/retro\` (or \`agent-os retro plan\`) and decide each one: a rule, an active card, or rejected with a reason.`,
    '',
    ...plan.proposals.map((p) => `- [ ] ${p.id ? `\`${p.id}\`` : `review finding "${p.finding}"`}: proposed **${p.action}**: ${p.reason}`),
    '',
    'This issue is kept up to date by the scheduled retro workflow; it closes when the inbox is empty.',
  ].join('\n')
}
