// /ingest-docs (design §11, profile `spec-first`): existing specifications become epics and sub-issues, each linked
// to the section it came from. Requirements are the list items and the "must / should / shall" sentences of each
// section. Statements that look like the same requirement but disagree (different numbers, or one negated) are
// contradictions: they are reported, and no issue is created until the person resolves each one.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { CliError } from '../cli/errors.mjs'

export const PLAN_FILE = '.agent-os/cache/ingest.json'
const DEFAULT_DIRS = ['docs', 'specs', 'spec', 'requirements']
const SKIP = /(^|\/)(node_modules|\.git|\.agent-os|\.claude|decisions|journal|CHANGELOG\.md|LICENSE)/i
const MODAL = /\b(must|shall|should|needs? to|has to|will|is required|are required|trebuie|va|vor)\b/i
const NEGATION = /\b(not|never|no|without|cannot|can't|mustn't|shouldn't|won't|nu|niciodata|fara)\b/i
const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'must', 'shall', 'should', 'will', 'have', 'has', 'are', 'is', 'be', 'been', 'not', 'never', 'can', 'cannot', 'need', 'needs', 'users', 'user', 'when', 'than', 'only', 'each', 'every', 'their', 'there', 'they', 'which', 'within', 'after', 'before', 'trebuie', 'sunt', 'este', 'care', 'pentru', 'without'])

/** The Markdown specifications under the given paths (files or folders), sorted. */
export function specFiles(root, paths = []) {
  const start = paths.length ? paths : DEFAULT_DIRS.filter((d) => existsSync(join(root, d)))
  const out = []
  const walk = (p) => {
    const abs = join(root, p)
    if (!existsSync(abs) || SKIP.test(p)) return
    if (statSync(abs).isDirectory()) for (const e of readdirSync(abs)) walk(`${p}/${e}`.replace(/^\.\//, ''))
    else if (/\.md$/i.test(p)) out.push(relative(root, abs).split('\\').join('/'))
  }
  for (const p of start) walk(p)
  return [...new Set(out)].sort()
}

/** The anchor a Markdown renderer gives a heading. */
export const anchor = (h) => h.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-')

/** The sections of one Markdown file, each with its heading path, line and requirement statements. */
export function sections(path, text) {
  const out = []
  const stack = []
  let cur = null
  let fence = false
  String(text).split(/\r?\n/).forEach((line, i) => {
    if (/^\s*```/.test(line)) { fence = !fence; return }
    if (fence) return
    const h = line.match(/^(#{1,4})\s+(.+?)\s*#*\s*$/)
    if (h) {
      const level = h[1].length
      while (stack.length && stack.at(-1).level >= level) stack.pop()
      stack.push({ level, title: h[2] })
      cur = { path, line: i + 1, level, heading: h[2], trail: stack.map((s) => s.title), anchor: anchor(h[2]), statements: [] }
      out.push(cur)
      return
    }
    if (!cur) return
    const item = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+)$/)
    const text2 = (item ? item[1] : line).trim()
    if (!text2 || /^\|/.test(text2) || /^>/.test(text2)) return
    if (item || MODAL.test(text2)) cur.statements.push({ text: text2.replace(/\s+/g, ' '), line: i + 1 })
  })
  return out
}

const words = (t) => new Set(t.toLowerCase().replace(/[0-9]+([.,][0-9]+)?/g, ' ').split(/[^\p{L}]+/u).filter((w) => w.length > 2 && !STOP.has(w)))
const numbers = (t) => (t.match(/\d+([.,]\d+)?/g) ?? []).join(',')
const overlap = (a, b) => { const i = [...a].filter((x) => b.has(x)).length; return i / Math.max(1, Math.min(a.size, b.size)) }

/** Pairs of statements about the same thing that disagree: different numbers, or one negated and the other not. */
export function contradictions(statements) {
  const out = []
  for (let i = 0; i < statements.length; i++) {
    for (let j = i + 1; j < statements.length; j++) {
      const a = statements[i]
      const b = statements[j]
      if (a.path === b.path && a.line === b.line) continue
      const wa = words(a.text)
      const wb = words(b.text)
      if (wa.size < 2 || wb.size < 2 || overlap(wa, wb) < 0.6) continue
      const na = numbers(a.text)
      const nb = numbers(b.text)
      const kind = na && nb && na !== nb ? 'numbers' : NEGATION.test(a.text) !== NEGATION.test(b.text) ? 'negation' : null
      if (kind) out.push({ id: `c${out.length + 1}`, kind, a, b })
    }
  }
  return out
}

const cite = (s) => `\`${s.path}\` line ${s.line}${s.trail ? `, section "${s.trail.join(' › ')}"` : ''}`
const short = (t, n = 64) => (t.length > n ? `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : t).replace(/[.:;]$/, '')

/**
 * The plan: one epic per top section (the highest heading level under the title) that holds requirements, one
 * sub-issue per requirement, each citing its source; and the contradictions to resolve first.
 */
export function ingestPlan(root, paths = []) {
  const files = specFiles(root, paths)
  if (!files.length) throw new CliError('no specifications found', { hint: 'agent-os ingest plan docs/ (Markdown files), or pass the files' })
  const all = files.flatMap((f) => sections(f, readFileSync(join(root, f), 'utf8')))
  const statements = all.flatMap((s) => s.statements.map((st) => ({ ...st, path: s.path, trail: s.trail })))
  const epics = []
  for (const f of files) {
    const own = all.filter((s) => s.path === f)
    const base = Math.min(...own.filter((s) => s.level > 1).map((s) => s.level), 9)
    for (const top of own.filter((s) => s.level === base || (base === 9 && s.level === 1))) {
      const inside = own.filter((s) => s.line >= top.line && (s === top || s.trail.slice(0, top.trail.length).join('\u0000') === top.trail.join('\u0000')))
      const reqs = inside.flatMap((s) => s.statements.map((st) => ({ ...st, path: f, trail: s.trail, anchor: s.anchor })))
      if (!reqs.length) continue
      const id = `${f.replace(/\.md$/i, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}#${top.anchor}`
      epics.push({
        id, title: top.heading, source: { path: f, line: top.line, anchor: top.anchor, trail: top.trail },
        children: reqs.map((r, k) => ({ id: `${id}/${k + 1}`, title: `${short(top.heading, 30)}: ${short(r.text)}`, text: r.text, source: { path: f, line: r.line, anchor: r.anchor, trail: r.trail } })),
      })
    }
  }
  return { files, epics, contradictions: contradictions(statements), issues: epics.reduce((n, e) => n + 1 + e.children.length, 0) }
}

/** The body of an issue made from a spec: what it says, and the source section it cites. */
export function issueBody(item, { epic = null, lang = 'en' } = {}) {
  const src = cite({ path: item.source.path, line: item.source.line, trail: item.source.trail })
  const link = `${item.source.path}#${item.source.anchor}`
  return lang === 'ro'
    ? ['## Context', '', `Din specificatie: ${src} ([${link}](${link})).`, '', ...(item.text ? ['## Scop', '', item.text, ''] : []), ...(epic ? [`Parte din epicul "${epic}".`, ''] : []), '## Criterii de acceptare', '', '- [ ] ce spune sectiunea sursa', ''].join('\n')
    : ['## Context', '', `From the specification: ${src} ([${link}](${link})).`, '', ...(item.text ? ['## Goal', '', item.text, ''] : []), ...(epic ? [`Part of the epic "${epic}".`, ''] : []), '## Acceptance criteria', '', '- [ ] what the source section says', ''].join('\n')
}

/**
 * Applies a reviewed plan: refuses while a contradiction has no resolution (a = keep the first statement, b = keep
 * the second, both = they do not conflict). The losing statement's sub-issue is not created.
 */
export function ingestApply(plan, { tracker, resolve = {}, labels = {}, milestone, lang = 'en', dryRun = false }) {
  const open = plan.contradictions.filter((c) => !['a', 'b', 'both'].includes(resolve[c.id]))
  if (open.length) return { created: [], blocked: open }
  const drop = new Set(plan.contradictions.filter((c) => resolve[c.id] !== 'both').map((c) => { const lose = resolve[c.id] === 'a' ? c.b : c.a; return `${lose.path}:${lose.line}` }))
  const created = []
  // A milestone named for the work (MVP, Beta) is created when it does not exist yet.
  let milestoneCreated = false
  if (milestone && typeof tracker.milestones === 'function' && !tracker.milestones().some((m) => m.title === milestone)) { tracker.createMilestone({ title: milestone, description: 'Created by agent-os ingest from the specifications' }, { dryRun }); milestoneCreated = true }
  for (const e of plan.epics) {
    const kids = e.children.filter((k) => !drop.has(`${k.source.path}:${k.source.line}`))
    if (!kids.length) continue
    const epic = tracker.create({ title: e.title, body: issueBody(e, { lang }), labels: labels.epic ?? [], milestone }, { dryRun })
    created.push({ id: e.id, number: epic.number ?? null, title: e.title, source: e.source })
    for (const k of kids) {
      const r = tracker.create({ title: k.title, body: issueBody(k, { epic: e.title, lang }), labels: labels.child ?? [], milestone, parent: epic.number }, { dryRun })
      created.push({ id: k.id, number: r.number ?? null, title: k.title, parent: epic.number ?? null, source: k.source })
    }
  }
  return { created, blocked: [], dropped: [...drop], milestoneCreated }
}
