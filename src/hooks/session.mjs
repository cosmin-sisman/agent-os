// The SessionStart context: what a session needs to start oriented, within a strict budget. Local facts come first and
// never need the network (branch and issue, lessons for the changed files, the lessons inbox, the skills); platform
// facts (assignments, reviews, the issue's title) are added when the platform answers quickly, and skipped otherwise.
// Nothing from .agent-os/local.json or the environment is included.

import { changedFiles } from '../gate/gate.mjs'
import { lessonsForChange, readLessons } from '../lessons/lessons.mjs'
import { indexLine, skillIndex } from '../registry/skill-index.mjs'

/** Lines are { p, text }: a lower p is more important and survives the budget longer. */
const line = (p, text) => ({ p, text })

/** "1.5KB" → bytes. */
export function budgetBytes(size, fallback = 1536) {
  const m = String(size ?? '').match(/^(\d+(?:\.\d+)?)\s?(B|KB|MB)$/)
  return m ? Math.floor(Number(m[1]) * { B: 1, KB: 1024, MB: 1024 ** 2 }[m[2]]) : fallback
}

/** Keeps the most important lines that fit the budget (in bytes), in their original order. */
export function fitBudget(lines, limit) {
  const order = lines.map((l, i) => ({ ...l, i })).sort((a, b) => a.p - b.p || a.i - b.i)
  const kept = []
  let used = 0
  for (const l of order) {
    const size = Buffer.byteLength(`${l.text}\n`)
    if (used + size > limit) continue
    kept.push(l)
    used += size
  }
  return { text: kept.sort((a, b) => a.i - b.i).map((l) => l.text).join('\n'), dropped: lines.length - kept.length, bytes: used }
}

const issueOf = (branch) => Number(String(branch ?? '').match(/(?:^|\/)(\d+)-/)?.[1]) || null

/** What the working tree says, offline. */
export function localContext({ config, cwd, git }) {
  const lines = []
  const r = git(['rev-parse', '--abbrev-ref', 'HEAD'])
  const branch = r.status === 0 ? r.stdout.trim() : null
  if (branch) {
    const n = issueOf(branch)
    lines.push(line(0, `agent-os: you are on ${branch}${n ? ` (issue #${n})` : [config.branches.integration, config.branches.production].includes(branch) ? '; start work with /start <issue> or ask /next' : ''}.`))
  }
  let files = []
  try { files = branch && ![config.branches.integration, config.branches.production].includes(branch) ? changedFiles(git, config.branches.integration) : [] } catch { files = [] }
  const lessons = files.length ? lessonsForChange(cwd, { paths: files }, { limit: 2, budget: 200 }) : []
  if (lessons.length) lines.push(line(20, `Lessons for the files you changed: ${lessons.map((l) => `${l.id}: ${l.text}`).join(' | ')}`))
  const inbox = readLessons(cwd).filter((c) => c.state === 'inbox').length
  if (inbox) lines.push(line(30, `${inbox} lesson(s) wait in the inbox (/lessons review).`))
  const skills = indexLine(skillIndex(cwd))
  if (skills) lines.push(line(40, skills))
  return { lines, branch }
}

/** What the platform says; empty when it does not answer (offline, no login, a timeout). */
export function remoteContext({ tracker, branch, limit = 5 }) {
  const lines = []
  try {
    const me = tracker.whoami()
    const n = issueOf(branch)
    if (n) { const i = tracker.get(n); lines.push(line(1, `Issue #${n}: ${i.title} (${i.state}).`)) }
    const mine = tracker.assignedIssues(me, { limit })
    if (mine.length) lines.push(line(10, `Assigned to you: ${mine.map((i) => `#${i.number} ${i.title}`).join('; ')}.`))
    const reviews = tracker.pullRequests(`review-requested:${me}`).slice(0, limit)
    if (reviews.length) lines.push(line(11, `Reviews requested from you: ${reviews.map((p) => `#${p.number} ${p.title}`).join('; ')}.`))
  } catch { return { lines: [] } }
  return { lines }
}
