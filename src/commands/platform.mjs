// `agent-os platform`: show the configured platform and its login, or detect it from the git remote and (after you
// confirm) write it to agent-os.json. Logging in is left to gh / glab; agent-os never stores a token.

import { CliError, EXIT } from '../cli/errors.mjs'
import { ask } from '../cli/prompt.mjs'
import { loadConfig, validate, saveJson, TEAM_FILE } from '../config/config.mjs'
import { detectPlatform, remoteUrl, loginCommand } from '../platform/detect.mjs'
import { checkPlatformAuth } from '../env/checks.mjs'
import { systemProbe } from '../env/probe.mjs'
import { capabilitiesFor } from '../platform/probe.mjs'
import { CAPABILITIES } from '../platform/capabilities.mjs'

export const usage = 'agent-os platform [show | detect [--remote <url>] [--write] [--yes] | probe [--refresh]]'

export const options = {
  remote: { type: 'string', description: 'Detect from this URL instead of the "origin" remote' },
  write: { type: 'boolean', description: 'Save the detected platform to agent-os.json (asks first)' },
  yes: { type: 'boolean', short: 'y', description: 'Do not ask before writing' },
  refresh: { type: 'boolean', description: 'probe: ask the platform again instead of using the cached map' },
}

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  const [action = 'show'] = ctx.positionals
  if (action === 'show') return show(ctx)
  if (action === 'detect') return detect(ctx)
  if (action === 'probe') return probe(ctx)
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
