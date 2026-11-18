// `agent-os config`: reads, changes and validates the team file (agent-os.json) and the personal file
// (.agent-os/local.json). `set` picks the right file from the key, so personal settings never get committed; it
// never edits .gitignore (a committed file) and keeps personal files out of git through .git/info/exclude instead.

import { join } from 'node:path'
import { CliError, EXIT } from '../cli/errors.mjs'
import {
  TEAM_FILE, LOCAL_FILE, loadConfig, validate, nodeFor, isPersonal, getPath, setPath, saveJson, ignoreStatus, applyIgnore, unknownKeyHint,
} from '../config/config.mjs'

export const usage = 'agent-os config [get [key] | set <key> <value> | unset <key> | validate | path]'

const SCHEMA_URL = 'https://raw.githubusercontent.com/cosmin-sisman/agent-os/development/schema/agent-os.schema.json'

/** @param {import('../cli/context.mjs').Context} ctx */
export async function run(ctx) {
  const [action = 'get', key, ...rest] = ctx.positionals
  switch (action) {
    case 'get': return get(ctx, key)
    case 'set': return set(ctx, key, rest.join(' '))
    case 'unset': return set(ctx, key, undefined)
    case 'validate': return validateAll(ctx)
    case 'path': return ctx.output({ team: join(ctx.cwd, TEAM_FILE), local: join(ctx.cwd, LOCAL_FILE) }, `team:     ${join(ctx.cwd, TEAM_FILE)}\npersonal: ${join(ctx.cwd, LOCAL_FILE)}`)
    default: throw new CliError(`unknown action "${action}"`, { hint: `usage: ${usage}` })
  }
}

function get(ctx, key) {
  const { merged } = loadConfig(ctx.cwd)
  if (!key) return ctx.output(merged, JSON.stringify(merged, null, 2))
  if (!nodeFor(key)) throw new CliError(`unknown key "${key}"`, { hint: unknownKeyHint(key) })
  const value = getPath(merged, key)
  ctx.output(value ?? null, typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2))
}

/** Values are read as JSON when they parse (true, 3, ["a"], {"x":1}), otherwise as plain strings. */
function parseValue(raw) {
  try { return JSON.parse(raw) } catch { return raw }
}

function set(ctx, key, raw) {
  if (!key) throw new CliError('missing key', { hint: `usage: ${usage}` })
  if (!nodeFor(key)) throw new CliError(`unknown key "${key}"`, { hint: unknownKeyHint(key) })
  if (raw === '') throw new CliError(`missing value for "${key}"`, { hint: `usage: agent-os config set ${key} <value>` })
  const personal = isPersonal(key)
  const file = personal ? LOCAL_FILE : TEAM_FILE
  const { team, local } = loadConfig(ctx.cwd)
  const current = (personal ? local : team) ?? (personal ? {} : { $schema: SCHEMA_URL })
  const value = raw === undefined ? undefined : parseValue(raw)
  const next = setPath(current, key, value)
  if (value === undefined) dropEmpty(next, key)
  const problems = validate(next, { personal, file })
  if (problems.length) throw new CliError(`invalid value for ${key}:\n  - ${problems.join('\n  - ')}`, { hint: 'see docs/reference/configuration.md' })
  const verb = value === undefined ? 'unset' : 'set'
  if (ctx.dryRun) return ctx.output({ dryRun: true, file, key, value: value ?? null }, `would ${verb} ${key} in ${file}`)
  saveJson(ctx.cwd, file, next)
  const ignore = personal ? ignoreStatus(ctx.cwd) : { action: null, message: null }
  applyIgnore(ignore)
  ctx.output({ file, key, value: value ?? null, ignore: ignore.action },
    `${verb} ${key} in ${file}${ignore.message ? `\n${ignore.message}` : ''}`)
}

function dropEmpty(obj, key) {
  const parts = key.split('.')
  const parent = parts.slice(0, -1).reduce((o, k) => o?.[k], obj)
  if (parent) delete parent[parts.at(-1)]
}

function validateAll(ctx) {
  try {
    const { initialized } = loadConfig(ctx.cwd)
    ctx.output({ valid: true, initialized }, initialized ? 'configuration is valid' : `configuration is valid (no ${TEAM_FILE} yet: defaults apply)`)
    return EXIT.OK
  } catch (err) {
    if (!(err instanceof CliError) || !err.message.startsWith('invalid configuration')) throw err
    const problems = err.message.split('\n  - ').slice(1)
    ctx.output({ valid: false, problems }, `configuration has ${problems.length} problem(s):\n  - ${problems.join('\n  - ')}`)
    return EXIT.CHECK_FAILED
  }
}
