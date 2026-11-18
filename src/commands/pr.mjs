// `agent-os pr`: the change request from the current branch. `preflight` says what is missing, `create` opens it only
// when nothing is, `status` reports its checks and review, `threads` lists review threads and `reply` answers one.

import { readFileSync } from 'node:fs'
import { prepareReply } from '../collab/thread.mjs'
import { resolve } from 'node:path'
import { CliError, EXIT } from '../cli/errors.mjs'
import { loadConfig } from '../config/config.mjs'
import { languageFor } from '../i18n/i18n.mjs'
import { vocabularyFor } from '../platform/vocabulary.mjs'
import { createTracker } from '../tracker/tracker.mjs'
import { openChangeRequest, preflight } from '../workflow/pr.mjs'
import { systemGit } from '../workflow/start.mjs'
import { lessonLines } from '../lessons/lessons.mjs'
import { overlapLines } from '../collab/overlap.mjs'

export const usage = [
  'agent-os pr preflight --title "<title>" --body-file <file>',
  'agent-os pr create --title "<title>" --body-file <file> [--draft] [--dry-run]',
  'agent-os pr status [<n>] [--watch]',
  'agent-os pr threads [<n>] [--all]',
  'agent-os pr reply <thread-id> --body-file <file> [--pr <n>] [--resolve] [--dry-run]   (in the comment\'s language; @mentions only for participants)',
].join('\n       ')

export const options = {
  title: { type: 'string', description: 'preflight/create: the title' },
  'body-file': { type: 'string', description: 'The body (create, preflight) or the reply (reply)' },
  base: { type: 'string', description: 'The target branch (default: branches.integration)' },
  draft: { type: 'boolean', description: 'create: open it as a draft' },
  watch: { type: 'boolean', description: 'status: wait until no check is pending (at most 30 minutes)' },
  all: { type: 'boolean', description: 'threads: include resolved threads' },
  resolve: { type: 'boolean', description: 'reply: resolve the thread after replying' },
  pr: { type: 'string', description: 'reply: the change request the thread is on (default: the one for this branch)' },
}

const read = (cwd, file) => {
  if (!file) throw new CliError('--body-file is required')
  try { return readFileSync(resolve(cwd, file), 'utf8') } catch { throw new CliError(`cannot read ${file}`) }
}

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  const [action, arg] = ctx.positionals
  const { merged } = loadConfig(ctx.cwd)
  const git = ctx.io.git ?? systemGit(ctx.cwd)
  const vocab = vocabularyFor(merged.platform?.type)
  const lang = languageFor(merged, 'prs')
  const tracker = () => ctx.io.tracker ?? createTracker(merged, { gh: ctx.io.gh, glab: ctx.io.glab })
  const number = () => {
    if (arg) { const n = Number(String(arg).replace(/^[#!]/, '')); if (Number.isInteger(n) && n > 0) return n; throw new CliError(`"${arg}" is not a number`) }
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()
    const pr = tracker().pullRequestFor(branch)
    if (!pr) throw new CliError(`${branch} has no open ${vocab.changeRequest}`, { hint: 'agent-os pr create …' })
    return pr.number
  }

  if (action === 'preflight' || action === 'create') {
    if (!ctx.values.title) throw new CliError('--title is required')
    const input = { title: ctx.values.title, body: read(ctx.cwd, ctx.values['body-file']), base: ctx.values.base ?? merged.branches.integration, lang }
    if (action === 'preflight') {
      let t = null
      try { t = merged.platform?.project ? tracker() : null } catch { t = null }
      const r = preflight({ config: merged, git, cwd: ctx.cwd, tracker: t }, input)
      const recalled = r.lessons.length ? `\nLessons that apply to this change (check the diff follows them):\n${lessonLines(r.lessons).join('\n')}` : ''
      for (const w of r.warnings ?? []) ctx.io.stderr(`agent-os: warning: ${w}\n`)
      const overlapping = r.overlaps.length ? `\nOther changes touch the same files (say so in the description and talk to them):\n${overlapLines(r.overlaps, vocab).join('\n')}` : ''
      ctx.output(r, `${r.ok ? `ready to open: gate passed on ${r.head.slice(0, 7)}, journal entry present, title and body follow the conventions` : `not ready:\n${r.problems.map((p) => `  - ${p}`).join('\n')}${r.suggestion ? `\nsuggested title: ${r.suggestion}` : ''}`}${recalled}${overlapping}`)
      return r.ok ? EXIT.OK : EXIT.CHECK_FAILED
    }
    const r = openChangeRequest({ config: merged, git, cwd: ctx.cwd, tracker: tracker(), vocab }, { ...input, draft: ctx.values.draft, issuesLang: languageFor(merged, 'issues'), dryRun: ctx.dryRun })
    for (const w of r.warnings ?? []) ctx.io.stderr(`agent-os: warning: ${w}\n`)
    if (!r.ok) { ctx.output(r, `not opened:\n${r.problems.map((p) => `  - ${p}`).join('\n')}${r.suggestion ? `\nsuggested title: ${r.suggestion}` : ''}`); return EXIT.CHECK_FAILED }
    ctx.output(r, r.dryRun ? `would:\n${r.steps.map((s) => `  ${s}`).join('\n')}` : `opened ${vocab.cr} ${vocab.crRef}${r.number}: ${r.url}`)
    return EXIT.OK
  }

  if (action === 'status') {
    const t = tracker()
    const n = number()
    const sleep = ctx.io.sleep ?? ((ms) => new Promise((res) => setTimeout(res, ms)))
    let s = t.pullRequestStatus(n)
    for (let waited = 0; ctx.values.watch && s.checks === 'pending' && waited < 30 * 60e3; waited += 20e3) { await sleep(20e3); s = t.pullRequestStatus(n) }
    const lines = [`${vocab.cr} ${vocab.crRef}${n}: ${s.state}${s.draft ? ' (draft)' : ''}, checks ${s.checks}, review ${s.review ? s.review.toLowerCase().replace(/_/g, ' ') : 'none yet'}`,
      ...s.failing.map((c) => `  failing: ${c.name}${c.url ? ` ${c.url}` : ''}`), ...(s.pending.length ? [`  pending: ${s.pending.join(', ')}`] : [])]
    ctx.output(s, lines.join('\n'))
    return s.checks === 'failure' || s.review === 'CHANGES_REQUESTED' ? EXIT.CHECK_FAILED : EXIT.OK
  }

  if (action === 'threads') {
    const n = number()
    const threads = tracker().reviewThreads(n).filter((t) => ctx.values.all || !t.resolved)
    ctx.output({ number: n, threads }, threads.length
      ? threads.map((t) => `${t.id}  ${t.path ?? '(general)'}${t.line ? `:${t.line}` : ''}${t.resolved ? ' [resolved]' : ''}${t.outdated ? ' [outdated]' : ''}\n${t.comments.map((c) => `  @${c.author}: ${c.body.split('\n')[0]}`).join('\n')}`).join('\n')
      : 'No open review threads.')
    return EXIT.OK
  }

  if (action === 'reply') {
    if (!arg) throw new CliError('which thread?', { hint: 'agent-os pr threads' })
    const t = tracker()
    let n = ctx.values.pr ? Number(String(ctx.values.pr).replace(/^[#!]/, '')) : null
    if (!n) { const pr = t.pullRequestFor(git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()); n = pr?.number ?? null }
    const thread = n ? t.reviewThreads(n).find((x) => x.id === arg) : null
    if (!thread) throw new CliError(`no review thread ${arg}${n ? ` on ${vocab.crRef}${n}` : ''}`, { hint: 'agent-os pr threads [<n>], and --pr <n> when the branch is not the change request\'s' })
    let me = null
    try { me = t.whoami?.() ?? null } catch { me = null }
    let author = null
    try { author = t.pullRequestStatus(n).author } catch { author = null }
    const to = [...thread.comments].reverse().find((c) => c.author !== me) ?? thread.comments.at(-1)
    const people = [...new Set([author, ...thread.comments.map((c) => c.author)].filter(Boolean))]
    const reply = prepareReply(read(ctx.cwd, ctx.values['body-file']), { to, people, fallback: lang })
    if (reply.problems.length) { ctx.output({ posted: false, ...reply }, `not posted: ${reply.problems.join('; ')}`); return EXIT.CHECK_FAILED }
    const r = tracker().replyToThread(arg, reply.body, { resolve: ctx.values.resolve, dryRun: ctx.dryRun })
    ctx.output(r, r.dryRun ? `would reply to ${arg}${ctx.values.resolve ? ' and resolve it' : ''}` : `replied${r.resolved ? ' and resolved' : ''}: ${r.url ?? arg}`)
    return EXIT.OK
  }

  throw new CliError(action ? `unknown action "${action}"` : 'which action?', { hint: `usage: ${usage}` })
}
