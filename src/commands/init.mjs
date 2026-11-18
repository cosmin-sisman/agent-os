// `agent-os init --me`: the personal part of setting up agent-os, for anyone joining a project. It asks first which
// language the agent should talk to you in, then about your sessions and machine, and writes only .agent-os/local.json.
// It never changes a committed file. The full `init` (detection, profiles, team setup) is planned in #49.

import { CliError } from '../cli/errors.mjs'
import { ask } from '../cli/prompt.mjs'
import { LOCAL_FILE, loadConfig, validate, saveJson, ignoreStatus, applyIgnore } from '../config/config.mjs'
import { LANGUAGES } from '../i18n/i18n.mjs'

export const usage = 'agent-os init --detect [--json]\n       agent-os init --me [--chat en|ro] [--sessions <n>] [--orchestrator] [--dev-port <port>] [--min-free-mb <mb>] [--yes]'

export const options = {
  me: { type: 'boolean', description: 'Only your personal settings (chat language, sessions, machine limits)' },
  detect: { type: 'boolean', description: 'Only read the repository and suggest a profile (greenfield, spec-first, active, maintenance); writes nothing' },
  chat: { type: 'string', description: 'Language the agent talks to you in: en or ro' },
  sessions: { type: 'string', description: 'Most agent sessions you run in parallel on this laptop (1 = one at a time)' },
  orchestrator: { type: 'boolean', description: 'One of your sessions coordinates the others' },
  'dev-port': { type: 'string', description: 'First dev-server port for parallel worktrees' },
  'min-free-mb': { type: 'string', description: 'Refuse heavy commands below this much free memory' },
  yes: { type: 'boolean', short: 'y', description: 'Do not ask; use flags and defaults' },
}

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  if (ctx.values.detect) return detect(ctx)
  if (!ctx.values.me) {
    throw new CliError('the full init is planned but not implemented yet', { hint: 'run "agent-os init --me" for your personal settings; follow #49: https://github.com/cosmin-sisman/agent-os/issues/49' })
  }
  const { local, merged, initialized } = loadConfig(ctx.cwd)
  const useDefaults = Boolean(ctx.values.yes)
  const flag = (name, parse) => (ctx.values[name] === undefined ? undefined : parse(ctx.values[name], name))

  const answers = {}
  answers.chat = flag('chat', oneOf(LANGUAGES)) ?? await ask(ctx.io, {
    key: 'chat', kind: 'choice', choices: LANGUAGES, default: merged.languages.chat,
    text: 'Which language should the agent talk to you in? Team areas (issues, PRs, code) keep their own languages.',
  }, { useDefaults })

  const sessions = flag('sessions', int(1, 32)) ?? await ask(ctx.io, {
    key: 'sessions', kind: 'int', min: 1, max: 32, default: merged.orchestrator ? merged.machine.maxWorkers : 1,
    text: 'How many agent sessions do you run in parallel on this laptop? (1 = one at a time)',
  }, { useDefaults })
  answers.maxWorkers = sessions
  if (sessions > 1) {
    answers.orchestrator = ctx.values.orchestrator ?? await ask(ctx.io, {
      key: 'orchestrator', kind: 'yesno', default: merged.orchestrator,
      text: 'Should one of them coordinate the others (orchestrator)?',
    }, { useDefaults })
    answers.devPortStart = flag('dev-port', int(1024, 65535)) ?? await ask(ctx.io, {
      key: 'devPortStart', kind: 'int', min: 1024, max: 65535, default: merged.machine.devPortStart,
      text: 'First dev-server port for parallel worktrees?',
    }, { useDefaults })
  } else {
    answers.orchestrator = false
  }
  answers.minFreeMb = flag('min-free-mb', int(0, 1048576)) ?? await ask(ctx.io, {
    key: 'minFreeMb', kind: 'int', min: 0, max: 1048576, default: merged.machine.minFreeMb,
    text: 'Refuse heavy commands (builds, browsers) below how much free memory, in MB?',
  }, { useDefaults })

  const next = structuredClone(local ?? {})
  next.languages = { ...(next.languages ?? {}), chat: answers.chat }
  next.machine = { ...(next.machine ?? {}), maxWorkers: answers.maxWorkers, minFreeMb: answers.minFreeMb, ...(answers.devPortStart ? { devPortStart: answers.devPortStart } : {}) }
  next.orchestrator = answers.orchestrator
  const problems = validate(next, { personal: true, file: LOCAL_FILE })
  if (problems.length) throw new CliError(`invalid answers:\n  - ${problems.join('\n  - ')}`)

  const ignore = ignoreStatus(ctx.cwd)
  const summary = { file: LOCAL_FILE, settings: next, teamConfig: initialized, ignore }
  if (ctx.dryRun) return ctx.output({ dryRun: true, ...summary }, `would write ${LOCAL_FILE}:\n${JSON.stringify(next, null, 2)}${ignore.action ? `\n${ignore.message}` : ''}`)
  saveJson(ctx.cwd, LOCAL_FILE, next)
  applyIgnore(ignore)
  const lines = [
    `wrote ${LOCAL_FILE}: chat ${answers.chat}, ${answers.maxWorkers} session(s)${answers.orchestrator ? ' with an orchestrator' : ''}, ${answers.minFreeMb} MB free memory minimum`,
    ...(ignore.message ? [ignore.message] : []),
    ...(initialized ? [] : ['note: this repository has no agent-os.json yet; team settings use their defaults until someone runs the full init (#49)']),
  ]
  ctx.output(summary, lines.join('\n'))
}

const oneOf = (values) => (raw, name) => {
  if (!values.includes(raw)) throw new CliError(`--${name} must be one of ${values.join(', ')}, got "${raw}"`)
  return raw
}
const int = (min, max) => (raw, name) => {
  const n = Number(raw)
  if (!/^\d+$/.test(raw) || n < min || n > max) throw new CliError(`--${name} must be a whole number from ${min} to ${max}, got "${raw}"`)
  return n
}

async function detect(ctx) {
  const { detectState } = await import('../init/detect.mjs')
  const { systemGit } = await import('../workflow/start.mjs')
  let tracker = null
  try {
    const { merged } = loadConfig(ctx.cwd)
    if (merged.platform?.project) tracker = ctx.io.tracker ?? (await import('../tracker/tracker.mjs')).createTracker(merged, { gh: ctx.io.gh, glab: ctx.io.glab })
  } catch { tracker = null }
  const d = detectState({ cwd: ctx.cwd, git: ctx.io.git ?? systemGit(ctx.cwd), tracker })
  const s = d.signals
  ctx.output(d, [
    `suggested profile: ${d.profile} (${d.confidence}): ${d.reason}`,
    `  commits ${s.commits} (${s.recentCommits} in 90 days), last ${s.lastCommit ?? 'never'}, tags ${s.tags}`,
    `  code files ${s.codeFiles}, documents ${s.docFiles}, CI ${s.ci.join(', ') || 'none'}, agent files ${s.agentFiles.join(', ') || 'none'}${s.openChangeRequests === null ? '' : `, open change requests ${s.openChangeRequests}`}`,
  ].join('\n'))
}
