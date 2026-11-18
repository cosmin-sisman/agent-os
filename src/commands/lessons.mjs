// `agent-os lessons`: capture, recall, search and triage lessons learned. Recall never writes: the recalled and
// followed counters belong to /retro (#29).

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CliError, EXIT } from '../cli/errors.mjs'
import { loadConfig } from '../config/config.mjs'
import { changedFiles } from '../gate/gate.mjs'
import { languageFor } from '../i18n/i18n.mjs'
import { acceptLesson, addLesson, CONFIDENCE, lessonsForChange, lessonsForIssue, promoteLesson, readLessons, recall, retireLesson, search, validateCard } from '../lessons/lessons.mjs'
import { createTracker } from '../tracker/tracker.mjs'
import { ghClient } from '../tracker/gh.mjs'
import { systemGit } from '../workflow/start.mjs'

export const usage = [
  'agent-os lessons add "<the lesson in one sentence, why, an example>" --area <a>… [--path <glob>…] [--keyword <w>…] --source "<where>"',
  'agent-os lessons recall [--issue <n> | --path <p>… | --changed] [--area <a>…] [--limit 3]',
  'agent-os lessons search <words>',
  'agent-os lessons review | accept <id> [--as <slug>] | promote <id> --to "<rule>" | retire <id> --reason "<why>"',
  'agent-os lessons check',
].join('\n       ')

export const options = {
  area: { type: 'string', multiple: true, description: 'An area (repeat)' },
  path: { type: 'string', multiple: true, description: 'add: a glob the lesson applies to; recall: a path being worked on (repeat)' },
  keyword: { type: 'string', multiple: true, description: 'add: a keyword that recalls it (repeat)' },
  source: { type: 'string', description: 'add: where it came from (issue, PR, review comment, incident)' },
  confidence: { type: 'string', description: `add: ${CONFIDENCE.join(', ')} (default medium)` },
  'body-file': { type: 'string', description: 'add: read the lesson text from a file' },
  author: { type: 'string', description: 'add: the author login (default: your platform login)' },
  issue: { type: 'string', description: 'recall: what applies to this issue (its areas, the paths and words it mentions)' },
  changed: { type: 'boolean', description: 'recall: what applies to the files changed on this branch' },
  limit: { type: 'string', description: 'recall: at most this many cards (default 3)' },
  as: { type: 'string', description: 'accept: the slug of the active card' },
  to: { type: 'string', description: 'promote: the rule or file the lesson became' },
  reason: { type: 'string', description: 'retire: why it no longer needs recalling' },
  all: { type: 'boolean', description: 'search: include retired cards' },
}

const show = (l) => `${l.id}${l.why ? ` (${l.why.join('; ')})` : ''}${l.state ? ` [${l.state}]` : ''}: ${l.text}`

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  const [action, ...args] = ctx.positionals
  const v = ctx.values
  const { merged } = loadConfig(ctx.cwd)
  const lang = languageFor(merged, 'docs')

  if (action === 'add') {
    const text = v['body-file'] ? readFileSync(resolve(ctx.cwd, v['body-file']), 'utf8') : args.join(' ')
    if (!text.trim()) throw new CliError('what is the lesson?', { hint: usage.split('\n')[0] })
    if (!v.area?.length) throw new CliError('at least one --area is required')
    let author = v.author
    if (!author) { try { author = ghClient(ctx.io.gh).rest('GET', 'user')?.login } catch { author = null } }
    if (!author) throw new CliError('could not tell who you are', { hint: 'pass --author <login>' })
    const r = addLesson(ctx.cwd, { text, areas: v.area, paths: v.path ?? [], keywords: v.keyword ?? [], source: v.source, confidence: v.confidence ?? 'medium', author, lang, dryRun: ctx.dryRun })
    if (r.problems) throw new CliError(`the lesson is not valid: ${r.problems.join('; ')}`)
    ctx.output(r, `${r.dryRun ? 'would capture' : 'captured'} ${r.path} (in the inbox; /lessons review or /retro triages it)`)
    return EXIT.OK
  }

  if (action === 'recall') {
    const limit = v.limit === undefined ? 3 : Number(v.limit)
    if (!Number.isInteger(limit) || limit < 1) throw new CliError('--limit takes a whole number of at least 1')
    let lessons
    if (v.issue) {
      const issue = (ctx.io.tracker ?? createTracker(merged, { gh: ctx.io.gh, glab: ctx.io.glab })).get(Number(String(v.issue).replace(/^#/, '')))
      lessons = lessonsForIssue(ctx.cwd, { ...issue, labels: [...issue.labels, ...(v.area ?? []).map((a) => `area:${a}`)] }, { limit })
    } else {
      const paths = [...(v.path ?? []), ...(v.changed ? changedFiles(ctx.io.git ?? systemGit(ctx.cwd), merged.branches.integration) : [])]
      lessons = v.area?.length ? recall(readLessons(ctx.cwd), { areas: v.area, paths, text: args.join(' ') }, { limit }).lessons : lessonsForChange(ctx.cwd, { paths, text: args.join(' ') }, { limit })
    }
    ctx.output({ lessons }, lessons.length ? `${lessons.length} lesson(s) apply here; say which you follow:\n${lessons.map((l) => `  ${show(l)}`).join('\n')}` : 'no active lesson applies here')
    return EXIT.OK
  }

  if (action === 'search') {
    const hits = search(readLessons(ctx.cwd), args.join(' '), { states: v.all ? ['active', 'inbox', 'retired'] : ['active', 'inbox'] })
    ctx.output({ lessons: hits }, hits.length ? hits.map((h) => `  ${show(h)}`).join('\n') : 'no lesson matches')
    return EXIT.OK
  }

  if (action === 'review') {
    const inbox = readLessons(ctx.cwd).filter((c) => c.state === 'inbox').map((c) => ({ id: c.id, text: c.text, areas: c.meta.areas ?? [], source: c.meta.source ?? null, problems: validateCard(c, { lang }), path: c.path }))
    ctx.output({ inbox }, inbox.length
      ? [`${inbox.length} card(s) in the inbox. For each: accept it (agent-os lessons accept <id> [--as <slug>]), promote it into a rule, or retire it.`, ...inbox.map((c) => `  ${c.id} [${c.areas.join(', ')}] ${c.text}${c.problems.length ? `\n    fix first: ${c.problems.join('; ')}` : ''}`)].join('\n')
      : 'the inbox is empty')
    return EXIT.OK
  }

  if (action === 'accept') { const r = acceptLesson(ctx.cwd, need(args[0]), { as: v.as, dryRun: ctx.dryRun }); ctx.output(r, `${r.dryRun ? 'would move' : 'moved'} ${r.from} → ${r.to}`); return EXIT.OK }
  if (action === 'promote') { const r = promoteLesson(ctx.cwd, need(args[0]), { to: v.to, dryRun: ctx.dryRun }); ctx.output(r, `${r.dryRun ? 'would record' : 'recorded'} on ${r.path}: promoted to ${r.promotedTo}`); return EXIT.OK }
  if (action === 'retire') { const r = retireLesson(ctx.cwd, need(args[0]), { reason: v.reason, dryRun: ctx.dryRun }); ctx.output(r, `${r.dryRun ? 'would retire' : 'retired'} ${r.from} → ${r.to}`); return EXIT.OK }

  if (action === 'check') {
    const cards = readLessons(ctx.cwd)
    const problems = cards.flatMap((c) => validateCard(c, { lang }).map((message) => ({ path: c.path, message })))
    ctx.output({ cards: cards.length, problems }, problems.length ? `${problems.length} problem(s):\n${problems.map((p) => `  ${p.path}: ${p.message}`).join('\n')}` : `lessons: ${cards.length} card(s), all valid`)
    return problems.length ? EXIT.CHECK_FAILED : EXIT.OK
  }

  throw new CliError(action ? `unknown action "${action}"` : 'which action?', { hint: `usage: ${usage}` })
}

function need(id) {
  if (!id) throw new CliError('which card?', { hint: 'agent-os lessons review' })
  return id
}
