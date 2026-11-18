// `agent-os journal`: add an entry, list or show entries, check them all. One file per entry, so branches never
// conflict; lists are rendered on demand and never committed.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CliError, EXIT } from '../cli/errors.mjs'
import { loadConfig } from '../config/config.mjs'
import { languageFor } from '../i18n/i18n.mjs'
import { addEntry, filterEntries, readJournal, TYPES, validate } from '../journal/journal.mjs'
import { ghClient } from '../tracker/gh.mjs'
import { createTracker } from '../tracker/tracker.mjs'
import { decisionsSection, readThread } from '../collab/thread.mjs'

export const usage = 'agent-os journal [list [filters] | show <id> | add --type <t> --title <text> --area <a>… [--ref <#N>…] [--body-file <f>] [--thread <#N|!N>…] | check]'

export const options = {
  type: { type: 'string', description: `Entry type: ${TYPES.join(', ')} (add; a filter for list)` },
  title: { type: 'string', description: 'add: the entry title' },
  body: { type: 'string', description: 'add: the body text' },
  'body-file': { type: 'string', description: 'add: read the body from a file' },
  area: { type: 'string', multiple: true, description: 'An area (repeat for several; list: filter by one)' },
  ref: { type: 'string', multiple: true, description: 'A reference: #N, !N, &N or a decision id (repeat; list: filter by one)' },
  author: { type: 'string', description: 'add: the author login (default: your platform login); list: filter' },
  at: { type: 'string', description: 'add: the time of the entry (ISO 8601, default now)' },
  since: { type: 'string', description: 'list: from this date or time' },
  until: { type: 'string', description: 'list: up to this date or time' },
  thread: { type: 'string', multiple: true, description: 'add: quote the decisions made in the comments of this issue (#N) or change request (!N), verbatim' },
}

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  const [action = 'list'] = ctx.positionals
  if (action === 'list') return list(ctx)
  if (action === 'show') return show(ctx)
  if (action === 'add') return await add(ctx)
  if (action === 'check') return check(ctx)
  throw new CliError(`unknown action "${action}"`, { hint: `usage: ${usage}` })
}

const brief = (e) => ({ id: e.id, at: e.at, type: e.meta.type ?? null, title: e.title, refs: e.meta.refs ?? [], areas: e.meta.areas ?? [], author: e.meta.author ?? null, path: e.path })

function list(ctx) {
  const v = ctx.values
  const entries = filterEntries(readJournal(ctx.cwd), { type: v.type, area: v.area?.[0], ref: v.ref?.[0], author: v.author, since: v.since, until: v.until }).map(brief)
  ctx.output({ entries }, entries.length
    ? entries.map((e) => `${e.at?.replace('T', ' ').slice(0, 16) ?? '????'}  ${String(e.type).padEnd(8)}  ${e.title ?? e.id}${e.refs.length ? `  (${e.refs.join(' ')})` : ''}  @${e.author}`).join('\n')
    : 'No journal entries match.')
  return EXIT.OK
}

function show(ctx) {
  const id = ctx.positionals[1]
  if (!id) throw new CliError('which entry?', { hint: 'agent-os journal list' })
  const all = readJournal(ctx.cwd)
  const matches = all.filter((e) => e.id === id || e.name === id || e.path === id.replace(/\\/g, '/') || e.id.endsWith(id))
  if (matches.length !== 1) throw new CliError(matches.length ? `"${id}" matches ${matches.length} entries` : `no entry "${id}"`, { hint: matches.length ? matches.map((e) => e.id).join(', ') : 'agent-os journal list' })
  const [e] = matches
  ctx.output({ ...brief(e), body: e.body }, readFileSync(resolve(ctx.cwd, e.path), 'utf8').trimEnd())
  return EXIT.OK
}

function whoami(ctx, config) {
  try {
    const host = config.platform?.host ? new URL(config.platform.host).host : 'github.com'
    return ghClient(ctx.io.gh, { host }).rest('GET', 'user')?.login ?? null
  } catch { return null }
}

async function add(ctx) {
  const v = ctx.values
  const { merged } = loadConfig(ctx.cwd)
  if (!v.type || !TYPES.includes(v.type)) throw new CliError(`--type is required: one of ${TYPES.join(', ')}`)
  if (!v.title?.trim()) throw new CliError('--title is required')
  if (!v.area?.length) throw new CliError('at least one --area is required', { hint: 'the areas the entry is about, for example --area skills --area ci' })
  if (v.body !== undefined && v['body-file']) throw new CliError('use --body or --body-file, not both')
  const body = v['body-file'] ? readFileSync(resolve(ctx.cwd, v['body-file']), 'utf8') : v.body ?? ''
  const at = v.at ? new Date(v.at) : new Date()
  if (Number.isNaN(at.getTime())) throw new CliError(`--at "${v.at}" is not a date or time`, { hint: 'for example 2026-11-18T14:02:00Z' })
  let decisions = ''
  if (v.thread?.length) {
    const tracker = ctx.io.tracker ?? createTracker(merged, { gh: ctx.io.gh, glab: ctx.io.glab })
    const threads = v.thread.map((raw) => {
      const n = Number(String(raw).replace(/^[#!]/, ''))
      if (!Number.isInteger(n) || n < 1) throw new CliError(`--thread "${raw}" is not an issue or change request number`)
      return readThread(tracker, n, { changeRequest: String(raw).startsWith('!') })
    })
    decisions = decisionsSection(threads, { lang: languageFor(merged, 'journal') })
    if (!decisions) ctx.io.stderr(`agent-os: warning: no decisions found in the comments of ${v.thread.join(', ')}\n`)
  }
  const fullBody = decisions ? `${body.replace(/\s*$/, '')}${body.trim() ? '\n\n' : ''}${decisions}` : body
  const author = v.author ?? whoami(ctx, merged)
  if (!author) throw new CliError('could not tell who you are', { hint: 'pass --author <login>, or log in: gh auth login' })
  const r = addEntry(ctx.cwd, { type: v.type, title: v.title, body: fullBody, refs: v.ref ?? [], areas: v.area, author, at, lang: languageFor(merged, 'journal'), dryRun: ctx.dryRun })
  if (r.problems) throw new CliError(`the entry is not valid: ${r.problems.join('; ')}`)
  ctx.output(r, `${r.dryRun ? 'would write' : 'wrote'} ${r.path}`)
  return EXIT.OK
}

function check(ctx) {
  const { merged } = loadConfig(ctx.cwd)
  const lang = languageFor(merged, 'journal')
  const entries = readJournal(ctx.cwd)
  const problems = entries.flatMap((e) => validate(e, { lang }).map((message) => ({ path: e.path, message })))
  ctx.output({ entries: entries.length, problems }, problems.length
    ? `${problems.length} problem(s) in the journal:\n${problems.map((p) => `  ${p.path}: ${p.message}`).join('\n')}`
    : `journal: ${entries.length} entries, all valid`)
  return problems.length ? EXIT.CHECK_FAILED : EXIT.OK
}
