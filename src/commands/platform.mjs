// `agent-os platform`: show the configured platform and its login, or detect it from the git remote and (after you
// confirm) write it to agent-os.json; `switch --plan` shows what moving to the other platform changes (#98). Logging
// in is left to gh / glab; agent-os never stores a token.

import { CliError, EXIT } from '../cli/errors.mjs'
import { ask } from '../cli/prompt.mjs'
import { loadConfig, validate, saveJson, TEAM_FILE } from '../config/config.mjs'
import { detectPlatform, remoteUrl, loginCommand } from '../platform/detect.mjs'
import { checkPlatformAuth } from '../env/checks.mjs'
import { systemProbe } from '../env/probe.mjs'
import { capabilitiesFor } from '../platform/probe.mjs'
import { CAPABILITIES } from '../platform/capabilities.mjs'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PLAN_FILE, switchPlan } from '../platform/switch.mjs'

export const usage = 'agent-os platform [show | detect [--remote <url>] [--write] [--yes] | probe [--refresh] | switch --to github|gitlab --project <owner/name> [--host <url>] [--map <importer-map.json>] --plan]'

export const options = {
  remote: { type: 'string', description: 'Detect from this URL instead of the "origin" remote' },
  write: { type: 'boolean', description: 'Save the detected platform to agent-os.json (asks first)' },
  yes: { type: 'boolean', short: 'y', description: 'Do not ask before writing' },
  refresh: { type: 'boolean', description: 'probe: ask the platform again instead of using the cached map' },
  to: { type: 'string', description: 'switch: the platform to move to (github or gitlab)' },
  project: { type: 'string', description: 'switch: the project on the new platform (owner/name or group/name)' },
  host: { type: 'string', description: 'switch: a self-managed host on the new platform, https://…' },
  map: { type: 'string', description: "switch: the importer's map of old to new references, JSON {\"#12\": \"#7\", \"#40\": \"!3\"}" },
  plan: { type: 'boolean', description: 'switch: show and save the plan; nothing in the repository changes' },
}

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  const [action = 'show'] = ctx.positionals
  if (action === 'show') return show(ctx)
  if (action === 'detect') return detect(ctx)
  if (action === 'probe') return probe(ctx)
  if (action === 'switch') return platformSwitch(ctx)
  throw new CliError(`unknown action "${action}"`, { hint: `usage: ${usage}` })
}

function show(ctx) {
  const { merged } = loadConfig(ctx.cwd)
  const [auth] = checkPlatformAuth(merged, { probe: ctx.io.probe ?? systemProbe(ctx.io.env) })
  const p = merged.platform
  const where = p.host ?? (p.type === 'gitlab' ? 'https://gitlab.com' : 'https://github.com')
  ctx.output({ platform: p, auth: { level: auth.level, message: auth.message, fix: auth.fix ?? null } },
    `${p.type} at ${where}${p.project ? `, project ${p.project}` : ' (no project set)'}\n${auth.level === 'ok' ? 'login' : auth.level}: ${auth.message}${auth.fix ? `\nfix: ${auth.fix}` : ''}`)
  return auth.level === 'fail' ? EXIT.CHECK_FAILED : EXIT.OK
}

async function detect(ctx) {
  const remote = ctx.values.remote ?? remoteUrl(ctx.cwd)
  const result = await detectPlatform({ remote, fetchFn: ctx.io.fetch ?? fetch })
  if (!result.ok) {
    ctx.output({ detected: false, evidence: result.evidence }, `not identified: ${result.evidence}\nset it by hand: agent-os config set platform.type github|gitlab (plus platform.host and platform.project)`)
    return EXIT.CHECK_FAILED
  }
  const p = result.platform
  const summary = `${p.type} (${result.edition}${result.version ? ` ${result.version}` : ''})${p.host ? ` at ${p.host}` : ''}, project ${p.project}`
  const lines = [`detected: ${summary}`, `because: ${result.evidence}`, `log in with: ${loginCommand(p)}   (agent-os never stores tokens)`]
  if (!ctx.values.write) {
    ctx.output({ detected: true, ...result, login: loginCommand(p) }, [...lines, 'save it with: agent-os platform detect --write'].join('\n'))
    return EXIT.OK
  }
  const { team } = loadConfig(ctx.cwd)
  const next = { ...(team ?? {}), platform: { ...(team?.platform ?? {}), ...p } }
  const problems = validate(next, { personal: false, file: TEAM_FILE })
  if (problems.length) throw new CliError(`cannot save the platform:\n  - ${problems.join('\n  - ')}`)
  const confirmed = ctx.values.yes || ctx.dryRun || await ask(ctx.io, { key: 'confirm', kind: 'yesno', default: false, text: `Save "${summary}" to ${TEAM_FILE}?` })
  if (!confirmed) {
    ctx.output({ detected: true, ...result, written: false }, [...lines, 'not saved'].join('\n'))
    return EXIT.OK
  }
  if (ctx.dryRun) return ctx.output({ detected: true, ...result, dryRun: true }, [...lines, `would save platform to ${TEAM_FILE}`].join('\n'))
  saveJson(ctx.cwd, TEAM_FILE, next)
  ctx.output({ detected: true, ...result, written: true }, [...lines, `saved to ${TEAM_FILE}`].join('\n'))
  return EXIT.OK
}

async function probe(ctx) {
  const { merged } = loadConfig(ctx.cwd)
  if (!merged.platform.project) throw new CliError('platform.project is not set', { hint: 'run "agent-os platform detect --write" first' })
  const map = await capabilitiesFor(merged, { cwd: ctx.cwd, refresh: Boolean(ctx.values.refresh), gh: ctx.io.gh, glab: ctx.io.glab })
  const rows = Object.entries(map.capabilities).map(([id, c]) => {
    const value = c.value === true ? 'yes' : c.value === false ? 'no' : c.value === null ? 'unknown' : String(c.value)
    const missing = !c.value && CAPABILITIES[id] ? `  → fallback: ${CAPABILITIES[id].fallback}` : ''
    return `${id.padEnd(18)} ${value.padEnd(20)} ${c.source.padEnd(8)} ${c.note ?? ''}${missing}`
  })
  ctx.output(map, [`${map.platform} ${map.host} ${map.project}${map.fromCache ? ` (cached ${map.probedAt}; --refresh to probe again)` : ''}`, ...rows].join('\n'))
}

/** The switch plan only: applying it on a branch, as one change request, is a later step of #98. */
function platformSwitch(ctx) {
  const v = ctx.values
  if (!v.plan) throw new CliError('only the plan is available: agent-os platform switch … --plan', { hint: 'review the plan; applying it on its own branch as one change request comes later (#98)' })
  let map = {}
  if (v.map) { try { map = JSON.parse(readFileSync(resolve(ctx.cwd, v.map), 'utf8')) } catch { throw new CliError(`${v.map} is not a JSON map of references`, { hint: '{"#12": "#7", "#40": "!3"}' }) } }
  const { merged } = loadConfig(ctx.cwd)
  const p = switchPlan(ctx.cwd, merged, { to: v.to, project: v.project, host: v.host, map })
  if (!ctx.dryRun) { mkdirSync(join(ctx.cwd, '.agent-os/cache'), { recursive: true }); writeFileSync(join(ctx.cwd, PLAN_FILE), `${JSON.stringify(p, null, 2)}\n`) }
  const list = (title, xs) => (xs.length ? [`${title} (${xs.length}):`, ...xs.map((x) => `  ${x}`)] : [])
  ctx.output(p, [
    `switch ${p.from} → ${p.to} (${p.project}): the plan, nothing changed`,
    ...list('remove', p.remove), ...list('conflicts: edited by hand, kept until you port or eject them', p.conflicts),
    ...list('add', p.add), ...list('rewrite (the text depends on the platform)', p.rewrite),
    ...p.ci.map((c) => `ci: ${c.action} ${c.path}${c.includes ? ` (include ${c.includes.join(', ')})` : ''}`),
    ...list("the team's own files under the old route: port them by hand", p.manual),
    ...p.config.map((c) => `config: ${c.key} ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`),
    `journal: ${p.journal.entries} entr${p.journal.entries === 1 ? 'y' : 'ies'}, ${p.journal.relink.length} to re-link${p.journal.unmapped.length ? `; not in the map: ${p.journal.unmapped.join(', ')}` : ''}`,
    '', ...p.steps.map((s, i) => `${i + 1}. ${s}`),
    '', p.complete ? 'no file from the old route remains after these steps' : 'files from the old route would remain: resolve the conflicts and port the files above first',
  ].join('\n'))
  return p.complete ? EXIT.OK : EXIT.CHECK_FAILED
}
