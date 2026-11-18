// `agent-os install`: the one-command start in any folder (#264). It offers `git init` when the folder is not a
// repository, asks the platform and project when there is no origin remote (and offers to create the repository,
// private, after a yes), then runs the full init and the personal settings, and ends with what to do next. It is
// also what the bare `agent-os` runs on a terminal in a folder without agent-os.json. Every flag of init works here.

import { basename, resolve } from 'node:path'
import { CliError, EXIT } from '../cli/errors.mjs'
import { ask } from '../cli/prompt.mjs'
import { loadConfig } from '../config/config.mjs'
import { LANGUAGES } from '../i18n/i18n.mjs'
import { remoteUrl } from '../platform/detect.mjs'
import { systemGit } from '../workflow/start.mjs'
import { PLATFORM_CREATE, creatorFor } from '../platform/create.mjs'
import { full, options as initOptions, personal } from './init.mjs'

export const usage = 'agent-os install [any init flag: --profile, --platform github|gitlab --project <owner/name> [--host <url>], --lang, --solo|--team, --chat, --setup, --yes …]\n       (the bare `agent-os` runs it on a terminal in a folder without agent-os.json)'

export const options = Object.fromEntries(Object.entries(initOptions).filter(([k]) => !['me', 'detect'].includes(k)))

/** The skill a profile starts with. */
const FIRST = { greenfield: '/kickoff (a product interview: the product doc, a stack, the first milestone and issues)', 'spec-first': '/ingest-docs (your specifications become epics and issues)', active: '/discover (the conventions this repository already follows)', maintenance: '/audit, then /runbook' }
const PROJECT = /^[\w.-]+(\/[\w.-]+)+$/

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  const v = ctx.values
  const interactive = Boolean(ctx.io.ask) && !v.yes
  const git = ctx.io.git ?? systemGit(ctx.cwd)
  const { merged } = loadConfig(ctx.cwd)
  const done = []
  const q = (question) => ask(ctx.io, question, { useDefaults: !interactive })

  // Personal first: the chat language, asked once for the whole flow.
  v.chat ??= await q({ key: 'chat', kind: 'choice', choices: LANGUAGES, default: merged.languages.chat, text: 'Which language should the agent talk to you in?' })
  const isRepo = git(['rev-parse', '--is-inside-work-tree']).status === 0
  const remote = isRepo ? (ctx.io.remote !== undefined ? ctx.io.remote : remoteUrl(ctx.cwd)) : null
  const needPlatform = !remote && !(v.platform && v.project)
  // Scripted runs never create a repository on a platform: they need the platform as flags, before anything is written.
  if (needPlatform && !interactive) throw new CliError('the platform could not be detected: there is no origin remote', { hint: 'pass --platform github|gitlab --project <owner/name> (and --host for a self-managed one), or run agent-os install on a terminal' })

  // 1. A git repository, on the integration branch.
  if (!isRepo) {
    v.integration ??= await q({ key: 'integration', kind: 'text', pattern: /^[\w./-]+$/, default: merged.branches.integration, text: 'Integration branch (it becomes the default branch)?' })
    const yes = await q({ key: 'gitInit', kind: 'yesno', default: true, text: `${resolve(ctx.cwd)} is not a git repository. Run git init -b ${v.integration} here?` })
    if (!yes) throw new CliError('agent-os needs a git repository', { hint: `run git init -b ${v.integration}, then agent-os install again` })
    if (ctx.dryRun) done.push(`would run git init -b ${v.integration}`)
    else {
      const r = git(['init', '-b', v.integration])
      if (r.status !== 0) throw new CliError(`git init failed: ${String(r.stderr).trim().split('\n')[0]}`)
      done.push(`git init -b ${v.integration}`)
    }
  }

  // 2. The platform and the project, asked when there is no origin remote.
  if (needPlatform) done.push(...await choosePlatform(ctx, q))

  // 3. The full init, then the personal settings, with their output gathered into one report.
  const reports = []
  const output = ctx.output.bind(ctx)
  ctx.output = (data, text) => { reports.push({ data, text }) }
  try {
    const code = (await full(ctx)) ?? EXIT.OK
    // The person said no to the plan, or init found failures: stop there, without the personal settings.
    if (code === EXIT.OK && reports.at(-1)?.data?.written && !ctx.dryRun) await personal(ctx)
    return finish(ctx, output, { done, reports, code })
  } finally { ctx.output = output }
}

/** Asks the platform, the host and the project; creates the repository (private) after a yes, or adds an existing one. */
async function choosePlatform(ctx, q) {
  const v = ctx.values
  const steps = []
  v.platform ??= await q({ key: 'platform', kind: 'choice', choices: Object.keys(PLATFORM_CREATE), default: 'github', text: 'There is no origin remote. Which platform hosts this project?' })
  const creator = creatorFor(v.platform)
  if (v.host === undefined) {
    const host = await q({ key: 'host', kind: 'text', pattern: /^(|https?:\/\/[\w.-]+(:\d+)?\/?)$/, default: '', text: `Self-managed host (https://…), or empty for ${creator.cloud}?` })
    if (host) v.host = host.replace(/\/$/, '')
  }
  const hostName = v.host ? new URL(v.host).host : creator.cloud
  const create = await q({ key: 'create', kind: 'yesno', default: true, text: `Create a new private repository on ${hostName}? (no: use one that exists)` })
  let login = null
  if (create) { try { login = creator.whoami(ctx.io, hostName) } catch { login = null } }
  const suggested = login ? `${login}/${basename(resolve(ctx.cwd))}` : undefined
  v.project ??= await q({ key: 'project', kind: 'text', pattern: PROJECT, default: suggested, text: `The project on ${hostName}, as owner/name?` })
  if (!v.project || !PROJECT.test(v.project)) throw new CliError('the project must be owner/name', { hint: 'pass --project <owner/name>' })
  const url = `https://${hostName}/${v.project}.git`
  const git = ctx.io.git ?? systemGit(ctx.cwd)
  let setsOrigin = false
  if (create) {
    const ok = await q({ key: 'confirmCreate', kind: 'yesno', default: false, text: `Create the private repository ${hostName}/${v.project} with ${creator.cli} repo create?` })
    if (!ok) throw new CliError('nothing was created', { hint: 'create the repository yourself and add it as origin, or run agent-os install again and answer with an existing one' })
    if (ctx.dryRun) { steps.push(`would create the private repository ${hostName}/${v.project} and add it as origin`); return steps }
    setsOrigin = creator.create(ctx.io, { cwd: ctx.cwd, hostName, project: v.project }).setsOrigin
    steps.push(`created the private repository ${hostName}/${v.project}`)
  } else if (ctx.dryRun) { steps.push(`would add origin ${url}`); return steps }
  // Some CLIs set origin themselves; add it only when it is still missing.
  if (!setsOrigin && git(['remote', 'get-url', 'origin']).status !== 0) {
    const r = git(['remote', 'add', 'origin', url])
    if (r.status !== 0) throw new CliError(`git remote add origin failed: ${String(r.stderr).trim().split('\n')[0]}`)
    steps.push(`added origin ${url}`)
  }
  return steps
}

/** One report: what was done, init's and the personal settings' own lines, then what to do next. */
function finish(ctx, output, { done, reports, code }) {
  const written = reports.find((r) => r.data && 'written' in r.data)?.data
  const profile = written?.profile ?? reports[0]?.data?.profile
  const ready = code === EXIT.OK && (written?.written || ctx.dryRun)
  const next = ready && !ctx.dryRun ? [
    '',
    'Next:',
    '  1. open Claude Code in this folder (claude)',
    `  2. ${FIRST[profile] ?? '/next'}`,
    '  3. agent-os doctor: checks the setup (the same check runs in CI)',
    '  4. /next: what to work on, then /start <n>',
    ...(ctx.values.setup ? [] : ['  then, when the team agrees: agent-os setup --dry-run, then agent-os setup (branch protection, labels, milestone)']),
    'The usage guide: https://github.com/cosmin-sisman/agent-os/blob/development/docs/guides/usage.md',
  ] : []
  output({ done, steps: reports.map((r) => r.data), profile: profile ?? null }, [...done, ...reports.map((r) => r.text).filter(Boolean).map(compact), ...next].join('\n'))
  return code
}

/** init's report, shortened for install: the installed files as one line, and its own "next" left to the summary. */
function compact(text) {
  const lines = String(text).split('\n')
  const installed = lines.filter((l) => /^ {2}install /.test(l)).map((l) => l.slice(10))
  const kept = lines.filter((l) => !/^ {2}install /.test(l) && !/^next: agent-os setup/.test(l))
  if (!installed.length) return kept.join('\n')
  const skills = installed.filter((k) => k.startsWith('.claude/skills/')).length
  const at = kept.findIndex((l) => /^(wrote|write|update) agent-os\.json/.test(l))
  kept.splice(at + 1, 0, `installed ${installed.length} managed file(s): ${skills} skill(s) in .claude/skills/, rules in .claude/rules/, hooks in .claude/settings.json, the agent-os block in AGENTS.md and CLAUDE.md, and the platform files`)
  return kept.join('\n')
}
