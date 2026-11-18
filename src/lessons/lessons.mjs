// Lessons learned: advice that should change future behaviour, kept apart from the journal because it has a
// lifecycle. inbox/ holds captured cards (one file per capture, so captures never conflict), active/ the accepted
// ones that recall returns, retired/ those absorbed into a rule or no longer true. Recall is read-only: the
// recalled/followed counters have a single writer, /retro (#29). Design §10.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CliError } from '../cli/errors.mjs'
import { findDiacritics } from '../i18n/i18n.mjs'
import { slugify, splitEntry, stampOf } from '../journal/journal.mjs'
import { matches } from '../util/glob.mjs'
import { scalar } from '../yaml/yaml.mjs'
import { labelId } from '../workflow/next.mjs'

const areaOf = (label) => labelId(label).match(/^area:(.+)$/)?.[1] ?? null

export const LESSONS_DIR = '.agent-os/lessons'
export const STATES = ['inbox', 'active', 'retired']
export const CONFIDENCE = ['low', 'likely', 'medium', 'high']
const WEIGHT = { low: 0.6, likely: 0.8, medium: 0.8, high: 1 }
const AREA = /^[a-z0-9][a-z0-9-]*$/

/** Every card, in every state, with its parsed front matter, sorted by state then id. */
export function readLessons(cwd) {
  const out = []
  for (const state of STATES) {
    const dir = join(cwd, LESSONS_DIR, state)
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.md')).sort()) {
      const path = `${LESSONS_DIR}/${state}/${name}`
      const { meta, body, error } = splitEntry(readFileSync(join(cwd, path), 'utf8'), path)
      out.push({ id: name.slice(0, -3), state, path, meta: meta ?? {}, body: body.trim(), error, text: body.trim().split(/(?<=[.!?])\s/)[0] ?? '' })
    }
  }
  return out
}

/** The problems with one card. */
export function validateCard(card, { lang = 'en' } = {}) {
  if (card.error) return [card.error]
  const m = card.meta
  const problems = []
  const list = (key, test, what) => {
    if (m[key] === undefined) return
    if (!Array.isArray(m[key])) problems.push(`${key} must be a list`)
    else for (const v of m[key]) if (typeof v !== 'string' || (test && !test(v))) problems.push(`${key}: "${v}" ${what}`)
  }
  if (!Array.isArray(m.areas) || !m.areas.length) problems.push('areas must be a list with at least one area')
  else list('areas', (a) => AREA.test(a), 'must be lowercase kebab-case')
  list('paths', null, 'must be a glob string')
  list('keywords', null, 'must be a string')
  if (!m.paths?.length && !m.keywords?.length) problems.push('a card needs paths or keywords, or recall can only match it by area')
  if (typeof m.source !== 'string' || !m.source.trim()) problems.push('source must say where the lesson came from (an issue, PR, review comment or incident)')
  if (m.confidence !== undefined && !CONFIDENCE.includes(m.confidence)) problems.push(`confidence must be one of ${CONFIDENCE.join(', ')}`)
  for (const k of ['recalled', 'followed']) if (m[k] !== undefined && !(Number.isInteger(m[k]) && m[k] >= 0)) problems.push(`${k} must be a whole number (only /retro updates it)`)
  if (!card.body) problems.push('the body must state the lesson in one sentence, the reason and an example')
  if (lang === 'ro') for (const d of findDiacritics(card.body).slice(0, 3)) problems.push(`"${d.char}" in a ro lesson: write "${d.ascii}"`)
  return problems
}

const words = (text) => new Set(String(text).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9.:-]+/).filter((w) => w.length > 2))

/** Paths an issue mentions (`src/db/schema.ts`, src/db/), for recall before any file is touched. */
export const pathsIn = (text) => [...new Set([...String(text).matchAll(/(?:^|[\s`'"(])((?:\.?[\w-]+\/)+[\w.*-]*)/g)].map((m) => m[1]))]

/**
 * The active cards that apply to a context, best first, at most `limit` and within `budget` tokens (about 4
 * characters per token). Read-only: it never touches the counters.
 * @param {{ areas?: string[], paths?: string[], text?: string }} context
 */
export function recall(cards, { areas = [], paths = [], text = '' }, { limit = 3, budget = 400 } = {}) {
  const context = words(text)
  const scored = cards.filter((c) => c.state === 'active' && !c.error).map((c) => {
    const why = []
    const area = (c.meta.areas ?? []).filter((a) => areas.includes(a))
    if (area.length) why.push(`area ${area.join(', ')}`)
    const path = (c.meta.paths ?? []).filter((g) => paths.some((p) => matches(p, g) || matches(`${p.replace(/\/$/, '')}/x`, g)))
    if (path.length) why.push(`path ${path.join(', ')}`)
    const kw = (c.meta.keywords ?? []).filter((k) => context.has(String(k).toLowerCase()) || [...words(k)].every((w) => context.has(w)))
    if (kw.length) why.push(`keyword ${kw.join(', ')}`)
    const score = (3 * Math.min(area.length, 2) + 4 * Math.min(path.length, 2) + 2 * Math.min(kw.length, 3)) * (WEIGHT[c.meta.confidence] ?? 0.8)
    return { card: c, score: Math.round(score * 100) / 100, why }
  }).filter((x) => x.score > 0)
  scored.sort((a, b) => b.score - a.score || a.card.id.localeCompare(b.card.id))
  const out = []
  let used = 0
  for (const s of scored) {
    if (out.length >= limit) break
    const cost = Math.ceil(s.card.text.length / 4) + 12
    if (out.length && used + cost > budget) break
    used += cost
    out.push({ id: s.card.id, text: s.card.text, score: s.score, why: s.why, path: s.card.path, ...(s.card.meta.promotedTo ? { promotedTo: s.card.meta.promotedTo } : {}) })
  }
  return { lessons: out, considered: scored.length, tokens: used }
}

/** Cards matching words in their text, keywords or source; active and inbox by default. */
export function search(cards, query, { states = ['active', 'inbox'] } = {}) {
  const q = [...words(query)]
  if (!q.length) throw new CliError('search for at least one word of three letters or more')
  return cards.filter((c) => states.includes(c.state)).map((c) => {
    const hay = words(`${c.body} ${(c.meta.keywords ?? []).join(' ')} ${c.meta.source ?? ''} ${(c.meta.areas ?? []).join(' ')}`)
    return { card: c, hits: q.filter((w) => hay.has(w)).length }
  }).filter((x) => x.hits).sort((a, b) => b.hits - a.hits || a.card.id.localeCompare(b.card.id)).map(({ card, hits }) => ({ id: card.id, state: card.state, text: card.text, hits, path: card.path }))
}

const front = (meta) => ['---', ...Object.entries(meta).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.map((x) => (/^[a-z0-9-]+$/.test(x) ? x : JSON.stringify(x))).join(', ')}]` : typeof v === 'number' ? v : scalar(String(v))}`), '---', ''].join('\n')

/** Captures a lesson into the inbox. One file per capture: <UTC minute>-<author>-<slug>.md. */
export function addLesson(cwd, { text, areas, paths = [], keywords = [], source, confidence = 'medium', author, at = new Date(), lang = 'en', dryRun = false }) {
  const base = `${stampOf(at)}-${author}-${slugify(text, 5)}`
  const dir = join(cwd, LESSONS_DIR, 'inbox')
  let name = `${base}.md`
  for (let k = 2; existsSync(join(dir, name)); k++) name = `${base}-${k}.md`
  const content = `${front({ areas, paths, keywords, source, confidence })}\n${text.trim()}\n`
  const card = { id: name.slice(0, -3), state: 'inbox', path: `${LESSONS_DIR}/inbox/${name}`, ...splitEntry(content), }
  card.body = card.body.trim()
  const problems = validateCard(card, { lang })
  if (problems.length) return { written: false, path: card.path, problems }
  if (!dryRun) { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, name), content) }
  return { written: !dryRun, dryRun, path: card.path, content }
}

const find = (cards, id, states) => {
  const hits = cards.filter((c) => states.includes(c.state) && (c.id === id || c.id.endsWith(id)))
  if (hits.length !== 1) throw new CliError(hits.length ? `"${id}" matches ${hits.length} cards` : `no ${states.join(' or ')} card "${id}"`, { hint: hits.map((c) => c.id).join(', ') || 'agent-os lessons review' })
  return hits[0]
}

const rewrite = (cwd, card, meta, to, name = `${card.id}.md`) => {
  const dir = join(cwd, LESSONS_DIR, to)
  mkdirSync(dir, { recursive: true })
  const target = join(dir, name)
  if (existsSync(target) && `${LESSONS_DIR}/${to}/${name}` !== card.path) throw new CliError(`${LESSONS_DIR}/${to}/${name} already exists`, { hint: 'pick another name with --as' })
  writeFileSync(join(cwd, card.path), `${front(meta)}\n${card.body}\n`)
  if (`${LESSONS_DIR}/${to}/${name}` !== card.path) renameSync(join(cwd, card.path), target)
  return `${LESSONS_DIR}/${to}/${name}`
}

/** Accepts an inbox card: it becomes active under a short slug. */
export function acceptLesson(cwd, id, { as, dryRun = false } = {}) {
  const card = find(readLessons(cwd), id, ['inbox'])
  const problems = validateCard(card)
  if (problems.length) throw new CliError(`${card.path} is not valid: ${problems.join('; ')}`, { hint: 'fix the card, then accept it' })
  const slug = as ?? slugify(card.text, 4)
  if (dryRun) return { dryRun: true, from: card.path, to: `${LESSONS_DIR}/active/${slug}.md` }
  return { from: card.path, to: rewrite(cwd, card, { ...card.meta, recalled: card.meta.recalled ?? 0, followed: card.meta.followed ?? 0 }, 'active', `${slug}.md`) }
}

/** Records the rule a card became; the card stays active until /retro or retire takes it out. */
export function promoteLesson(cwd, id, { to, dryRun = false }) {
  if (!to) throw new CliError('--to is required: the rule or file the lesson became (for example "AGENTS.md: Conventions")')
  const card = find(readLessons(cwd), id, ['active', 'inbox'])
  if (dryRun) return { dryRun: true, path: card.path, promotedTo: to }
  return { path: rewrite(cwd, card, { ...card.meta, promotedTo: to }, card.state), promotedTo: to }
}

/** Retires a card (absorbed into a rule, or no longer true), keeping it for history. */
export function retireLesson(cwd, id, { reason, at = new Date(), dryRun = false }) {
  if (!reason) throw new CliError('--reason is required: why the lesson no longer needs recalling')
  const card = find(readLessons(cwd), id, ['active', 'inbox'])
  if (dryRun) return { dryRun: true, from: card.path, to: `${LESSONS_DIR}/retired/${card.id}.md` }
  return { from: card.path, to: rewrite(cwd, card, { ...card.meta, retired: at.toISOString().slice(0, 10), retiredBecause: reason }, 'retired') }
}

/** The lessons for an issue: its area labels (any language), the paths it mentions and its words. */
export function lessonsForIssue(cwd, issue, options) {
  const areas = (issue.labels ?? []).map(areaOf).filter(Boolean)
  const text = `${issue.title ?? ''}\n${issue.body ?? ''}`
  return recall(readLessons(cwd), { areas, paths: pathsIn(text), text }, options).lessons
}

/** The lessons for a set of changed files and a description. */
export const lessonsForChange = (cwd, { paths = [], text = '' }, options) => recall(readLessons(cwd), { areas: [], paths, text }, options).lessons

/** One line per recalled lesson, for command output and skills. */
export const lessonLines = (lessons) => lessons.map((l) => `  lesson ${l.id} (${l.why.join('; ')}): ${l.text}`)
