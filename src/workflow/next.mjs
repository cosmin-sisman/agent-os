// /next: what to work on, decided from the repository's state and not from memory. Candidates fall in tiers (design
// §9) and are ordered inside a tier by explicit keys, so the same platform state always gives the same answer.

import { LABELS } from '../i18n/i18n.mjs'
import { has } from '../platform/capabilities.mjs'

/** The stable label id ("priority:p1") for a label name in any language, or the name itself. */
export function labelId(name) {
  return LABELS.find((l) => l.id === name || Object.values(l.name).includes(name))?.id ?? name
}

const PRIORITY = { 'priority:p0': 0, 'priority:p1': 1, 'priority:p2': 2, 'priority:p3': 3 }
const priorityOf = (ids) => Math.min(4, ...ids.map((id) => PRIORITY[id] ?? 4))
const areasOf = (ids) => ids.filter((id) => id.startsWith('area:'))
const pLabel = (p) => (p < 4 ? `p${p}` : 'no priority')

/** "v0.2 Core workflow" → [0, 2, 0]; no version → null. */
export function versionOf(title) {
  const m = String(title).match(/\bv?(\d+)\.(\d+)(?:\.(\d+))?/)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null
}

/** Open milestones in work order: the earliest due date first, then the lowest version, then the title. */
export function milestoneOrder(milestones) {
  const cmpVersion = (a, b) => {
    const va = versionOf(a.title)
    const vb = versionOf(b.title)
    if (va && vb) return va[0] - vb[0] || va[1] - vb[1] || va[2] - vb[2]
    return va ? -1 : vb ? 1 : 0
  }
  return milestones.filter((m) => m.state === 'open').sort((a, b) => {
    const da = a.due_on ? Date.parse(a.due_on) : Infinity
    const db = b.due_on ? Date.parse(b.due_on) : Infinity
    return (da === db ? 0 : da < db ? -1 : 1) || cmpVersion(a, b) || a.title.localeCompare(b.title, 'en')
  })
}

/** Issue numbers that have a branch on the remote, from `<prefix>/<n>-<slug>` names. */
export function branchIssues(git) {
  const r = git(['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin'])
  if (r.status !== 0) return new Set()
  return new Set(r.stdout.split(/\r?\n/).map((b) => b.match(/^origin\/[\w.-]+\/(\d+)-/)?.[1]).filter(Boolean).map(Number))
}

const compare = (ka, kb) => {
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1
  return 0
}

/**
 * Ranks what to work on.
 * @param {{ tracker: object, caps: object, git: Function }} deps
 * @param {{ limit?: number }} [options]
 */
export function recommend({ tracker, caps, git }, { limit = 3 } = {}) {
  const me = tracker.whoami()
  const deps = has(caps, 'dependencies')
  const picks = []
  const excluded = []
  const add = (pick) => { if (!picks.some((p) => p.kind === pick.kind && p.number === pick.number)) picks.push(pick) }

  // 1. My PRs that need me: changes requested or failing checks.
  for (const pr of tracker.pullRequests(`author:${me}`).sort((a, b) => a.number - b.number)) {
    if (pr.review === 'CHANGES_REQUESTED') add({ tier: 1, kind: 'pr', number: pr.number, title: pr.title, url: pr.url, reason: 'your PR has requested changes', action: `address the review on #${pr.number}` })
    else if (pr.checks === 'FAILURE' || pr.checks === 'ERROR') add({ tier: 1, kind: 'pr', number: pr.number, title: pr.title, url: pr.url, reason: 'your PR has failing checks', action: `fix the checks on #${pr.number}` })
  }
  // 2. Reviews requested from me.
  for (const pr of tracker.pullRequests(`review-requested:${me}`).sort((a, b) => a.number - b.number)) {
    add({ tier: 2, kind: 'review', number: pr.number, title: pr.title, url: pr.url, reason: 'your review is requested', action: `review #${pr.number}` })
  }

  const issues = tracker.openIssues().map((i) => ({ ...i, ids: i.labels.map(labelId) }))
  const order = milestoneOrder(tracker.milestones())
  const rank = (i) => { const k = order.findIndex((m) => m.title === i.milestone?.title); return k === -1 ? order.length : k }
  const current = order.find((m) => issues.some((i) => i.milestone?.title === m.title))?.title ?? null
  const blockedReason = (i) => {
    if (i.ids.includes('blocked')) return 'has the blocked label'
    if (!deps) return null
    const open = tracker.blockers(i.number).filter((b) => b.state === 'open')
    return open.length ? `blocked by ${open.map((b) => `#${b.number}`).join(', ')}` : null
  }
  const epic = (i) => i.ids.includes('type:epic')
  const inFlight = branchIssues(git)

  // 3 and 4. Issues assigned to me: in progress first (a branch exists), then the rest by milestone and priority.
  const mine = issues.filter((i) => i.assignees.includes(me) && !epic(i))
  const unblocks = new Map(deps ? mine.map((i) => [i.number, tracker.blocking(i.number).filter((b) => b.state === 'open').length]) : [])
  const keyed = mine.map((i) => ({ i, p: priorityOf(i.ids), m: rank(i), u: unblocks.get(i.number) ?? 0, going: inFlight.has(i.number) }))
  keyed.sort((a, b) => compare([a.going ? 0 : 1, a.m, a.p, -a.u, a.i.number], [b.going ? 0 : 1, b.m, b.p, -b.u, b.i.number]))
  for (const { i, p, u, going } of keyed) {
    const blocked = blockedReason(i)
    if (blocked) { excluded.push({ number: i.number, title: i.title, reason: blocked }); continue }
    const why = going
      ? `assigned to you and in progress (a branch exists)`
      : [`assigned to you`, i.milestone ? `in ${i.milestone.title}` : 'no milestone', pLabel(p), u ? `unblocks ${u}` : null].filter(Boolean).join(', ')
    add({ tier: going ? 3 : 4, kind: 'issue', number: i.number, title: i.title, url: i.url, reason: why, action: going ? `continue #${i.number}` : `agent-os start ${i.number}` })
  }

  // 5. Unassigned issues in the current milestone, with a bonus for the areas of what I closed recently.
  if (current) {
    const recent = new Set(tracker.recentlyClosed(me).flatMap((i) => areasOf(i.labels.map(labelId))))
    const pool = issues.filter((i) => i.milestone?.title === current && !epic(i) && !i.assignees.includes(me))
    for (const i of pool.filter((x) => x.assignees.length)) excluded.push({ number: i.number, title: i.title, reason: `assigned to ${i.assignees.map((a) => `@${a}`).join(', ')}` })
    const open = pool.filter((i) => !i.assignees.length).map((i) => ({ i, p: priorityOf(i.ids), bonus: areasOf(i.ids).filter((a) => recent.has(a)) }))
    open.sort((a, b) => compare([a.p, -a.bonus.length, a.i.number], [b.p, -b.bonus.length, b.i.number]))
    for (const { i, p, bonus } of open) {
      if (picks.length >= limit) break
      const blocked = blockedReason(i)
      if (blocked) { excluded.push({ number: i.number, title: i.title, reason: blocked }); continue }
      add({ tier: 5, kind: 'issue', number: i.number, title: i.title, url: i.url, reason: [`unassigned in ${current}`, pLabel(p), bonus.length ? `in your recent areas (${bonus.join(', ')})` : null].filter(Boolean).join(', '), action: `agent-os start ${i.number}` })
    }
  }

  return {
    me,
    currentMilestone: current,
    recommendations: picks.slice(0, limit).map((p, k) => ({ rank: k + 1, ...p })),
    more: Math.max(0, picks.length - limit),
    excluded,
    warnings: [...(tracker.warnings ?? []), ...(deps ? [] : ['the platform has no dependency links here: only the blocked label marks blocked issues'])],
  }
}
