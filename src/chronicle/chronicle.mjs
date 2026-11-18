// The chronicle: one timeline from the platform (issues, change requests, comments, reviews, milestones, releases)
// and the journal, rendered on demand into the cache and never committed. Every line links its source. Filtering by
// an issue follows the conversation to the change requests that close or reference it. Design §10.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { issueRefs } from '../conventions/conventions.mjs'
import { readJournal } from '../journal/journal.mjs'
import { labelId } from '../workflow/next.mjs'

export const CACHE_MD = '.agent-os/cache/chronicle.md'
export const CACHE_JSON = '.agent-os/cache/chronicle.json'

const WHAT = {
  'issue-opened': 'opened', 'issue-closed': 'closed', 'cr-opened': 'opened', 'cr-closed': 'closed without merging', 'cr-merged': 'merged',
  comment: 'comment', review: 'review', 'milestone-opened': 'milestone opened', 'milestone-closed': 'milestone closed', release: 'released',
}
const oneLine = (text, max = 100) => { const t = String(text ?? '').replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ').trim(); return t.length > max ? `${t.slice(0, max - 1)}…` : t }

/**
 * Builds the timeline.
 * @param {{ tracker: object, cwd: string, vocab: object }} deps
 * @param {{ since: string, issue?: number, area?: string }} filter since is an ISO date or time
 */
export function chronicle({ tracker, cwd, vocab }, { since, issue, area }) {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(since) ? `${since}T00:00:00Z` : since
  const events = tracker.activity(from)
  // Change requests that close or reference the issue belong to its story.
  const related = new Set(issue ? [issue] : [])
  if (issue) for (const e of events) if (e.cr && e.number && [...issueRefs(e.body).closes, ...issueRefs(e.body).refs].includes(issue)) related.add(e.number)
  const byArea = (labels) => !area || labels.map(labelId).includes(`area:${area}`)
  const lines = []
  for (const e of events) {
    if (issue && !related.has(e.number)) continue
    if (area && !byArea(e.labels ?? [])) continue
    const ref = e.number ? `${e.cr ? vocab.crRef : '#'}${e.number}` : ''
    const subject = e.kind.startsWith('milestone') || e.kind === 'release' ? e.title : `${e.cr ? vocab.cr : 'issue'} ${ref}${e.title ? ` ${e.title}` : ''}`
    const detail = e.kind === 'comment' || e.kind === 'review' ? `: "${oneLine(e.body)}"` : ''
    lines.push({ at: e.at, source: 'platform', kind: e.kind, ref, actor: e.actor, url: e.url, text: `${subject} ${WHAT[e.kind] ?? e.kind}${e.actor ? ` by @${e.actor}` : ''}${detail}` })
  }
  for (const j of readJournal(cwd)) {
    if (!j.at || j.at < from) continue
    const refs = (j.meta.refs ?? []).map((r) => Number(String(r).match(/^[#!](\d+)$/)?.[1])).filter(Boolean)
    if (issue && !refs.some((n) => related.has(n))) continue
    if (area && !(j.meta.areas ?? []).includes(area)) continue
    lines.push({ at: j.at, source: 'journal', kind: `journal-${j.meta.type}`, ref: refs.map((n) => `#${n}`).join(' '), actor: j.meta.author ?? null, url: j.path, text: `journal ${j.meta.type}: ${j.title}${j.meta.author ? ` by @${j.meta.author}` : ''}` })
  }
  lines.sort((a, b) => a.at.localeCompare(b.at) || a.source.localeCompare(b.source))
  return { since: from, issue: issue ?? null, area: area ?? null, related: [...related].sort((a, b) => a - b), lines }
}

/** Markdown: one line per event, each linking its source. */
export function chronicleMarkdown(c) {
  const head = `# Chronicle since ${c.since.slice(0, 10)}${c.issue ? ` for #${c.issue}${c.related.length > 1 ? ` (with ${c.related.filter((n) => n !== c.issue).map((n) => `#${n}`).join(', ')})` : ''}` : ''}${c.area ? `, area ${c.area}` : ''}`
  // The render lives in .agent-os/cache/, so links to repository files climb back to the root.
  const href = (url) => (/^[a-z]+:/i.test(url) ? url : `../../${url}`)
  const body = c.lines.map((l) => `- ${l.at.replace('T', ' ').slice(0, 16)}  [${l.text}](${href(l.url)})`)
  return [head, '', ...(body.length ? body : ['_Nothing happened in this range._']), ''].join('\n')
}

/** Writes the render into the cache (never committed). */
export function writeChronicle(cwd, c) {
  mkdirSync(join(cwd, '.agent-os', 'cache'), { recursive: true })
  writeFileSync(join(cwd, CACHE_MD), chronicleMarkdown(c))
  writeFileSync(join(cwd, CACHE_JSON), `${JSON.stringify(c, null, 2)}\n`)
}
