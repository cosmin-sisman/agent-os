// `agent-os init --me`: the personal part of setting up agent-os, for anyone joining a project. It asks first which
// language the agent should talk to you in, then about your sessions and machine, and writes only .agent-os/local.json.
// It never changes a committed file. Without --me it is the full init (detection, profiles, team setup); `install` runs both.

import { CliError, EXIT } from '../cli/errors.mjs'
import { ask } from '../cli/prompt.mjs'
import { LOCAL_FILE, TEAM_FILE, loadConfig, validate, saveJson, ignoreStatus, applyIgnore } from '../config/config.mjs'
import { AREAS, LANGUAGES } from '../i18n/i18n.mjs'

export const usage = 'agent-os init [--profile <p>] [--platform github|gitlab --project <owner/name> [--host <url>]] [--integration <b>] [--production <b>] [--lang en|ro] [--area-lang <area>=<en|ro>…] [--solo|--team] [--chat en|ro] [--setup] [--yes] [--dry-run]\n       agent-os init --detect [--json]\n       agent-os init --me [--chat en|ro] [--sessions <n>] [--orchestrator] [--dev-port <port>] [--min-free-mb <mb>] [--yes]'

export const options = {
  me: { type: 'boolean', description: 'Only your personal settings (chat language, sessions, machine limits)' },
  profile: { type: 'string', description: 'greenfield, spec-first, active or maintenance (default: the detected one)' },
  platform: { type: 'string', description: 'github or gitlab (default: from the origin remote)' },
  project: { type: 'string', description: 'owner/name or group/name (default: from the origin remote)' },
  host: { type: 'string', description: 'Self-managed host, https://…' },
  integration: { type: 'string', description: 'The integration branch, made the default branch (default development)' },
  production: { type: 'string', description: 'The production branch (default main)' },
  lang: { type: 'string', description: 'Language of every team area: en or ro (Romanian without diacritics)' },
  'area-lang': { type: 'string', multiple: true, description: 'One area in another language, e.g. --area-lang issues=ro (repeat)' },
  solo: { type: 'boolean', description: 'One person: no required approvals' },
  team: { type: 'boolean', description: 'A team: one approval required on change requests' },
  methodology: { type: 'string', description: 'For an existing repository: forward-only (conventions from today on) or retrofit (#50)' },
  author: { type: 'string', description: 'The login for the baseline journal entry (default: your platform login)' },
  setup: { type: 'boolean', description: 'Also apply the platform setup (branches, protection, labels, milestone); asks first unless --yes' },
  detect: { type: 'boolean', description: 'Only read the repository and suggest a profile (greenfield, spec-first, active, maintenance); writes nothing' },
  chat: { type: 'string', description: 'Language the agent talks to you in: en or ro' },
  sessions: { type: 'string', description: 'Most agent sessions you run in parallel on this laptop (1 = one at a time)' },
  orchestrator: { type: 'boolean', description: 'One of your sessions coordinates the others' },
  'dev-port': { type: 'string', description: 'First dev-server port for parallel worktrees' },
  'min-free-mb': { type: 'string', description: 'Refuse heavy commands below this much free memory' },
  yes: { type: 'boolean', short: 'y', description: 'Do not ask; use flags and defaults' },
}

/** One line per choice, shown in the interactive menus. */
export const DESCRIBE = {
  language: { en: 'English', ro: 'Romanian, without diacritics (ASCII only)' },
  profile: { greenfield: 'a new project, no code yet', 'spec-first': 'specifications or docs, little code', active: 'in active development, with history', maintenance: 'finished, kept healthy' },
  methodology: { 'forward-only': 'conventions from today on; history stays as it is', retrofit: 'bring the history into the system too' },
}

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  if (ctx.values.detect) return detect(ctx)
  if (!ctx.values.me) return full(ctx)
  return personal(ctx)
}

/**
 * The personal settings (`init --me`): chat language, sessions, orchestrator, machine limits, in .agent-os/local.json.
 * `install` runs it right after the full init; a value given as a flag is never asked.
 * @param {import('../cli/context.mjs').Context} ctx
 */
export async function personal(ctx) {
  const { local, merged, initialized } = loadConfig(ctx.cwd)
  const useDefaults = Boolean(ctx.values.yes)
  const flag = (name, parse) => (ctx.values[name] === undefined ? undefined : parse(ctx.values[name], name))

  const answers = {}
  answers.chat = flag('chat', oneOf(LANGUAGES)) ?? await ask(ctx.io, {
    key: 'chat', kind: 'choice', choices: LANGUAGES, descriptions: DESCRIBE.language,  default: merged.languages.chat,
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

const PROFILES_LIST = ['greenfield', 'spec-first', 'active', 'maintenance']

/** The full init: detection, profile, platform, team settings, managed files, then doctor. */
export async function full(ctx) {
  const v = ctx.values
  const useDefaults = Boolean(v.yes)
  const { detectState } = await import('../init/detect.mjs')
  const { buildConfig, planInit, applyInit } = await import('../init/init.mjs')
  const { systemGit } = await import('../workflow/start.mjs')
  const { detectPlatform, remoteUrl } = await import('../platform/detect.mjs')
  const { runningVersion } = await import('../version/pin.mjs')
  const { planPlatformSetup } = await import('../platform/setup.mjs')
  const { merged } = loadConfig(ctx.cwd)
  const git = ctx.io.git ?? systemGit(ctx.cwd)
  const lines = []

  const state = detectState({ cwd: ctx.cwd, git })
  // 1. Personal first: the chat language.
  const chat = v.chat !== undefined ? oneOf(LANGUAGES)(v.chat, 'chat') : await ask(ctx.io, { key: 'chat', kind: 'choice', choices: LANGUAGES, descriptions: DESCRIBE.language,  default: merged.languages.chat, text: 'Which language should the agent talk to you in?' }, { useDefaults })
  // 2. The profile, confirmed.
  const profile = v.profile !== undefined ? oneOf(PROFILES_LIST)(v.profile, 'profile') : await ask(ctx.io, { key: 'profile', kind: 'choice', choices: PROFILES_LIST, descriptions: DESCRIBE.profile,  default: state.profile, text: `This looks like a ${state.profile} repository (${state.reason}). Which profile?` }, { useDefaults })
  // 3. Platform, from the remote unless given.
  let platform
  if (v.platform || v.project) {
    if (!v.platform || !v.project) throw new CliError('--platform and --project go together')
    platform = { type: oneOf(['github', 'gitlab'])(v.platform, 'platform'), project: v.project, ...(v.host ? { host: v.host } : {}) }
  } else {
    const d = await detectPlatform({ remote: ctx.io.remote !== undefined ? ctx.io.remote : remoteUrl(ctx.cwd), fetchFn: ctx.io.fetch })
    if (!d.ok) throw new CliError(`the platform could not be detected: ${d.evidence}`, { hint: 'pass --platform github|gitlab --project <owner/name>' })
    platform = d.platform
    lines.push(`platform: ${platform.type} ${platform.project}${platform.host ? ` at ${platform.host}` : ''} (${d.evidence})`)
  }
  // 4. Team languages, branches, solo or team.
  const lang = v.lang !== undefined ? oneOf(LANGUAGES)(v.lang, 'lang') : await ask(ctx.io, { key: 'lang', kind: 'choice', choices: LANGUAGES, descriptions: DESCRIBE.language,  default: 'en', text: 'Language of the team areas (issues, change requests, commits, docs, …)? Change single areas later with agent-os lang set.' }, { useDefaults })
  const areaLangs = {}
  for (const pair of v['area-lang'] ?? []) {
    const [area, l] = pair.split('=')
    if (!AREAS.some((a) => a.id === area && !a.personal)) throw new CliError(`--area-lang: unknown team area "${area}"`, { hint: AREAS.filter((a) => !a.personal).map((a) => a.id).join(', ') })
    areaLangs[area] = oneOf(LANGUAGES)(l, 'area-lang')
  }
  const integration = v.integration ?? await ask(ctx.io, { key: 'integration', kind: 'text', pattern: /^[\w./-]+$/, default: merged.branches.integration, text: 'Integration branch (it becomes the default branch)?' }, { useDefaults })
  const production = v.production ?? merged.branches.production
  const team = v.solo ? false : v.team ? true : await ask(ctx.io, { key: 'team', kind: 'yesno', default: true, text: 'Do several people work here (one approval required on change requests)?' }, { useDefaults })

  // 5. An existing repository: forward-only (from today on) or retrofit (history brought in, #50).
  let methodology = null
  if (profile !== 'greenfield') {
    methodology = v.methodology !== undefined ? oneOf(['forward-only', 'retrofit'])(v.methodology, 'methodology') : await ask(ctx.io, { key: 'methodology', kind: 'choice', choices: ['forward-only', 'retrofit'], descriptions: DESCRIBE.methodology,  default: 'forward-only', text: 'This repository has history. Apply the conventions from today on (forward-only), or bring the history in (retrofit)?' }, { useDefaults })
    if (methodology === 'retrofit') throw new CliError('retrofit is planned but not implemented yet', { hint: 'use --methodology forward-only now; retrofit can follow later (#50)' })
  }
  const version = ctx.io.running ?? runningVersion()
  const cfg = buildConfig({ profile, platform, integration, production, team, lang, areaLangs, chat, version, cwd: ctx.cwd, methodology })
  const plan = planInit({ cwd: ctx.cwd, ...cfg, version })
  if (plan.problems.length) throw new CliError(`the answers do not make a valid configuration:\n  - ${plan.problems.join('\n  - ')}`)
  let platformSteps = []
  try { platformSteps = planPlatformSetup(plan.merged, { gh: ctx.io.gh, glab: ctx.io.glab }) } catch (err) { lines.push(`platform plan unavailable: ${err.message.split('\n')[0]}${err.hint ? ` (${err.hint})` : ''}`) }
  const changed = plan.files.filter((f) => f.action !== 'unchanged' && f.action !== 'ejected')
  lines.push(
    `profile: ${profile}${profile === state.profile ? '' : ` (detected ${state.profile})`}${methodology ? `, ${methodology}${methodology === 'forward-only' ? ` from ${cfg.team.adoption.cutoff} (doctor ignores older history; a baseline journal entry records the snapshot)` : ''}` : ''}; team areas in ${lang}${Object.keys(areaLangs).length ? ` (${Object.entries(areaLangs).map(([a, l]) => `${a} ${l}`).join(', ')})` : ''}; chat in ${chat}; ${integration} → ${production}; ${team ? 'team (1 approval)' : 'solo'}`,
    `${plan.existing ? 'update' : 'write'} ${TEAM_FILE}, ${LOCAL_FILE}${plan.ignore.length ? `, .gitignore (+ ${plan.ignore.join(', ')})` : ''}`,
    ...changed.map((f) => `  ${f.action === 'conflict' ? `keep ${f.key}: it exists and differs (agent-os's version goes to ${f.rej} to merge by hand)` : `${f.action.replace('installed', 'install')} ${f.key}`}`),
    platformSteps.length ? `platform (${v.setup ? 'will apply' : 'apply later with agent-os setup'}):` : 'platform: nothing to change',
    ...platformSteps.map((s) => `  ${s.action === 'keep' ? '' : 'would '}${s.description}`),
  )
  if (ctx.dryRun) { ctx.output({ dryRun: true, profile, detected: state, team: cfg.team, local: cfg.local, files: changed, platform: platformSteps.map(({ apply, ...s }) => s) }, lines.join('\n')); return EXIT.OK }
  if (!useDefaults && ctx.io.ask) {
    const go = await ask(ctx.io, { key: 'confirm', kind: 'yesno', default: true, text: `${lines.join('\n')}\nWrite this?` }, { useDefaults })
    if (!go) { ctx.output({ written: false }, 'nothing written'); return EXIT.OK }
  }
  let author = v.author ?? null
  if (!author && methodology) { try { author = (await import('../tracker/gh.mjs')).ghClient(ctx.io.gh).rest('GET', 'user')?.login ?? null } catch { author = null } }
  const baseline = methodology === 'forward-only' ? { signals: state.signals, profile, author: author ?? 'agent-os' } : null
  const r = applyInit({ cwd: ctx.cwd, ...cfg, version, plan, baseline })
  if (v.setup) for (const s of platformSteps.filter((x) => x.action !== 'keep')) s.apply()
  const fails = r.doctor.checks.flatMap((c) => c.findings.filter((f) => f.level === 'fail'))
  ctx.output({ written: true, profile, files: r.results.filter((x) => x.action !== 'unchanged'), doctor: { score: r.doctor.score, summary: r.doctor.summary }, platformApplied: Boolean(v.setup) },
    [...lines.map((l) => l.replace(/^(write|update) /, 'wrote ')), `doctor: readiness ${r.doctor.score}/100, ${r.doctor.summary.fail} fail`, ...fails.map((f) => `  FAIL ${f.message} (fix: ${f.fix})`), ...(v.setup ? [] : ['next: agent-os setup --dry-run, then agent-os setup, when the team agrees'])].join('\n'))
  return fails.length ? EXIT.CHECK_FAILED : EXIT.OK
}
