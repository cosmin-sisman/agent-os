// /upstream: improvements to agent-os found in a project, drafted for the public repository without anything private.
// The draft is built from a whitelist (version, profile, skill or command, configuration key names, OS and Node,
// and the description filtered), the person sees the exact text, and only that text (and its filtered title, for the
// duplicate search) ever leaves the project. Design §18.

import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { CliError } from '../cli/errors.mjs'
import { keyPaths } from '../config/config.mjs'
import { COMMANDS } from '../cli/registry.mjs'
import { isLiteralSecret } from '../env/checks.mjs'
import { similarity } from '../tracker/ticket.mjs'
import { slugify, stampOf } from '../journal/journal.mjs'

export const UPSTREAM_REPO = 'cosmin-sisman/agent-os'
const TOKEN = /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|sk-(ant-)?[A-Za-z0-9_-]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g

/** Words of the project that must never leave it: its name, owner, folder name, remote host and people. */
export function privateTerms({ cwd, config, extra = [] }) {
  const p = config.platform ?? {}
  const terms = new Set(extra.filter(Boolean))
  if (p.project) for (const part of p.project.split('/')) terms.add(part)
  if (p.project) terms.add(p.project)
  if (p.host) { try { terms.add(new URL(p.host).host) } catch { /* not a URL */ } }
  if (p.board?.owner) terms.add(p.board.owner)
  terms.add(basename(cwd))
  for (const t of ['agent-os', 'github', 'gitlab', 'github.com', 'gitlab.com', 'cosmin-sisman']) terms.delete(t)
  return [...terms].filter((t) => t.length >= 3)
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const SAFE_INLINE = (t, keys, commands) => /^agent-os(\s[\w-]+)?(\s--[\w-]+)*$/.test(t) || keys.has(t) || /^\/[a-z][\w-]*$/.test(t) && commands.has(t.slice(1))

/**
 * The text with everything private removed: code blocks, inline code that is not an agent-os command, key or skill,
 * paths, URLs (but the agent-os repository's), emails, @mentions, secrets and the project's own terms.
 * @returns {{ text: string, removed: Record<string, number> }}
 */
export function sanitize(text, { terms = [] } = {}) {
  const removed = {}
  const count = (kind, n = 1) => { removed[kind] = (removed[kind] ?? 0) + n }
  const keys = new Set(keyPaths().map((k) => k))
  const commands = new Set([...COMMANDS.map((c) => c.name), 'start', 'next', 'pr', 'mr', 'ship', 'release', 'ticket', 'test', 'retro', 'lessons', 'doctor', 'env', 'standards', 'upstream'])
  let t = String(text ?? '')
  t = t.replace(/```[\s\S]*?```/g, () => { count('code blocks'); return '[code removed]' })
  t = t.replace(TOKEN, () => { count('secrets'); return '[secret removed]' })
  t = t.replace(/`([^`\n]+)`/g, (m, inner) => (SAFE_INLINE(inner.trim(), keys, commands) ? m : (count('inline code'), '[code removed]')))
  t = t.replace(/\bhttps?:\/\/[^\s)>\]]+/g, (u) => (u.includes(`github.com/${UPSTREAM_REPO}`) ? u : (count('links'), '[link removed]')))
  t = t.replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, () => { count('emails'); return '[email removed]' })
  t = t.replace(/(^|\s)@[A-Za-z0-9][\w-]*/g, (m, pre) => { count('mentions'); return `${pre}[person removed]` })
  t = t.replace(/(?:[A-Za-z]:\\|~\/|\/(?:home|Users|var|opt|srv|tmp|mnt)\/)[^\s'"`);,]+/g, () => { count('paths'); return '[path removed]' })
  t = t.replace(/(?<![\w/])(?:\.{0,2}\/)?(?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]{1,6}\b/g, (m) => (/^(\.claude|\.agent-os)\//.test(m) ? m : (count('paths'), '[path removed]')))
  for (const term of terms) {
    const re = new RegExp(`\\b${esc(term)}\\b`, 'gi')
    t = t.replace(re, () => { count('project names'); return '[project]' })
  }
  t = t.split(/\r?\n/).map((l) => (isLiteralSecret('token', l.split('=').slice(1).join('=').trim()) && /=/.test(l) ? (count('secrets'), '[secret removed]') : l)).join('\n')
  return { text: t.replace(/[ \t]+$/gm, '').trim(), removed }
}

/**
 * The draft issue for the upstream repository, from whitelisted fields only.
 * @param {{ kind?: 'feature' | 'bug', title: string, what: string, proposal?: string, where?: string, configKeys?: string[], profile?: string }} input
 * @param {{ cwd: string, config: object, version: string, os?: string, node?: string, terms?: string[] }} context
 */
export function draftUpstream(input, { cwd, config, version, os = process.platform, node = process.versions.node, terms }) {
  const t = terms ?? privateTerms({ cwd, config })
  const title = sanitize(input.title, { terms: t })
  const what = sanitize(input.what, { terms: t })
  const proposal = sanitize(input.proposal ?? '', { terms: t })
  const known = new Set(keyPaths())
  const keys = (input.configKeys ?? []).filter((k) => known.has(k))
  const where = input.where && /^(\/[a-z][\w-]*|agent-os [\w-]+)$/.test(input.where) ? input.where : null
  const removed = {}
  for (const r of [title.removed, what.removed, proposal.removed]) for (const [k, n] of Object.entries(r)) removed[k] = (removed[k] ?? 0) + n
  const body = [
    '### agent-os version', '', version, '',
    '### Profile', '', ['greenfield', 'spec-first', 'active', 'maintenance'].includes(input.profile) ? input.profile : 'unknown', '',
    '### Skill or command', '', where ?? '_not given_', '',
    '### What happened or what is missing', '', what.text || '_not given_', '',
    ...(proposal.text ? ['### Proposal', '', proposal.text, ''] : []),
    '### Environment', '', `${os}, Node ${node}${keys.length ? `; configuration keys involved: ${keys.map((k) => `\`${k}\``).join(', ')}` : ''}`, '',
    '_Drafted by `/upstream`: project names, code, paths, links, people and secrets were removed before this text was shown for approval._',
  ].join('\n')
  // A title is one clause: the first sentence (or what comes before a later colon), cut at a word boundary. A short
  // `<Area>: ` prefix (up to three words) belongs to the convention and is kept with the clause after it (#266).
  const area = title.text.match(/^([^\s:.!?][^:.!?]{0,29}):\s+(?=\S)/)
  const prefix = area && area[1].trim().split(/\s+/).length <= 3 ? area[0].replace(/\s+$/, ' ') : ''
  let short = prefix + title.text.slice(prefix ? area[0].length : 0).split(/(?<=[.!?])\s|:\s/)[0].replace(/[.!?]$/, '')
  if (short.length > 90) short = short.slice(0, 90).replace(/\s+\S*$/, '').replace(/\s*\[[^\]]*$/, '')
  return { title: short, body, labels: [input.kind === 'bug' ? 'type:bug' : 'type:feature', 'upstream'], removed }
}

/** Existing upstream issues that look like the draft, searched with the filtered title only. */
export function upstreamDuplicates(tracker, draft, { threshold = 0.5 } = {}) {
  const words = draft.title.replace(/\[[^\]]*\]/g, ' ').replace(/[^\w\s-]/g, ' ').split(/\s+/).filter((w) => w.length > 3).slice(0, 8).join(' ')
  if (!words) return { query: '', matches: [] }
  const found = tracker.search(words, { limit: 10 }) ?? []
  return { query: words, matches: found.map((i) => ({ ...i, score: similarity(draft.title, i.title) })).filter((i) => i.score >= threshold).sort((a, b) => b.score - a.score) }
}

/** With upstream disabled, the draft goes to a local file instead (never committed). */
export function saveDraft(cwd, draft, { now = new Date() } = {}) {
  const dir = join(cwd, '.agent-os', 'cache', 'upstream')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${stampOf(now)}-${slugify(draft.title, 6)}.md`)
  writeFileSync(file, `# ${draft.title}\n\nLabels: ${draft.labels.join(', ')}\n\n${draft.body}\n`)
  return file.slice(cwd.length + 1).split('\\').join('/')
}

export const assertApproved = (approved) => { if (!approved) throw new CliError('nothing is sent until the exact text is approved', { hint: 'show the draft to the person, then run again with --approve' }) }
