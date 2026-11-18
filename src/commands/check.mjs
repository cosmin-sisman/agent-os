// `agent-os check title|commit`: the conventions for change-request titles (which become squash commits) and commit
// messages. Exit 0 when it follows them, 1 with exactly what to change, 2 when it could not be checked.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { CliError, EXIT } from '../cli/errors.mjs'
import { loadConfig } from '../config/config.mjs'
import { checkTitle, checkCommit } from '../conventions/conventions.mjs'
import { createTracker } from '../tracker/tracker.mjs'
import { checkLoop, LOOP_CHECK } from '../workflow/loop.mjs'
import { fromCi } from '../ci/event.mjs'
import { systemGit } from '../workflow/start.mjs'
import { runningVersion } from '../version/pin.mjs'

export const usage = 'agent-os check title "<title>" [--body-file <file> | --pr <n>]\n       agent-os check commit [--message-file <file> | --ref <rev>]\n       agent-os check loop (--body-file <file> [--base <branch>] [--author <login>] | --from-ci)'

export const options = {
  'body-file': { type: 'string', description: 'title: the description to match the issue suffix against' },
  pr: { type: 'string', description: 'title: read the title and description of this pull or merge request' },
  'message-file': { type: 'string', description: 'commit: the message to check' },
  ref: { type: 'string', description: 'commit: check this commit (default HEAD)' },
  base: { type: 'string', description: 'loop: the target branch (default: branches.integration)' },
  author: { type: 'string', description: 'loop: the author login (dependency bots are exempt)' },
  'from-ci': { type: 'boolean', description: 'loop: read the description, author and target branch from the CI event (GitHub Actions or GitLab CI)' },
}

const read = (cwd, file) => {
  try { return readFileSync(resolve(cwd, file), 'utf8') } catch { throw new CliError(`cannot read ${file}`, { hint: 'pass an existing file' }) }
}

/** @param {import('../cli/context.mjs').Context} ctx */
export function run(ctx) {
  const [what, ...rest] = ctx.positionals
  const { merged } = loadConfig(ctx.cwd)
  if (what === 'title') {
    let title = rest.join(' ')
    let body = ctx.values['body-file'] ? read(ctx.cwd, ctx.values['body-file']) : ''
    if (ctx.values.pr) {
      const pr = (ctx.io.tracker ?? createTracker(merged, { gh: ctx.io.gh, glab: ctx.io.glab })).gh.rest('GET', `repos/${merged.platform.project}/pulls/${Number(ctx.values.pr)}`)
      title = title || pr.title
      body = pr.body ?? ''
    }
    if (!title) throw new CliError('missing the title', { hint: `usage: ${usage}` })
    const r = checkTitle(title, body, merged.conventions, { lang: merged.languages.prs })
    const text = r.ok ? `title: ok${r.exempt ? ' (exempt)' : ''}` : [`title: ${r.problems.length} problem(s)`, ...r.problems.map((p) => `  - ${p}`), ...(r.suggestion ? [`suggested: ${r.suggestion}`] : [])].join('\n')
    ctx.output(r, text)
    return r.ok ? EXIT.OK : EXIT.CHECK_FAILED
  }
  if (what === 'commit') {
    let message
    if (ctx.values['message-file']) message = read(ctx.cwd, ctx.values['message-file'])
    else {
      try { message = execFileSync('git', ['log', '-1', '--format=%B', ctx.values.ref ?? 'HEAD'], { cwd: ctx.cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) } catch { throw new CliError(`cannot read commit ${ctx.values.ref ?? 'HEAD'}`, { hint: 'run it inside a git repository, or pass --message-file' }) }
    }
    const r = checkCommit(message, merged.conventions, { lang: merged.languages.commits })
    ctx.output(r, r.ok ? `commit: ok${r.exempt ? ' (exempt)' : ''}` : [`commit: ${r.problems.length} problem(s)`, ...r.problems.map((p) => `  - ${p}`)].join('\n'))
    return r.ok ? EXIT.OK : EXIT.CHECK_FAILED
  }
  if (what === 'loop') {
    const input = ctx.values['from-ci'] ? fromCi(ctx.io.env ?? process.env) : null
    if (!input && !ctx.values['body-file']) throw new CliError('--body-file or --from-ci is required', { hint: 'the change request description, written to a file' })
    const r = checkLoop({ config: merged, git: ctx.io.git ?? systemGit(ctx.cwd), cwd: ctx.cwd, running: ctx.io.running ?? runningVersion() }, {
      body: input ? input.body : read(ctx.cwd, ctx.values['body-file']),
      base: ctx.values.base ?? input?.base ?? merged.branches.integration,
      author: ctx.values.author ?? input?.author,
      lang: merged.languages.prs,
    })
    ctx.output(r, [r.ok ? `${LOOP_CHECK}: ok${r.exempt ? ` (${r.exempt})` : ''}` : `${LOOP_CHECK}: ${r.problems.length} problem(s)`, ...r.problems.map((p) => `  - ${p}`), ...r.notes.map((n) => `  ${n}`)].join('\n'))
    return r.ok ? EXIT.OK : EXIT.CHECK_FAILED
  }
  throw new CliError(what ? `unknown check "${what}"` : 'missing what to check', { hint: `usage: ${usage}` })
}
