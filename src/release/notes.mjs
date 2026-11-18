// Release notes: the change requests merged between two points, grouped the way `update --plan` groups them
// (Breaking, New, Deprecated, Legacy, Removed, Fixes, Chore), from changelog:* labels first and type labels after,
// plus the journal entries added in the range. Every breaking item must name its migration. Design §19.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { CliError } from '../cli/errors.mjs'
import { GROUPS } from '../update/update.mjs'
import { readJournal } from '../journal/journal.mjs'
import { labelId } from '../workflow/next.mjs'

const BY_CHANGELOG = { 'changelog:breaking': 'breaking', 'changelog:new': 'new', 'changelog:deprecation': 'deprecated', 'changelog:legacy': 'legacy', 'changelog:removed': 'removed' }
const BY_TYPE = { 'type:feature': 'new', 'type:bug': 'fix', 'type:docs': 'chore', 'type:chore': 'chore', 'type:research': 'chore' }
const BY_PREFIX = { feat: 'new', fix: 'fix', docs: 'chore', chore: 'chore', refactor: 'chore', test: 'chore', ci: 'chore', perf: 'fix' }
const TITLES = { breaking: 'Breaking', new: 'New', deprecated: 'Deprecated', legacy: 'Legacy', removed: 'Removed', fix: 'Fixes', chore: 'Chore' }

const ok = (r) => r.status === 0
const lines = (r) => (ok(r) ? r.stdout.split(/\r?\n/).filter(Boolean) : null)

/** Change request numbers merged in a range, from squash subjects "… (#N)" and merge commits "Merge pull request #N". */
export function mergedNumbers(git, from, to = 'HEAD') {
  const out = lines(git(['log', '--format=%s', `${from}..${to}`]))
  if (out === null) throw new CliError(`cannot read the history ${from}..${to}`, { hint: 'pass an existing tag or commit with --from' })
  return [...new Set(out.map((s) => Number(s.match(/\((?:#|!)(\d+)\)$/)?.[1] ?? s.match(/^Merge (?:pull|merge) request [#!](\d+)/)?.[1])).filter(Boolean))].sort((a, b) => a - b)
}

/** A "Key: value" line from a body (Replacement:, Migration:), outside comments. */
const field = (body, key) => String(body ?? '').replace(/<!--[\s\S]*?-->/g, '').match(new RegExp(`^\\s*(?:[-*]\\s*)?\\**${key}\\**\\s*:\\s*(.+)$`, 'mi'))?.[1].trim().replace(/^`|`$/g, '') ?? null

/** The group of one change request: changelog label, then type label, then the title's type. */
export function groupOf({ labels = [], title = '' }) {
  const ids = labels.map(labelId)
  for (const id of ids) if (BY_CHANGELOG[id]) return BY_CHANGELOG[id]
  for (const id of ids) if (BY_TYPE[id]) return BY_TYPE[id]
  const prefix = String(title).match(/^(\w+)(\([^)]*\))?(!)?:/)
  if (prefix?.[3]) return 'breaking'
  return BY_PREFIX[prefix?.[1]] ?? 'chore'
}

/**
 * The notes for a release.
 * @param {{ git: Function, tracker: object, cwd: string, vocab: object }} deps
 * @param {{ from: string, to?: string, version: string }} range
 */
export function releaseNotes({ git, tracker, cwd, vocab }, { from, to = 'HEAD', version }) {
  const groups = Object.fromEntries(GROUPS.map((g) => [g, []]))
  const problems = []
  for (const n of mergedNumbers(git, from, to)) {
    const cr = tracker.get(n)
    const group = groupOf(cr)
    const title = String(cr.title).replace(/\s*\[[#\d,\s]+\]$/, '')
    const item = { number: n, title, url: cr.url ?? null, group }
    if (group === 'breaking' || group === 'removed') {
      item.migration = field(cr.body, 'Migration') ?? (existsSync(join(cwd, 'migrations', `${version}.mjs`)) ? `migrations/${version}.mjs` : null)
      if (!item.migration) problems.push(`${vocab.crRef}${n} is ${group === 'breaking' ? 'breaking' : 'a removal'} but names no migration: add "Migration: migrations/${version}.mjs" to its description, or write that migration`)
    }
    if (group === 'deprecated') {
      item.replacement = field(cr.body, 'Replacement')
      if (!item.replacement) problems.push(`${vocab.crRef}${n} deprecates something but names no replacement: add "Replacement: <what to use instead>" to its description`)
    }
    groups[group].push(item)
  }
  const added = lines(git(['diff', '--name-only', '--diff-filter=A', `${from}..${to}`, '--', '.agent-os/journal'])) ?? []
  const journal = readJournal(cwd).filter((e) => added.includes(e.path) && ['decision', 'incident', 'release'].includes(e.meta.type)).map((e) => ({ type: e.meta.type, title: e.title, path: e.path }))
  return { version, from, to, groups, journal, problems }
}

/** The notes as Markdown for the release page. */
export function notesMarkdown(notes, vocab) {
  const out = []
  for (const g of GROUPS) {
    const list = notes.groups[g]
    if (!list.length) continue
    out.push(`## ${TITLES[g]}`, '', ...list.map((i) => `- ${i.title} (${vocab.crRef}${i.number})${i.migration ? `. Migration: \`${i.migration}\`` : ''}${i.replacement ? `. Use instead: ${i.replacement}` : ''}`), '')
  }
  if (notes.journal.length) out.push('## Decisions and incidents', '', ...notes.journal.map((e) => `- ${e.title} (\`${e.path}\`)`), '')
  if (!out.length) out.push('_No change requests were merged in this range._', '')
  out.push(`To upgrade: \`npx -y @cosmin-sisman/agent-os@${notes.version} update --plan\`, then \`update\`.`)
  return out.join('\n')
}

/** The entry `update --plan` reads from changelog.yaml. */
export function changelogEntry(notes, { date }) {
  return {
    version: notes.version, date,
    changes: GROUPS.flatMap((g) => notes.groups[g].map((i) => ({ group: g, text: `${i.title}${i.replacement ? ` (use instead: ${i.replacement})` : ''}`, refs: [`#${i.number}`], ...(i.migration ? { migration: i.migration } : {}) }))),
  }
}
